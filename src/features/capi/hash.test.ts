import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  normalizeEmail,
  toE164Digits,
  normalizeName,
  splitName,
  metaLeadId,
  buildUserData,
} from "./hash";

// Known-good digests, computed independently (`printf '<value>' | shasum -a 256`). Hardcoded
// on purpose: re-deriving them with createHash inside the test would only prove the test
// agrees with itself, and the whole point is that our bytes match Meta's.
const HASH = {
  email: "f2880341b1a692cbd1d3619956fc8e1207cf5a7c80cdf67c2f44c615a77df5e7", // joao.silva@example.com
  phone: "1c029b4c392dbf916484c8661a9b8125411e8e715a0c2e9bc9fa23dde4d191af", // 5541999998888
  fn: "ed2befb11499489e2570cb053f774b8ed93e89eddab3f78867a2a5f32c58845e", // joao
  ln: "d24e913a4107af875dc2ac3d419798f3794d00434e5059fbb68ac8d33626eaee", // silva
  rowId: "64dbb9c4f47800dd262315ef6bbecc52f64d9e8191a32712d4998a9801bdff32", // lead-row-1
} as const;

describe("sha256Hex", () => {
  it("produces lowercase hex", () => {
    expect(sha256Hex("joao.silva@example.com")).toBe(HASH.email);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Joao.Silva@Example.COM ")).toBe("joao.silva@example.com");
  });
  it("returns empty for nullish", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("toE164Digits", () => {
  it("keeps a number that already carries the country code", () => {
    expect(toE164Digits("+55 (41) 99999-8888")).toBe("5541999998888");
  });
  it("prefixes 55 on a bare 11-digit mobile", () => {
    expect(toE164Digits("(41) 99999-8888")).toBe("5541999998888");
  });
  it("prefixes 55 on a bare 10-digit landline", () => {
    expect(toE164Digits("41 3333-8888")).toBe("554133338888");
  });
  it("drops leading zeros before deciding", () => {
    // "0" + DDD is how a Brazilian dials long distance; it is not part of the number.
    expect(toE164Digits("041 99999-8888")).toBe("5541999998888");
  });
  it("leaves a foreign number written out in full alone", () => {
    expect(toE164Digits("+351 912 345 678")).toBe("351912345678");
  });
  it("documents the Brazil-first assumption: a bare 11-digit US number is read as BR", () => {
    // Unavoidable — 11 digits is both a complete US number and a country-code-less BR
    // mobile. The clinic only advertises in Brazil, so BR is the correct bet; a foreign
    // lead who omits their country code just fails to match. See toE164Digits.
    expect(toE164Digits("(415) 555-0134")).toBe("554155550134");
  });
  it("returns empty for anything too short to be a phone number", () => {
    expect(toE164Digits("99998888")).toBe("");
    expect(toE164Digits("")).toBe("");
    expect(toE164Digits(null)).toBe("");
  });
});

describe("normalizeName", () => {
  it("folds accents, so João and Joao hash identically", () => {
    expect(normalizeName("João")).toBe("joao");
    expect(normalizeName("João")).toBe(normalizeName("joao"));
  });
  it("strips punctuation and whitespace", () => {
    expect(normalizeName(" D'Ávila-Souza ")).toBe("davilasouza");
  });
  it("returns empty for nullish", () => {
    expect(normalizeName(null)).toBe("");
  });
});

describe("splitName", () => {
  it("takes the first and last tokens", () => {
    expect(splitName("Ana Maria da Costa")).toEqual({ first: "Ana", last: "Costa" });
  });
  it("leaves last empty for a single-token name", () => {
    expect(splitName("Ana")).toEqual({ first: "Ana", last: "" });
  });
  it("handles blank input", () => {
    expect(splitName("   ")).toEqual({ first: "", last: "" });
  });
});

describe("metaLeadId", () => {
  it("recognizes an all-digit Meta lead id", () => {
    expect(metaLeadId("1234567890123456")).toBe(1234567890123456);
  });
  it("strips the l: prefix used by Meta's Ads Manager lead export", () => {
    // Real shape from an exported leads CSV: l:1352107040406960
    expect(metaLeadId("l:1352107040406960")).toBe(1352107040406960);
    expect(metaLeadId("L:1352107040406960")).toBe(1352107040406960);
  });
  it("does not strip any other prefix", () => {
    expect(metaLeadId("c:52592595649455")).toBeUndefined(); // campaign id
    expect(metaLeadId("f:913689621788944")).toBeUndefined(); // form id
  });
  it("rejects the gmail fallback", () => {
    expect(metaLeadId("gmail:abc123")).toBeUndefined();
  });
  it("rejects nullish and non-numeric ids", () => {
    expect(metaLeadId(null)).toBeUndefined();
    expect(metaLeadId("")).toBeUndefined();
    expect(metaLeadId("12345abc")).toBeUndefined();
  });
  it("rejects an id too large to survive as a JSON number", () => {
    expect(metaLeadId("99999999999999999999")).toBeUndefined();
  });
});

describe("buildUserData", () => {
  const full = {
    leadRowId: "lead-row-1",
    name: "João Silva",
    phone: "+55 (41) 99999-8888",
    email: "Joao.Silva@Example.com",
    externalId: "1234567890123456",
  };

  it("hashes every contact field and passes lead_id through unhashed", () => {
    // Arrays, matching the payload in Meta's CRM integration guide.
    expect(buildUserData(full)).toEqual({
      em: [HASH.email],
      ph: [HASH.phone],
      fn: [HASH.fn],
      ln: [HASH.ln],
      external_id: [HASH.rowId],
      lead_id: 1234567890123456,
    });
  });

  it("omits missing fields instead of sending the hash of an empty string", () => {
    const out = buildUserData({
      leadRowId: "lead-row-1",
      name: null,
      phone: null,
      email: null,
      externalId: null,
    });
    expect(out).toEqual({ external_id: [HASH.rowId] });
    expect(JSON.stringify(out)).not.toContain(sha256Hex(""));
  });

  it("falls back to hashed contact data when the lead has no Meta id", () => {
    const out = buildUserData({ ...full, externalId: "gmail:CADxyz@mail.gmail.com" });
    expect(out.lead_id).toBeUndefined();
    expect(out.em).toEqual([HASH.email]);
    expect(out.ph).toEqual([HASH.phone]);
  });

  it("never leaks a plaintext value into the payload", () => {
    const serialized = JSON.stringify(buildUserData(full));
    expect(serialized).not.toContain("Joao.Silva");
    expect(serialized).not.toContain("99999");
    expect(serialized).not.toContain("Silva");
  });
});
