import { describe, it, expect } from "vitest";
import { runGestekSync } from "./run-sync";
import type { SyncStore } from "./store";
import type { GestekAgenda, GestekCliente, GestekVenda, SupabasePatient } from "./types";

function makeStore(patients: SupabasePatient[]) {
  const inserted: unknown[] = [];
  const upserted: unknown[] = [];
  const agenda: unknown[] = [];
  const starts: { run_id: string; trigger: string }[] = [];
  const errors: { run_id: string; completed_at: string; message: string }[] = [];
  const store: SyncStore = {
    readPatients: async () => patients,
    insertPatients: async (rows) => { inserted.push(...rows); },
    upsertVendas: async (rows) => { upserted.push(...rows); },
    upsertAgenda: async (rows) => { agenda.push(...rows); },
    logStart: async (meta) => { starts.push({ run_id: meta.run_id, trigger: meta.trigger }); },
    logComplete: async () => {},
    logError: async (run_id, completed_at, message) => { errors.push({ run_id, completed_at, message }); },
  };
  return { store, inserted, upserted, agenda, starts, errors };
}
const gestek = (clientes: GestekCliente[], vendas: GestekVenda[], agenda: GestekAgenda[] = []) => ({
  fetchAllClientes: async () => clientes,
  fetchAllVendas: async () => vendas,
  fetchAllAgenda: async () => agenda,
});

describe("runGestekSync", () => {
  const existing: SupabasePatient[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), Nome: `P${i}`, gestek_id: `g${i}` }));

  it("happy path: inserts only new patients and upserts vendas", async () => {
    const { store, inserted, upserted } = makeStore(existing);
    const clientes = [...existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome })), { id: "gNEW", nome: "NEW ONE" }];
    const vendas: GestekVenda[] = [{ id: "v1", clienteId: "g0", status: 1, total: 100, itens: [] }];
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, vendas), now: () => new Date("2026-06-04T00:00:00Z") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary?.patients_inserted).toBe(1);
      expect(r.summary?.vendas_upserted).toBe(1);
    }
    expect(inserted).toHaveLength(1);
    expect(upserted).toHaveLength(1);
  });

  it("dry-run writes nothing but reports the plan", async () => {
    const { store, inserted, upserted } = makeStore(existing);
    const clientes = [...existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome })), { id: "gNEW", nome: "NEW ONE" }];
    const r = await runGestekSync({ dryRun: true }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.summary?.dryRun).toBe(true); expect(r.summary?.patients_inserted).toBe(1); }
    expect(inserted).toHaveLength(0);
    expect(upserted).toHaveLength(0);
  });

  it("skips inserting a Gestek client whose name already exists in Supabase (warns instead)", async () => {
    const supa: SupabasePatient[] = [{ id: "5", Nome: "LAIZA MICHELLE DIAS", gestek_id: "g-keep" }];
    const { store, inserted } = makeStore(supa);
    // Gestek has the matched one (g-keep) plus a DUPLICATE record with same name, different id
    const clientes = [{ id: "g-keep", nome: "LAIZA MICHELLE DIAS" }, { id: "g-dup", nome: "LAIZA MICHELLE DIAS" }];
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary?.patients_inserted).toBe(0); // dup record skipped
      expect(r.warnings.some((w) => (w.message || "").includes("já existe no Supabase"))).toBe(true);
    }
    expect(inserted).toHaveLength(0);
  });

  it("upserts agenda rows and reports agenda_upserted", async () => {
    const { store, agenda } = makeStore(existing);
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    const agendaItems: GestekAgenda[] = [
      { id: "a1", dataAgendamentoInicio: "2026-06-01T12:00:00Z", pendente: false, clienteNome: "ANA" },
      { id: "a2", dataAgendamentoInicio: "2026-06-02T12:00:00Z", pendente: true, clienteNome: "BIA" },
    ];
    const r = await runGestekSync(
      { dryRun: false },
      { store, gestek: gestek(clientes, [], agendaItems), now: () => new Date("2026-06-04T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary?.agenda_upserted).toBe(2);
    expect(agenda).toHaveLength(2);
  });

  it("dry-run does not upsert agenda", async () => {
    const { store, agenda } = makeStore(existing);
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    const agendaItems: GestekAgenda[] = [{ id: "a1", dataAgendamentoInicio: "2026-06-01T12:00:00Z", pendente: false }];
    const r = await runGestekSync(
      { dryRun: true },
      { store, gestek: gestek(clientes, [], agendaItems), now: () => new Date("2026-06-04T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    expect(agenda).toHaveLength(0);
  });

  it("logs the caller-provided trigger (cron), defaulting to webhook", async () => {
    const { store, starts } = makeStore(existing);
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    await runGestekSync({ dryRun: false, trigger: "cron" }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(starts.map((s) => s.trigger)).toEqual(["cron", "webhook"]);
  });

  it("stamps the log row via logError when fetching clientes fails after logStart", async () => {
    const { store, starts, errors } = makeStore(existing);
    const broken = { ...gestek([], []), fetchAllClientes: async () => { throw new Error("Gestek 429"); } };
    const r = await runGestekSync({ dryRun: false }, { store, gestek: broken, now: () => new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("gestek_error");
    expect(starts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].run_id).toBe(starts[0].run_id);
    expect(errors[0].message).toContain("Gestek 429");
  });

  it("stamps the log row via logError when an unexpected write error crashes the run", async () => {
    const { store, starts, errors } = makeStore(existing);
    store.upsertVendas = async () => { throw new Error("db down"); };
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    const vendas: GestekVenda[] = [{ id: "v1", clienteId: "g0", status: 1, total: 100, itens: [] }];
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, vendas), now: () => new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].run_id).toBe(starts[0].run_id);
    expect(errors[0].message).toContain("db down");
  });

  it("guard trips on an implausible number of new patients (writes nothing)", async () => {
    const { store, inserted } = makeStore(existing);
    // every Gestek client looks new (none match existing gestek_id) -> 100 new
    const clientes = Array.from({ length: 100 }, (_, i) => ({ id: `brand${i}`, nome: `X${i}` }));
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("guard_tripped");
    expect(inserted).toHaveLength(0);
  });
});
