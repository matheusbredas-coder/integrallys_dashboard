import { describe, it, expect } from "vitest";
import { validateReadonlySql } from "./sql-guard";

const ok = (q: string) => validateReadonlySql(q);

describe("validateReadonlySql", () => {
  it("accepts a SELECT", () => {
    expect(ok("select * from clientes_view")).toEqual({ ok: true, sql: "select * from clientes_view" });
  });
  it("accepts a WITH (CTE)", () => {
    expect(ok("with x as (select 1 a) select * from x").ok).toBe(true);
  });
  it("strips a single trailing semicolon", () => {
    expect(ok("select 1;")).toEqual({ ok: true, sql: "select 1" });
  });
  it("does NOT flag columns like created_at / updated_at", () => {
    expect(ok("select created_at, updated_at from vendas_view").ok).toBe(true);
  });
  it("rejects empty", () => { expect(ok("   ").ok).toBe(false); });
  it("rejects non-SELECT", () => { expect(ok("delete from clientes_view").ok).toBe(false); });
  it("rejects writes", () => {
    for (const w of ["update clientes_view set x=1", "drop table t", "insert into t values (1)", "truncate t", "alter table t add c int", "grant all to x"]) {
      expect(ok(w).ok).toBe(false);
    }
  });
  it("rejects multiple statements", () => {
    expect(ok("select 1; select 2").ok).toBe(false);
  });
  it("rejects SELECT INTO (write)", () => {
    expect(ok("select * into newt from clientes_view").ok).toBe(false);
  });
});
