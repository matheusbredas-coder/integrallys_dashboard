import { describe, it, expect, vi, beforeEach } from "vitest";

// Typed rather than inferred: several tests drive the "no session" / "row missing"
// branches, and an inferred mock narrows to the happy-path shape and rejects null.
const getUser = vi.fn<() => Promise<{ data: { user: { id: string } | null } }>>(
  async () => ({ data: { user: { id: "u1" } } }),
);
const selectIn = vi.fn(async () => ({ data: [], error: null }));
const upsertSelect = vi.fn(async () => ({ data: [], error: null }));
const upsert = vi.fn(() => ({ select: upsertSelect }));
const enqueueStageEvent = vi.fn(async () => ({ queued: true }));
const revalidateTag = vi.fn();

// What a `.select().eq().maybeSingle()` read returns (the board action's first hop).
const maybeSingle = vi.fn<() => Promise<{ data: { call_attempts: number } | null; error: null }>>(
  async () => ({ data: { call_attempts: 0 }, error: null }),
);
// What the compare-and-set update returns; one row means it stuck.
const updateSelect = vi.fn(async () => ({ data: [{ id: "l1" }], error: null }));
/** Every `.update({...})` call the action made, so tests can assert what was written. */
const updatePatches: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
  createSupabaseServiceClient: () => ({
    from: () => ({
      // `.in(...)` is the CSV path; `.eq(...).maybeSingle()` is the board path.
      select: () => ({ in: selectIn, eq: () => ({ maybeSingle }) }),
      upsert,
      update: (patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        // updateFormLeadStage awaits `update().eq()` directly, while the board action
        // chains a second `.eq()` then `.select()`. This is both: a thenable that also
        // carries the chain, so neither caller has to change.
        const chain = {
          then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          eq: () => ({ select: updateSelect }),
          select: updateSelect,
        };
        return { eq: () => chain };
      },
    }),
  }),
}));

vi.mock("@/features/capi/queue", () => ({
  enqueueStageEvent: (...args: unknown[]) => enqueueStageEvent(...args),
}));

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

import { previewFormLeadsCsv, updateFormLeadBoard } from "./actions";

// l:1 appears twice (in-file duplicate), l:2 has no identity fields, l:3 already exists in
// the DB per `selectIn`'s default mock below.
const CSV = [
  "id,nome_completo,email,telefone,campanha",
  "l:1,Ana,ana@x.com,+5511999999999,Campanha X",
  "l:1,Ana Repetida,ana2@x.com,+5511999999999,Campanha X",
  "l:2,,,,Campanha X",
  "l:3,Bea,bea@x.com,+5511988888888,Campanha X",
].join("\n");

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  selectIn.mockResolvedValue({ data: [{ external_id: "l:3" }], error: null });
  maybeSingle.mockResolvedValue({ data: { call_attempts: 0 }, error: null });
  updateSelect.mockResolvedValue({ data: [{ id: "l1" }], error: null });
  updatePatches.length = 0;
  upsertSelect.mockClear();
  upsert.mockClear();
  enqueueStageEvent.mockClear();
  revalidateTag.mockClear();
});

describe("previewFormLeadsCsv", () => {
  it("classifies rows without writing anything", async () => {
    const res = await previewFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, summary: { total: 4, new: 1, duplicate: 2, invalid: 1 } });
    expect(upsertSelect).not.toHaveBeenCalled();
    expect(enqueueStageEvent).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await previewFormLeadsCsv(CSV);
    expect(res).toEqual({ error: "Sessão expirada. Entre novamente." });
  });

  it("errors on a file with no data rows", async () => {
    const res = await previewFormLeadsCsv("id,nome_completo\n");
    expect(res).toEqual({ error: "Nenhuma linha encontrada no arquivo." });
  });
});

import { commitFormLeadsCsv } from "./actions";

describe("commitFormLeadsCsv", () => {
  beforeEach(() => {
    upsertSelect.mockResolvedValue({ data: [{ id: "row-1" }], error: null });
  });

  it("inserts only the new rows and reports each one to Meta", async () => {
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, inserted: 1, duplicate: 2, invalid: 1 });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows.map((r: { external_id: string }) => r.external_id)).toEqual(["l:1"]);
    for (const row of rows) expect(row).not.toHaveProperty("stage");
    expect(options).toEqual({ onConflict: "external_id", ignoreDuplicates: true });

    expect(enqueueStageEvent).toHaveBeenCalledTimes(1);
    expect(enqueueStageEvent).toHaveBeenCalledWith("row-1", "novo");
    expect(revalidateTag).toHaveBeenCalledWith("form-leads", { expire: 0 });
  });

  it("touches nothing when every row is a duplicate or invalid", async () => {
    selectIn.mockResolvedValue({ data: [{ external_id: "l:1" }, { external_id: "l:3" }], error: null });
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, inserted: 0, duplicate: 3, invalid: 1 });
    expect(upsert).not.toHaveBeenCalled();
    expect(upsertSelect).not.toHaveBeenCalled();
    expect(enqueueStageEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ error: "Sessão expirada. Entre novamente." });
  });
});

