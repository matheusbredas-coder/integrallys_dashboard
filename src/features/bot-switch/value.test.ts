import { describe, expect, test } from "vitest";
import { botEnabledFrom } from "./value";

describe("botEnabledFrom", () => {
  test("no row yet = on", () => expect(botEnabledFrom(null)).toBe(true));
  test("1 = on", () => expect(botEnabledFrom({ value: 1 })).toBe(true));
  test("0 = off", () => expect(botEnabledFrom({ value: 0 })).toBe(false));
  test("numeric comes back from PostgREST as a string", () => expect(botEnabledFrom({ value: "0" })).toBe(false));
});
