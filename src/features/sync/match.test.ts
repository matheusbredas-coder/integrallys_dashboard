import { describe, it, expect } from "vitest";
import { normalizeName, splitPatients } from "./match";
import type { GestekCliente, SupabasePatient } from "./types";

describe("normalizeName", () => {
  it("trims, collapses spaces, strips accents, lowercases", () => {
    expect(normalizeName("  José   DA Silva ")).toBe("jose da silva");
  });
  it("handles null/undefined", () => {
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("splitPatients", () => {
  // THE BUG: Supabase originals have numeric ids; the Gestek id is in gestek_id.
  // Matching MUST be on gestek_id, never on Clientes.id.
  it("treats Gestek clients already present (by gestek_id) as NOT new", () => {
    const gestek: GestekCliente[] = [
      { id: "aaa111", nome: "ANA" },
      { id: "bbb222", nome: "BRUNO" },
    ];
    const supa: SupabasePatient[] = [
      { id: "12", Nome: "ANA", gestek_id: "aaa111" },
      { id: "37", Nome: "BRUNO", gestek_id: "bbb222" },
    ];
    const r = splitPatients(gestek, supa);
    expect(r.newGestekClients).toEqual([]); // <- would be BOTH if matched on Clientes.id
    expect(r.gestekIdToSupabaseId).toEqual({ aaa111: "12", bbb222: "37" });
  });
  it("flags a genuinely-new Gestek client", () => {
    const gestek: GestekCliente[] = [{ id: "aaa111", nome: "ANA" }, { id: "ccc333", nome: "CARLA" }];
    const supa: SupabasePatient[] = [{ id: "12", Nome: "ANA", gestek_id: "aaa111" }];
    const r = splitPatients(gestek, supa);
    expect(r.newGestekClients.map((c) => c.id)).toEqual(["ccc333"]);
  });
  it("reports orphans (Supabase has gestek_id not in Gestek)", () => {
    const r = splitPatients([{ id: "aaa111", nome: "ANA" }], [
      { id: "12", Nome: "ANA", gestek_id: "aaa111" },
      { id: "99", Nome: "GHOST", gestek_id: "zzz999" },
    ]);
    expect(r.orphans).toEqual([{ id: "99", Nome: "GHOST" }]);
  });
  it("warns on duplicate normalized names among Gestek clients", () => {
    const r = splitPatients([{ id: "a", nome: "ANA" }, { id: "b", nome: "ana" }], []);
    expect(r.duplicates.length).toBe(1);
  });
  it("builds a supabaseNameToId map (first wins)", () => {
    const r = splitPatients([], [{ id: "5", Nome: "ANA", gestek_id: "x" }]);
    expect(r.supabaseNameToId).toEqual({ ana: "5" });
  });
});
