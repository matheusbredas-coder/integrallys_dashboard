import "server-only";

// Thin wrapper over a Slack Incoming Webhook. Deliberately never throws: notifications are
// a side effect of recording data, and a Slack outage must not fail the write that
// triggered it. Callers get a boolean and decide whether that's worth logging.

export type SlackBlock = Record<string, unknown>;

/**
 * Post a Block Kit message to SLACK_WEBHOOK_URL.
 *
 * `fallbackText` is what shows in the notification popup and on clients that can't render
 * blocks — Slack requires it, so it isn't optional.
 *
 * Returns true only on a 2xx. Returns false (without throwing) when the webhook is
 * unconfigured, the request fails, or Slack rejects it.
 */
export async function postSlackMessage(
  blocks: SlackBlock[],
  fallbackText: string
): Promise<boolean> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return false; // notifications simply aren't configured

  try {
    // Slack normally answers in well under a second; cap it so a hung connection can't
    // hold the ingest route open until the platform timeout.
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: fallbackText, blocks }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[slack] webhook responded ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slack] webhook request failed", err);
    return false;
  }
}
