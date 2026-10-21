/**
 * The "Bot ligado / desligado" switch on /marketing. It lives in app_settings as
 * `bot_enabled` (1 = on, 0 = off) because that table already exists and holds
 * numbers — no migration. The bot reads the same row (Lead Qualifier Bot,
 * src/botSwitch.ts), every 15 seconds at most.
 *
 * Off means the bot says nothing to anyone — except the day-before appointment
 * confirmations and the patient's "Combinado!" answer to them, which go out
 * whatever the switch says.
 */
export const BOT_ENABLED_KEY = "bot_enabled";

/** No row = on: that is how the bot behaved before the switch existed. */
export function botEnabledFrom(row: { value: unknown } | null | undefined): boolean {
  if (!row) return true;
  return Number(row.value) !== 0;
}
