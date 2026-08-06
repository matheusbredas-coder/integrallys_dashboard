import { describe, it, expect } from "vitest";
import {
  STAGE_EVENTS,
  eventNameForStage,
  buildEventId,
  buildEvent,
  isEventTooOld,
  resolveEventTime,
  MAX_EVENT_AGE_SECONDS,
} from "./event";
import { FORM_LEAD_STAGES } from "@/features/form-leads/types";

const NOW = 1_785_000_000;
const SOURCE = "Integrallys CRM";

const identity = {
  leadRowId: "lead-row-1",
  name: "João Silva",
  phone: "+55 (41) 99999-8888",
  email: "joao.silva@example.com",
  externalId: "1234567890123456",
};

/** The common case, so each test only states what it actually cares about. */
function build(stage: string, extra: Partial<Parameters<typeof buildEvent>[0]> = {}) {
  return buildEvent({
    identity,
    stage,
    nowSeconds: NOW,
    leadEventSource: SOURCE,
    ...extra,
  });
}

describe("eventNameForStage", () => {
  it("maps every stage the funnel defines", () => {
    expect(eventNameForStage("novo")).toBe("Lead");
    expect(eventNameForStage("contatado")).toBe("LeadContatado");
    expect(eventNameForStage("respondeu")).toBe("LeadRespondeu");
    expect(eventNameForStage("qualificado")).toBe("LeadQualificado");
    expect(eventNameForStage("agendado")).toBe("Schedule");
    expect(eventNameForStage("ganho")).toBe("Purchase");
    expect(eventNameForStage("perdido")).toBe("LeadPerdido");
  });

  it("covers every stage in FORM_LEAD_STAGES, with no gaps", () => {
    // Meta's CRM guide requires a trigger for EVERY funnel stage, including the first one.
    // If a stage is added to the CRM and not mapped here, this fails — which is the point.
    for (const stage of FORM_LEAD_STAGES) {
      expect(eventNameForStage(stage), `stage "${stage}" has no event`).not.toBeNull();
    }
    expect(Object.keys(STAGE_EVENTS).sort()).toEqual([...FORM_LEAD_STAGES].sort());
  });

  it("gives every stage a distinct event name", () => {
    const names = Object.values(STAGE_EVENTS);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns null for a stage the CRM doesn't define", () => {
    expect(eventNameForStage("inventado")).toBeNull();
    expect(eventNameForStage("")).toBeNull();
  });
});

describe("buildEventId", () => {
  it("is stable for the same lead and event", () => {
    expect(buildEventId("lead-row-1", "LeadQualificado")).toBe(
      buildEventId("lead-row-1", "LeadQualificado"),
    );
  });
  it("differs across events and across leads", () => {
    expect(buildEventId("lead-row-1", "Schedule")).not.toBe(
      buildEventId("lead-row-1", "LeadQualificado"),
    );
    expect(buildEventId("lead-row-2", "Schedule")).not.toBe(
      buildEventId("lead-row-1", "Schedule"),
    );
  });
});

describe("buildEvent", () => {
  it("builds the shape Meta's CRM integration guide documents", () => {
    expect(build("qualificado")).toEqual({
      event_name: "LeadQualificado",
      event_time: NOW,
      event_id: "lead-row-1:LeadQualificado",
      action_source: "system_generated",
      custom_data: { event_source: "crm", lead_event_source: SOURCE },
      user_data: {
        em: ["f2880341b1a692cbd1d3619956fc8e1207cf5a7c80cdf67c2f44c615a77df5e7"],
        ph: ["1c029b4c392dbf916484c8661a9b8125411e8e715a0c2e9bc9fa23dde4d191af"],
        fn: ["ed2befb11499489e2570cb053f774b8ed93e89eddab3f78867a2a5f32c58845e"],
        ln: ["d24e913a4107af875dc2ac3d419798f3794d00434e5059fbb68ac8d33626eaee"],
        external_id: ["64dbb9c4f47800dd262315ef6bbecc52f64d9e8191a32712d4998a9801bdff32"],
        lead_id: 1234567890123456,
      },
    });
  });

  it("carries action_source and event_source on every stage", () => {
    for (const stage of FORM_LEAD_STAGES) {
      const event = build(stage);
      expect(event?.action_source).toBe("system_generated");
      expect(event?.custom_data.event_source).toBe("crm");
      expect(event?.custom_data.lead_event_source).toBe(SOURCE);
    }
  });

  it("reports the opening stage as a standard Lead event", () => {
    expect(build("novo")?.event_name).toBe("Lead");
  });

  it("returns null for a stage the CRM doesn't define", () => {
    expect(build("inventado")).toBeNull();
  });

  it("attaches value and currency to Purchase when a ticket is configured", () => {
    expect(build("ganho", { purchaseValue: 2500 })?.custom_data).toEqual({
      event_source: "crm",
      lead_event_source: SOURCE,
      value: 2500,
      currency: "BRL",
    });
  });

  it("omits value rather than inventing one", () => {
    for (const purchaseValue of [undefined, null, 0]) {
      const custom = build("ganho", { purchaseValue })?.custom_data;
      expect(custom?.value).toBeUndefined();
      expect(custom?.currency).toBeUndefined();
    }
  });

  it("never attaches a purchase value to a non-Purchase event", () => {
    const custom = build("agendado", { purchaseValue: 2500 })?.custom_data;
    expect(custom?.value).toBeUndefined();
  });

  it("carries no plaintext personal data, on any stage", () => {
    for (const stage of FORM_LEAD_STAGES) {
      const serialized = JSON.stringify(build(stage));
      expect(serialized).not.toContain("joao.silva@example.com");
      expect(serialized).not.toContain("João");
      expect(serialized).not.toContain("999998888");
    }
  });
});

describe("resolveEventTime", () => {
  // Three days before NOW — the real lag between someone filling the form and the lead
  // reaching us. Derived from NOW rather than hardcoded, so it can never drift past it.
  const submittedSeconds = NOW - 3 * 86400;
  const submitted = new Date(submittedSeconds * 1000).toISOString();

  it("stamps the opening Lead event with when the form was actually filled", () => {
    // The lead reached us days later; reporting "now" would misplace it on Meta's timeline.
    expect(resolveEventTime("novo", submitted, NOW)).toBe(submittedSeconds);
  });

  it("uses now for every later stage — those happen when someone moves the lead", () => {
    for (const stage of ["contatado", "respondeu", "agendado", "ganho", "perdido"]) {
      expect(resolveEventTime(stage, submitted, NOW)).toBe(NOW);
    }
  });

  it("falls back to now when the timestamp is missing or unparseable", () => {
    expect(resolveEventTime("novo", null, NOW)).toBe(NOW);
    expect(resolveEventTime("novo", undefined, NOW)).toBe(NOW);
    expect(resolveEventTime("novo", "not a date", NOW)).toBe(NOW);
  });

  it("refuses a timestamp in the future, which Meta would reject", () => {
    const future = new Date((NOW + 86400) * 1000).toISOString();
    expect(resolveEventTime("novo", future, NOW)).toBe(NOW);
  });
});

describe("isEventTooOld", () => {
  it("accepts an event inside Meta's 7-day window", () => {
    expect(isEventTooOld(NOW - MAX_EVENT_AGE_SECONDS + 60, NOW)).toBe(false);
    expect(isEventTooOld(NOW, NOW)).toBe(false);
  });
  it("retires an event past the window", () => {
    expect(isEventTooOld(NOW - MAX_EVENT_AGE_SECONDS - 1, NOW)).toBe(true);
  });
});
