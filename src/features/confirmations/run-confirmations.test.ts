import { describe, it, expect, vi } from "vitest";
import { runConfirmations } from "./run-confirmations";
import type { GestekAgenda } from "@/features/sync/types";

const NOW = () => new Date("2026-07-19T12:00:00Z"); // -> tomorrow = 2026-07-20 BRT

describe("runConfirmations", () => {
  it("happy path: fetches tomorrow, keeps only pending+phoned bookings, sends the batch", async () => {
    const agenda: GestekAgenda[] = [
      { id: "a1", pendente: true, clienteTelefone: "5511999990001", clienteNome: "Ana", dataAgendamentoInicio: "2026-07-20T13:00:00Z" },
      { id: "a2", pendente: false, clienteTelefone: "5511999990002", clienteNome: "Bia" }, // already realized -> excluded
      { id: "a3", pendente: true, clienteTelefone: "", clienteNome: "Cid" }, // no phone -> excluded
    ];
    const fetchAgendaForDay = vi.fn(async (dayISO: string) => { expect(dayISO).toBe("2026-07-20"); return agenda; });
    const sendBatch = vi.fn(async () => ({ sent: 1, skipped: 0, failed: 0 }));

    const result = await runConfirmations({ gestek: { fetchAgendaForDay }, bot: { sendBatch }, now: NOW });

    expect(result).toEqual({ ok: true, dayISO: "2026-07-20", fetched: 3, pendingCount: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][0]).toEqual([
      { agendaId: "a1", phone: "5511999990001", nome: "Ana", startAt: "2026-07-20T13:00:00Z", procedimento: null, profissional: null },
    ]);
  });

  it("skips calling the bot entirely when there's nothing pending", async () => {
    const fetchAgendaForDay = vi.fn(async () => [{ id: "a1", pendente: false, clienteTelefone: "551199999" } as GestekAgenda]);
    const sendBatch = vi.fn();

    const result = await runConfirmations({ gestek: { fetchAgendaForDay }, bot: { sendBatch }, now: NOW });

    expect(result).toEqual({ ok: true, dayISO: "2026-07-20", fetched: 1, pendingCount: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("returns a gestek_error result when the Gestek fetch fails, without calling the bot", async () => {
    const fetchAgendaForDay = vi.fn(async () => { throw new Error("Gestek down"); });
    const sendBatch = vi.fn();

    const result = await runConfirmations({ gestek: { fetchAgendaForDay }, bot: { sendBatch }, now: NOW });

    expect(result).toEqual({ ok: false, code: "gestek_error", message: "Gestek down", dayISO: "2026-07-20" });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("returns a bot_error result when the bot call fails", async () => {
    const fetchAgendaForDay = vi.fn(async () => [{ id: "a1", pendente: true, clienteTelefone: "5511999990001" } as GestekAgenda]);
    const sendBatch = vi.fn(async () => { throw new Error("bot unreachable"); });

    const result = await runConfirmations({ gestek: { fetchAgendaForDay }, bot: { sendBatch }, now: NOW });

    expect(result).toEqual({ ok: false, code: "bot_error", message: "bot unreachable", dayISO: "2026-07-20" });
  });
});
