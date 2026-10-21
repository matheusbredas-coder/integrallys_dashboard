import "server-only";

/**
 * Reconnecting the clinic's WhatsApp to Evolution from /settings, when the phone
 * unlinks it. Only two Evolution calls, both on the SAME instance:
 *   GET /instance/connectionState/<instance>  → is it linked?
 *   GET /instance/connect/<instance>[?number=] → QR code + pairing code
 *   DELETE /instance/logout/<instance>         → ends a stale QR session (only when NOT open)
 * Never delete/recreate the instance to "fix" it: that regenerates its token and
 * wipes its webhook, and the bot goes deaf while Evolution still says "connected".
 *
 * Env (server only): EVOLUTION_BASE_URL (public https URL), EVOLUTION_API_KEY
 * (the GLOBAL AUTHENTICATION_API_KEY, which survives a re-pair), EVOLUTION_INSTANCE.
 */

export type ConnectionState = "open" | "connecting" | "close" | "unknown";

export type PairingResult = {
  state: ConnectionState;
  /** data:image/png;base64,… — absent once the phone is already linked. */
  qr?: string;
  /** 8 characters, typed on the phone under "Conectar com número de telefone". */
  pairingCode?: string;
};

export function stateFrom(body: unknown): ConnectionState {
  const s = (body as { instance?: { state?: unknown } } | null)?.instance?.state;
  return s === "open" || s === "connecting" || s === "close" ? s : "unknown";
}

export function pairingFrom(body: unknown): PairingResult {
  const b = (body ?? {}) as { base64?: unknown; pairingCode?: unknown; instance?: unknown };
  // Already linked: Evolution answers with the state instead of a code.
  if (b.instance) return { state: stateFrom(b) };
  const qr = typeof b.base64 === "string" && b.base64 ? b.base64 : undefined;
  const pairingCode = typeof b.pairingCode === "string" && b.pairingCode ? b.pairingCode : undefined;
  return { state: "connecting", qr, pairingCode };
}

/** Brazilian phone → digits with country code, or null if it can't be a mobile number. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}

function config() {
  const base = process.env.EVOLUTION_BASE_URL?.replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!base || !key || !instance) return null;
  return { base, key, instance: encodeURIComponent(instance) };
}

async function call(path: string, method: "GET" | "DELETE" = "GET"): Promise<unknown> {
  const c = config();
  if (!c) throw new Error("Evolution não configurada (EVOLUTION_BASE_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE).");
  const res = await fetch(`${c.base}${path.replace("{instance}", c.instance)}`, {
    method,
    headers: { apikey: c.key },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Evolution respondeu ${res.status}`);
  return res.json();
}

export async function fetchConnectionState(): Promise<ConnectionState> {
  return stateFrom(await call("/instance/connectionState/{instance}"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function requestPairing(phone?: string): Promise<PairingResult> {
  const q = phone ? `?number=${phone}` : "";
  const first = pairingFrom(await call(`/instance/connect/{instance}${q}`));
  if (!phone || first.pairingCode || first.state === "open") return first;

  // A QR session already running ignores ?number= and never yields a pairing
  // code. End it and start over — but only while unlinked, so this can never
  // drop a working connection.
  if ((await fetchConnectionState()) === "open") return { state: "open" };
  await call("/instance/logout/{instance}", "DELETE").catch((e) => console.warn("[whatsapp-pairing] logout", e));
  let last = first;
  for (let i = 0; i < 3; i++) {
    await sleep(2000);
    last = pairingFrom(await call(`/instance/connect/{instance}${q}`));
    if (last.pairingCode || last.state === "open") return last;
  }
  return last;
}
