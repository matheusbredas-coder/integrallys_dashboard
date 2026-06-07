# Inline Chat Panel

**Date:** 2026-06-07
**Status:** Approved

## Goal

Replace the current popup-based `ChatLauncher` with an always-visible inline chat panel embedded directly below the "Receita no período" chart in the overview dashboard. The user clicks the input and types — no modal, no slide-over, no trigger button.

## Placement

`ChatPanel` is inserted in `OverviewDashboard` after `<RevenueChart />` and before `<TopProcedures />`. The old `ChatLauncher` is removed from `page.tsx` and `chat-launcher.tsx` is deleted.

```
OverviewDashboard
  KpiCards
  Gauges
  RevenueChart
  ChatPanel        ← new position
  TopProcedures
```

## Component

**File:** `src/features/chat/chat-panel.tsx` (new, replaces `chat-launcher.tsx`)

The component is a card with two regions:

1. **Messages area** — `max-height: 320px`, `overflow-y: auto`, rendered only when `msgs.length > 0` so the card stays compact on a fresh day. Message bubbles follow the same style as the existing side panel (user = gold background, assistant = `var(--panel-hi)` with border).

2. **Input row** — always visible. Text input + "Enviar" button. Input takes full width, `Enter` key sends. Gold button matching current style. Disabled while streaming.

**Card header:** `"Pergunte à Integrallys"` with a gold `IA ✦` pill badge on the right — same visual as the existing launcher bar.

Streaming fetch logic is identical to `ChatLauncher` (POST `/api/chat`, read body as text stream, append chunks to last assistant message).

## Persistence

- **Storage key:** `integrallys_chat`
- **Stored shape:** `{ date: "YYYY-MM-DD", messages: Msg[] }`
- **On mount:** read from `localStorage`. If `date !== today` (ISO date), discard. If unavailable (SSR / private mode), fall back to empty in-memory state silently.
- **On every message update:** write `{ date: today, messages }` back to `localStorage`.
- **Reset:** happens naturally on next page load after midnight — no live timer needed.

## Files Changed

| Action | File |
|--------|------|
| Delete | `src/features/chat/chat-launcher.tsx` |
| Create | `src/features/chat/chat-panel.tsx` |
| Edit | `src/features/overview/overview-dashboard.tsx` — add `<ChatPanel />` after `<RevenueChart />` |
| Edit | `src/app/(app)/page.tsx` — remove `ChatLauncher` import and usage |

## Out of Scope

- Server-side persistence
- Multi-device sync
- Live midnight reset while tab is open
- Any changes to the `/api/chat` route or agent logic
