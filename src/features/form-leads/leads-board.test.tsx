import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

type BoardOpts = { registerAttempt?: boolean; callbackAtIso?: string | null };
type BoardResult = { ok: true; attempts: number; nextCallAt: string | null } | { error: string };

const updateFormLeadBoard =
  vi.fn<(id: string, column: string | null, opts?: BoardOpts) => Promise<BoardResult>>(
    async () => ({ ok: true, attempts: 1, nextCallAt: null }),
  );
const refresh = vi.fn();

vi.mock("./actions", () => ({
  updateFormLeadBoard: (id: string, column: string | null, opts?: BoardOpts) =>
    updateFormLeadBoard(id, column, opts),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LeadsBoard, parseCallback } from "./leads-board";
import type { FormLeadRow } from "./types";

function lead(over: Partial<FormLeadRow> = {}): FormLeadRow {
  return {
    id: "l1", source: "meta_instant_form", external_id: null, sheet_row: null,
    campaign: null, form_name: null, name: "Lenita", phone: "5527981820451",
    email: null, raw: {}, protocolo: "emagrecimento", stage: "novo", notes: null,
    submitted_at: null, created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
    board_column: null, call_attempts: 0, last_call_at: null, next_call_at: null,
    ...over,
  };
}

/** A board column by its visible label. */
function column(label: string): HTMLElement {
  return screen.getByRole("group", { name: label });
}

/** The card element for a lead, found by the name it renders. */
function cardFor(name: string): HTMLElement {
  return screen.getByText(name).closest("[draggable]") as HTMLElement;
}

beforeEach(() => {
  updateFormLeadBoard.mockClear();
  updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 1, nextCallAt: null });
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LeadsBoard", () => {
  it("renders every column, with unmarked leads in the first one", () => {
    render(<LeadsBoard rows={[lead({ name: "Lenita" })]} />);
    for (const label of ["A ligar", "Não atendeu", "Retorno marcado", "Qualificado", "Agendado", "Removido"]) {
      expect(column(label)).toBeInTheDocument();
    }
    expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
  });

  it("moves a lead through the click fallback, with no confirm step", async () => {
    const user = userEvent.setup();
    render(<LeadsBoard rows={[lead()]} />);

    await user.selectOptions(screen.getByLabelText(/Mover Lenita/), "qualificado");

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "qualificado", {
      registerAttempt: false,
      callbackAtIso: null,
    });
  });

  it("registers an attempt when a lead is moved into Não atendeu", async () => {
    const user = userEvent.setup();
    render(<LeadsBoard rows={[lead()]} />);

    await user.selectOptions(screen.getByLabelText(/Mover Lenita/), "nao_atendeu");

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "nao_atendeu", {
      registerAttempt: true,
      callbackAtIso: null,
    });
  });

  it("adds an attempt from the card's own button", async () => {
    const user = userEvent.setup();
    updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 2, nextCallAt: null });
    render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 1 })]} />);

    await user.click(screen.getByRole("button", { name: "+1 tentativa" }));

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "nao_atendeu", {
      registerAttempt: true,
      callbackAtIso: null,
    });
  });

  it("hides the attempt button once three are spent", () => {
    render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 3 })]} />);
    expect(screen.queryByRole("button", { name: "+1 tentativa" })).not.toBeInTheDocument();
    expect(screen.getByText("tentativas esgotadas")).toBeInTheDocument();
  });

  it("asks for a date before moving into Retorno marcado, and aborts if cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<LeadsBoard rows={[lead()]} />);

    await user.selectOptions(screen.getByLabelText(/Mover Lenita/), "retorno");

    expect(window.prompt).toHaveBeenCalled();
    expect(updateFormLeadBoard).not.toHaveBeenCalled();
  });

  it("sends the parsed callback date when one is given", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("05/12 14:30");
    render(<LeadsBoard rows={[lead()]} />);

    await user.selectOptions(screen.getByLabelText(/Mover Lenita/), "retorno");

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    const [, movedTo, opts] = updateFormLeadBoard.mock.calls[0]!;
    expect(movedTo).toBe("retorno");
    expect(opts?.callbackAtIso).toMatch(/^\d{4}-12-05T17:30/); // 14:30 BRT = 17:30 UTC
  });

  it("puts the card back and shows the message when the action fails", async () => {
    const user = userEvent.setup();
    updateFormLeadBoard.mockResolvedValue({ error: "O lead mudou em outra aba. Atualize a página." });
    render(<LeadsBoard rows={[lead()]} />);

    await user.selectOptions(screen.getByLabelText(/Mover Lenita/), "agendado");

    await screen.findByText("O lead mudou em outra aba. Atualize a página.");
    // Back in "A ligar", not stranded in the column the move failed into.
    expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
  });

  it("marks a lead who answered the bot, without moving her column", () => {
    render(<LeadsBoard rows={[lead({ stage: "respondeu", board_column: "nao_atendeu", call_attempts: 1 })]} />);
    expect(screen.getByText("Respondeu no WhatsApp")).toBeInTheDocument();
    expect(within(column("Não atendeu")).getByText("Lenita")).toBeInTheDocument();
  });

  it("shows the real funnel stage read-only, so board and table can differ visibly", () => {
    render(<LeadsBoard rows={[lead({ stage: "contatado", board_column: "agendado" })]} />);
    expect(screen.getByText("etapa: Contatado")).toBeInTheDocument();
  });

  describe("drag and drop", () => {
    /** A dataTransfer stub; jsdom has none, and user-event does not do drag. */
    function dt() {
      const store: Record<string, string> = {};
      return {
        setData: (k: string, v: string) => { store[k] = v; },
        getData: (k: string) => store[k] ?? "",
        dropEffect: "", effectAllowed: "",
      };
    }

    it("does nothing when a card is dropped back on its own column", async () => {
      const { fireEvent } = await import("@testing-library/react");
      render(<LeadsBoard rows={[lead()]} />);
      const transfer = dt();

      fireEvent.dragStart(cardFor("Lenita"), { dataTransfer: transfer });
      fireEvent.dragOver(column("A ligar"), { dataTransfer: transfer });
      fireEvent.drop(column("A ligar"), { dataTransfer: transfer });

      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });

    it("commits a drop onto a different column", async () => {
      const { fireEvent } = await import("@testing-library/react");
      render(<LeadsBoard rows={[lead()]} />);
      const transfer = dt();

      fireEvent.dragStart(cardFor("Lenita"), { dataTransfer: transfer });
      fireEvent.dragOver(column("Removido"), { dataTransfer: transfer });
      fireEvent.drop(column("Removido"), { dataTransfer: transfer });

      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "removido", {
        registerAttempt: false,
        callbackAtIso: null,
      });
    });
  });
});

describe("parseCallback", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("reads dd/mm and defaults to opening time", () => {
    expect(parseCallback("05/09", now)).toBe("2026-09-05T12:00:00.000Z"); // 09:00 BRT
  });

  it("reads dd/mm hh:mm", () => {
    expect(parseCallback("05/09 14:30", now)).toBe("2026-09-05T17:30:00.000Z");
  });

  it("rolls to next year when the bare date already passed", () => {
    expect(parseCallback("01/02", now)).toBe("2027-02-01T12:00:00.000Z");
  });

  it("refuses what it cannot read", () => {
    expect(parseCallback("semana que vem", now)).toBeNull();
    expect(parseCallback("", now)).toBeNull();
    expect(parseCallback("40/13", now)).toBeNull();
    expect(parseCallback("05/09 99:99", now)).toBeNull();
  });
});
