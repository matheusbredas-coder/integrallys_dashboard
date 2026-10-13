import { describe, expect, test } from "vitest";
import { buildWhatsAppAdRow, normalizeWhatsAppPhone, phoneVariants } from "./whatsapp-ad";

describe("normalizeWhatsAppPhone", () => {
  test("keeps a full 13-digit mobile as is", () => {
    expect(normalizeWhatsAppPhone("5527999687380")).toBe("5527999687380");
  });

  test("restores the 9th digit WhatsApp drops from older mobiles", () => {
    expect(normalizeWhatsAppPhone("552799687380")).toBe("5527999687380");
  });

  test("leaves a landline alone", () => {
    expect(normalizeWhatsAppPhone("552733334444")).toBe("552733334444");
  });

  test.each([["477"], ["14155550100"], [""], [undefined]])("rejects %s", (raw) => {
    expect(normalizeWhatsAppPhone(raw)).toBeNull();
  });
});

describe("phoneVariants", () => {
  test("a mobile matches with or without the 9", () => {
    expect(phoneVariants("5527999687380")).toEqual(["5527999687380", "552799687380"]);
  });

  test("a landline has one form", () => {
    expect(phoneVariants("552733334444")).toEqual(["552733334444"]);
  });
});

describe("buildWhatsAppAdRow", () => {
  const now = new Date("2026-10-13T15:00:00Z");

  test("builds an A-ligar card with the ad in raw", () => {
    const row = buildWhatsAppAdRow(
      { phone: "552799687380", name: " Ana ", text: "Olá! Quero saber mais", ad: { title: "Emagreça", adId: "123", ctwaClid: "c" } },
      now,
    );
    expect(row).toEqual({
      source: "whatsapp_ad",
      external_id: "whatsapp:5527999687380",
      campaign: "Emagreça",
      form_name: "Anúncio no WhatsApp",
      name: "Ana",
      phone: "5527999687380",
      raw: { Mensagem: "Olá! Quero saber mais", "Anúncio": "Emagreça", "ID do anúncio": "123", ctwa_clid: "c" },
      submitted_at: "2026-10-13T15:00:00.000Z",
    });
  });

  test("survives a missing ad and name", () => {
    const row = buildWhatsAppAdRow({ phone: "5527999687380" }, now);
    expect(row).toMatchObject({ name: null, campaign: null, raw: {} });
  });

  test("no usable phone, no card", () => {
    expect(buildWhatsAppAdRow({ phone: "477" }, now)).toBeNull();
  });
});
