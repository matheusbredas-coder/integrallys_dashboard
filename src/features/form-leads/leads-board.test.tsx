import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type BoardOpts = { registerAttempt?: boolean; callbackAtIso?: string | null };
type BoardResult = { ok: true; attempts: number; nextCallAt: string | null } | { error: string };

const updateFormLeadBoard =
  vi.fn<(id: string, column: string | null, opts?: BoardOpts) => Promise<BoardResult>>(
    async () => ({ ok: true, attempts: 1, nextCallAt: null }),
  );
const refresh = vi.fn();

const updateFormLeadNotes =
  vi.fn<(id: string, notes: string) => Promise<{ ok: true; notes: string } | { error: string }>>(
    async (_id, notes) => ({ ok: true, notes }),
  );

vi.mock("./actions", () => ({
  updateFormLeadBoard: (id: string, column: string | null, opts?: BoardOpts) =>
    updateFormLeadBoard(id, column, opts),
  updateFormLeadNotes: (id: string, notes: string) => updateFormLeadNotes(id, notes),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LeadsBoard } from "./leads-board";
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

/** A dataTransfer stub; jsdom has none, and user-event does not implement drag. */
function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => { store[k] = v; },
    getData: (k: string) => store[k] ?? "",
    dropEffect: "",
    effectAllowed: "",
  };
}

/**
 * Drag a lead's card onto a column. Dragging is the ONLY way to move a card now, so
 * this is the path every move test goes through.
 */
