import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendCapiEvent,
  readCapiConfig,
  readLeadEventSource,
  readPurchaseValue,
} from "./client";
import type { CapiEvent } from "./event";

const config = {
  datasetId: "111222333",
  accessToken: "TOKEN",
  apiVersion: "v26.0",
  testEventCode: null,
};

const event: CapiEvent = {
  event_name: "LeadQualificado",
  event_time: 1_785_000_000,
  event_id: "lead-row-1:LeadQualificado",
  action_source: "system_generated",
  user_data: { em: ["abc123"] },
  custom_data: { event_source: "crm", lead_event_source: "Integrallys CRM" },
};

/** Stand in for one Graph API response. */
function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendCapiEvent — request shape", () => {
  it("POSTs the event to the dataset's /events endpoint with the token in the body", async () => {
    const fetchMock = mockFetch(200, { events_received: 1, fbtrace_id: "TRACE1" });
    await sendCapiEvent(event, config);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/111222333/events");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.data).toEqual([event]);
    expect(body.access_token).toBe("TOKEN");
    // Absent, not null: sending the key at all would route to the Test Events tab.
    expect(body).not.toHaveProperty("test_event_code");
  });

  it("includes test_event_code only when one is configured", async () => {
    const fetchMock = mockFetch(200, { events_received: 1 });
    await sendCapiEvent(event, { ...config, testEventCode: "TEST123" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).test_event_code).toBe("TEST123");
  });
});

describe("sendCapiEvent — success", () => {
  it("reports events_received and the fbtrace_id", async () => {
    mockFetch(200, { events_received: 1, fbtrace_id: "TRACE1" });
    expect(await sendCapiEvent(event, config)).toEqual({
      ok: true,
      eventsReceived: 1,
      fbtraceId: "TRACE1",
    });
  });
});

describe("sendCapiEvent — permanent failures", () => {
  it("treats an expired access token (190) as permanent", async () => {
    mockFetch(400, {
      error: { code: 190, message: "Error validating access token" },
      fbtrace_id: "TRACE2",
    });
    const result = await sendCapiEvent(event, config);
    expect(result).toMatchObject({ ok: false, permanent: true, code: 190, fbtraceId: "TRACE2" });
  });

  it("treats a malformed payload (100) as permanent", async () => {
    mockFetch(400, { error: { code: 100, message: "Invalid parameter" } });
    expect(await sendCapiEvent(event, config)).toMatchObject({ permanent: true, code: 100 });
  });

  it("prefers error_user_msg when Meta provides one", async () => {
    mockFetch(400, {
      error: { code: 100, message: "Invalid parameter", error_user_msg: "Telefone inválido" },
    });
    const result = await sendCapiEvent(event, config);
    expect(result).toMatchObject({ ok: false, message: "Telefone inválido" });
  });
});

describe("sendCapiEvent — transient failures", () => {
  it("treats rate limiting (code 4) as retryable", async () => {
    mockFetch(400, { error: { code: 4, message: "Application request limit reached" } });
    expect(await sendCapiEvent(event, config)).toMatchObject({ permanent: false, code: 4 });
  });

  it("treats a 5xx as retryable even when it carries a permanent-looking code", async () => {
    // Meta stamps code 2 on its own outages; retrying is right, giving up is not.
    mockFetch(500, { error: { code: 2, message: "An unexpected error has occurred" } });
    expect(await sendCapiEvent(event, config)).toMatchObject({ permanent: false });
  });

  it("treats an unrecognized error code as retryable", async () => {
    mockFetch(400, { error: { code: 99999, message: "Something new" } });
    expect(await sendCapiEvent(event, config)).toMatchObject({ permanent: false, code: 99999 });
  });

  it("folds a network failure into a retryable result instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT")));
    const result = await sendCapiEvent(event, config);
    expect(result).toMatchObject({ ok: false, permanent: false, code: null });
    expect(result).toMatchObject({ message: "connect ETIMEDOUT" });
  });

  it("does not throw on an unparseable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error("not json"); },
    }));
    expect(await sendCapiEvent(event, config)).toMatchObject({
      ok: false, permanent: false, message: "HTTP 502",
    });
  });
});

describe("readCapiConfig", () => {
  beforeEach(() => {
    vi.stubEnv("META_CAPI_DATASET_ID", "");
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "");
    vi.stubEnv("META_CAPI_API_VERSION", "");
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "");
  });

  it("returns null when the dataset id or token is missing", () => {
    expect(readCapiConfig()).toBeNull();
    vi.stubEnv("META_CAPI_DATASET_ID", "111222333");
    expect(readCapiConfig()).toBeNull();
  });

  it("defaults the API version and leaves the test code null when unset", () => {
    vi.stubEnv("META_CAPI_DATASET_ID", "111222333");
    vi.stubEnv("META_CAPI_ACCESS_TOKEN", "TOKEN");
    expect(readCapiConfig()).toEqual({
      datasetId: "111222333",
      accessToken: "TOKEN",
      apiVersion: "v26.0",
      testEventCode: null,
    });
  });
});

describe("readLeadEventSource", () => {
  it("falls back to the CRM's name when unset or blank", () => {
    for (const raw of ["", "   "]) {
      vi.stubEnv("META_CAPI_LEAD_EVENT_SOURCE", raw);
      expect(readLeadEventSource()).toBe("Integrallys CRM");
    }
  });
  it("uses the configured name", () => {
    vi.stubEnv("META_CAPI_LEAD_EVENT_SOURCE", "Integrallys");
    expect(readLeadEventSource()).toBe("Integrallys");
  });
});

describe("readPurchaseValue", () => {
  it("returns null when unset, blank or not a positive number", () => {
    for (const raw of ["", "   ", "0", "-10", "abc"]) {
      vi.stubEnv("META_CAPI_PURCHASE_VALUE", raw);
      expect(readPurchaseValue()).toBeNull();
    }
  });
  it("parses a positive value", () => {
    vi.stubEnv("META_CAPI_PURCHASE_VALUE", "2500.50");
    expect(readPurchaseValue()).toBe(2500.5);
  });
});
