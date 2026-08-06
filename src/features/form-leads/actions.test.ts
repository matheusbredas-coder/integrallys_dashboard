import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } } }));
const selectIn = vi.fn(async () => ({ data: [], error: null }));
const upsertSelect = vi.fn(async () => ({ data: [], error: null }));
const upsert = vi.fn(() => ({ select: upsertSelect }));
const enqueueStageEvent = vi.fn(async () => ({ queued: true }));
const revalidateTag = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ in: selectIn }),
      upsert,
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

vi.mock("@/features/capi/queue", () => ({
  enqueueStageEvent: (...args: unknown[]) => enqueueStageEvent(...args),
}));

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

import { previewFormLeadsCsv } from "./actions";

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