describe("updateFormLeadBoard", () => {
  // The point of the board is that it is inert toward the funnel. These two are the
  // guardrails: if either ever fails, the board has started doing something the
  // dropdown and Meta are entitled to own.
  it("never writes the stage column", async () => {
    await updateFormLeadBoard("l1", "qualificado");
    expect(updatePatches).toHaveLength(1);
    expect(updatePatches[0]).not.toHaveProperty("stage");
  });

  it("never fires a Meta CAPI event, for any column", async () => {
    for (const c of ["nao_atendeu", "qualificado", "agendado", "removido", null] as const) {
      await updateFormLeadBoard("l1", c);
    }
    // "retorno" is the one column that needs a date, so it is exercised separately.
    await updateFormLeadBoard("l1", "retorno", {
      callbackAtIso: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    expect(enqueueStageEvent).not.toHaveBeenCalled();
  });

  it("moves a lead and reports the authoritative counters back", async () => {
    const res = await updateFormLeadBoard("l1", "qualificado");
    expect(res).toEqual({ ok: true, attempts: 0, nextCallAt: null });
    expect(updatePatches[0]).toMatchObject({ board_column: "qualificado", call_attempts: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("form-leads", { expire: 0 });
  });

  it("registers an attempt and schedules the next call", async () => {
    const res = await updateFormLeadBoard("l1", "nao_atendeu", { registerAttempt: true });
    expect(res).toMatchObject({ ok: true, attempts: 1 });
    expect((res as { nextCallAt: string }).nextCallAt).toBeTruthy();
    expect(updatePatches[0]).toMatchObject({ board_column: "nao_atendeu", call_attempts: 1 });
    expect(updatePatches[0]).toHaveProperty("last_call_at");
  });

  it("stops scheduling once three attempts are spent", async () => {
    maybeSingle.mockResolvedValue({ data: { call_attempts: 2 }, error: null });
    const res = await updateFormLeadBoard("l1", "nao_atendeu", { registerAttempt: true });
    expect(res).toEqual({ ok: true, attempts: 3, nextCallAt: null });
  });

  it("computes the attempt count from the DB, not from the caller", async () => {
    // A stale board must not be able to write a number it made up.
    maybeSingle.mockResolvedValue({ data: { call_attempts: 1 }, error: null });
    const res = await updateFormLeadBoard("l1", "nao_atendeu", { registerAttempt: true });
    expect(res).toMatchObject({ attempts: 2 });
  });

  it("refuses a callback date that is not usable", async () => {
    expect(await updateFormLeadBoard("l1", "retorno", { callbackAtIso: null }))
      .toEqual({ error: "Escolha uma data de retorno válida, em dia útil." });
    expect(await updateFormLeadBoard("l1", "retorno", { callbackAtIso: "seg de manhã" }))
      .toEqual({ error: "Escolha uma data de retorno válida, em dia útil." });
    expect(await updateFormLeadBoard("l1", "retorno", { callbackAtIso: "2020-01-01T10:00:00Z" }))
      .toEqual({ error: "Escolha uma data de retorno válida, em dia útil." });
    expect(updatePatches).toHaveLength(0);
  });

  it("rejects an unknown column", async () => {
    const res = await updateFormLeadBoard("l1", "coluna_inventada" as never);
    expect(res).toEqual({ error: "Coluna inválida." });
    expect(updatePatches).toHaveLength(0);
  });

  it("rejects when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateFormLeadBoard("l1", "qualificado");
    expect(res).toEqual({ error: "Sessão expirada. Entre novamente." });
    expect(updatePatches).toHaveLength(0);
  });

  it("reports a concurrent change instead of clobbering it", async () => {
    updateSelect.mockResolvedValue({ data: [], error: null });
    const res = await updateFormLeadBoard("l1", "qualificado");
    expect(res).toEqual({ error: "O lead mudou em outra aba. Atualize a página." });
  });

  it("reports a lead that is gone", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await updateFormLeadBoard("l1", "qualificado");
    expect(res).toEqual({ error: "Lead não encontrado." });
  });
});