function drag(name: string, toColumn: string) {
  const transfer = dataTransfer();
  fireEvent.dragStart(cardFor(name), { dataTransfer: transfer });
  const target = column(toColumn);
  fireEvent.dragOver(target, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
}

/**
 * The board's own modal, found by its title — `role="dialog"` alone is ambiguous
 * because the notes drawer is a dialog too.
 */
function modal(title: "Começar do zero?" | "Retorno marcado"): HTMLElement {
  return screen.getByRole("dialog", { name: title });
}

beforeEach(() => {
  updateFormLeadBoard.mockClear();
  updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 1, nextCallAt: null });
  updateFormLeadNotes.mockClear();
  updateFormLeadNotes.mockImplementation(async (_id, notes) => ({ ok: true, notes }));
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

  it("moves a lead on drop, with no confirm step", async () => {
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Qualificado");

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "qualificado", {
      registerAttempt: false,
      callbackAtIso: null,
    });
  });

  it("registers an attempt when a lead is dragged into Não atendeu", async () => {
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Não atendeu");

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "nao_atendeu", {
      registerAttempt: true,
      callbackAtIso: null,
    });
  });

  it("adds an attempt from the card's own button", async () => {
    updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 2, nextCallAt: null });
    render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 1 })]} />);

    fireEvent.click(screen.getByRole("button", { name: "+1 tentativa" }));

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
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Retorno marcado");

    fireEvent.click(within(modal("Retorno marcado")).getByRole("button", { name: "Cancelar" }));

    expect(updateFormLeadBoard).not.toHaveBeenCalled();
    // Cancelling leaves the card exactly where it was — nothing moved optimistically.
    expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
  });

  it("sends the callback date picked in the modal", async () => {
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Retorno marcado");

    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-12-05" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar retorno" }));

    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
    const [, movedTo, opts] = updateFormLeadBoard.mock.calls[0]!;
    expect(movedTo).toBe("retorno");
    expect(opts?.callbackAtIso).toMatch(/^2026-12-05T17:30/); // 14:30 BRT = 17:30 UTC
  });

  it("closes the modal on Escape without writing anything", async () => {
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Retorno marcado");
    expect(modal("Retorno marcado")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateFormLeadBoard).not.toHaveBeenCalled();
  });

  it("puts the card back and shows the message when the action fails", async () => {
    updateFormLeadBoard.mockResolvedValue({ error: "O lead mudou em outra aba. Atualize a página." });
    render(<LeadsBoard rows={[lead()]} />);

    drag("Lenita", "Agendado");

    await screen.findByText("O lead mudou em outra aba. Atualize a página.");
    // Back in "A ligar", not stranded in the column the move failed into.
    expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
  });

  it("keeps a lead who answered the bot in her own column, sorted first", () => {
    render(<LeadsBoard rows={[
      lead({ id: "fria", name: "Fria Silva", board_column: "nao_atendeu", call_attempts: 1 }),
      lead({ id: "quente", name: "Quente Souza", stage: "respondeu", board_column: "nao_atendeu", call_attempts: 1 }),
    ]} />);
    const naoAtendeu = column("Não atendeu");
    expect(within(naoAtendeu).getByText("Quente Souza")).toBeInTheDocument();
    // She answered the bot, so she is the first card in the column.
    const names = within(naoAtendeu).getAllByTitle(/Silva|Souza/).map((n) => n.textContent);
    expect(names[0]).toBe("Quente Souza");
  });

  it("shows the phone without the country code", () => {
    render(<LeadsBoard rows={[lead({ phone: "5527981820451" })]} />);
    expect(screen.getByText("27 98182-0451")).toBeInTheDocument();
  });

  it("offers no click-based way to move a card — dragging is the only path", () => {
    render(<LeadsBoard rows={[lead()]} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps the funnel stage off the card and behind Notas", () => {
    render(<LeadsBoard rows={[lead({ stage: "contatado", board_column: "agendado" })]} />);
    expect(screen.queryByText(/etapa:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Notas/ })).toBeInTheDocument();
  });

  describe("notas", () => {
    it("marks a card that already has something written", () => {
      render(<LeadsBoard rows={[
        lead({ id: "com", name: "Com Nota", notes: "não quis falar" }),
        lead({ id: "sem", name: "Sem Nota" }),
      ]} />);
      const buttons = screen.getAllByRole("button", { name: /^Notas/ });
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain("Notas •");
      expect(labels).toContain("Notas");
    });

    it("opens the drawer with who she is and when she arrived", async () => {
      render(<LeadsBoard rows={[lead({
        name: "Lenita Alvarez",
        email: "lenita@exemplo.com",
        stage: "respondeu",
        created_at: "2026-08-14T15:30:00Z",
      })]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("Lenita Alvarez")).toBeInTheDocument();
      expect(within(drawer).getByText("lenita@exemplo.com")).toBeInTheDocument();
      expect(within(drawer).getByText("27 98182-0451")).toBeInTheDocument();
      // The funnel stage moved here from the card.
      expect(within(drawer).getByText("Respondeu")).toBeInTheDocument();
      expect(within(drawer).getByText(/14\/08\/2026/)).toBeInTheDocument();
    });

    it("shows what was already written, and saves an edit", async () => {
      render(<LeadsBoard rows={[lead({ notes: "ligou, pediu para chamar amanhã" })]} />);
      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const field = await screen.findByLabelText("Observações");
      expect(field).toHaveValue("ligou, pediu para chamar amanhã");

      fireEvent.change(field, { target: { value: "marcou para quinta 14h" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      await waitFor(() => expect(updateFormLeadNotes).toHaveBeenCalledTimes(1));
      expect(updateFormLeadNotes).toHaveBeenCalledWith("l1", "marcou para quinta 14h");
    });

    it("does not offer Salvar until something actually changed", async () => {
      render(<LeadsBoard rows={[lead({ notes: "já escrito" })]} />);
      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const save = await screen.findByRole("button", { name: "Salvar" });
      expect(save).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Observações"), { target: { value: "mudou" } });
      expect(save).toBeEnabled();
    });

    it("surfaces a save failure instead of pretending it worked", async () => {
      updateFormLeadNotes.mockResolvedValue({ error: "Não foi possível salvar a observação." });
      render(<LeadsBoard rows={[lead()]} />);
      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      fireEvent.change(await screen.findByLabelText("Observações"), { target: { value: "algo" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

      expect(await screen.findByText("Não foi possível salvar a observação.")).toBeInTheDocument();
    });

    it("closes on Escape and on the ✕", async () => {
      render(<LeadsBoard rows={[lead()]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));
      await screen.findByRole("dialog");
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));
      await screen.findByRole("dialog");
      fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("opening notes does not move the card", async () => {
      render(<LeadsBoard rows={[lead()]} />);
      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));
      await screen.findByRole("dialog");
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });
  });

  describe("voltar para A ligar", () => {
    it("asks before throwing away a call history, and does nothing on cancel", () => {
      render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 2 })]} />);
      drag("Lenita", "A ligar");

      // The modal names what is about to be lost, so the caller can weigh it.
      expect(within(modal("Começar do zero?")).getByText(/2 tentativas/)).toBeInTheDocument();
      fireEvent.click(within(modal("Começar do zero?")).getByRole("button", { name: "Cancelar" }));

      expect(updateFormLeadBoard).not.toHaveBeenCalled();
      expect(within(column("Não atendeu")).getByText("Lenita")).toBeInTheDocument();
    });

    it("moves with no question when there is nothing to lose", async () => {
      render(<LeadsBoard rows={[lead({ board_column: "qualificado" })]} />);
      drag("Lenita", "A ligar");
      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", null, {
        registerAttempt: false,
        callbackAtIso: null,
      });
    });

    it("clears the attempt badge and the note on the card right away", async () => {
      updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 0, nextCallAt: null });
      render(
        <LeadsBoard
          rows={[lead({ board_column: "nao_atendeu", call_attempts: 2, notes: "atendeu a filha" })]}
        />,
      );
      expect(screen.getByText("2ª")).toBeInTheDocument();
      // The bullet is the card's "this lead has a note" marker.
      expect(screen.getByRole("button", { name: /^Notas •/ })).toBeInTheDocument();
      drag("Lenita", "A ligar");
      fireEvent.click(screen.getByRole("button", { name: "Sim, começar do zero" }));

      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText("2ª")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /^Notas •/ })).not.toBeInTheDocument();
    });
  });

  describe("drag and drop", () => {
    it("does nothing when a card is dropped back on its own column", () => {
      render(<LeadsBoard rows={[lead()]} />);
      drag("Lenita", "A ligar");
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });

    it("never fires the drop when dragOver did not preventDefault", () => {
      // Guards the classic native-DnD bug: without preventDefault on dragOver the
      // browser refuses the drop entirely and the board goes quietly dead.
      render(<LeadsBoard rows={[lead()]} />);
      const target = column("Removido");
      const transfer = dataTransfer();
      fireEvent.dragStart(cardFor("Lenita"), { dataTransfer: transfer });
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      target.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
    });
  });
});
