import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type BoardOpts = { registerAttempt?: boolean; callbackAtIso?: string | null };
type BoardResult =
  | { ok: true; attempts: number; nextCallAt: string | null; callLog: string[] }
  | { error: string };

const updateFormLeadBoard =
  vi.fn<(id: string, column: string | null, opts?: BoardOpts) => Promise<BoardResult>>(
    async () => ({ ok: true, attempts: 1, nextCallAt: null, callLog: [] }),
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
    call_log: [],
    ...over,
  };
}

/** A board column by its visible label. */
function column(label: string): HTMLElement {
  return screen.getByRole("group", { name: label });
}

/**
 * The card element for a lead, found by the name it renders. Scoped to .board-card
 * because the destination bar names the selected lead too, so the name alone is
 * ambiguous the moment a card is picked.
 */
function cardFor(name: string): HTMLElement {
  const card = screen
    .getAllByText(name)
    .map((el) => el.closest(".board-card"))
    .find(Boolean);
  if (!card) throw new Error(`Nenhum card para ${name}`);
  return card as HTMLElement;
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
 * Turn the board into a phone. `(pointer: coarse)` matching is the ONE thing that
 * enables tap-to-move, and jsdom implements no matchMedia at all — so this is a stub
 * installed before render, not a spy, and afterEach takes it back off again.
 */
function touchScreen() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** The destination bar that a selected card opens. */
function moveBar(): HTMLElement {
  return screen.getByRole("group", { name: "Mover lead para" });
}

/** Tap a card, then tap a destination — the phone's whole move gesture. */
function tapMove(name: string, toColumn: string) {
  fireEvent.click(cardFor(name));
  fireEvent.click(within(moveBar()).getByRole("button", { name: toColumn }));
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
  updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 1, nextCallAt: null, callLog: [] });
  updateFormLeadNotes.mockClear();
  updateFormLeadNotes.mockImplementation(async (_id, notes) => ({ ok: true, notes }));
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
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
    updateFormLeadBoard.mockResolvedValue({
      ok: true, attempts: 2, nextCallAt: null,
      callLog: ["2026-09-03T17:32:00.000Z", "2026-09-03T19:40:00.000Z"],
    });
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

  it("carries no date at all on a Não atendeu card", () => {
    // The card says which try she is on; WHEN is the notes drawer's job. The board
    // used to shout a red "atrasada · 04/09" here, which on a column worked over days
    // meant nearly every card was red and none of it was information.
    render(<LeadsBoard rows={[lead({
      board_column: "nao_atendeu",
      call_attempts: 1,
      next_call_at: "2026-01-08T17:00:00Z",
    })]} />);

    const card = cardFor("Lenita");
    expect(within(card).getByText("1ª")).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/atrasada/);
    expect(card).not.toHaveTextContent(/08\/01/);
    expect(card).not.toHaveTextContent(/ligar hoje|ligar amanhã/);
  });

  it("puts Ligar and Notas below the attempt counter and its button", () => {
    render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 1 })]} />);

    const card = cardFor("Lenita");
    const order = Array.from(card.querySelectorAll("button, a"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    // "+1 tentativa" comes first, then the pair the caller uses to act on it.
    expect(order).toEqual(["+1 tentativa", "Ligar", "Notas"]);
  });

  it("leaves the card where it was when +1 tentativa is clicked", async () => {
    // The caller clicks mid-call. The card jumping down the column loses her place,
    // and until this was fixed it always did: registering a call rewrites the next
    // call date, which is what the column used to sort by.
    render(<LeadsBoard rows={[
      lead({ id: "l1", name: "Lenita", board_column: "nao_atendeu", call_attempts: 1,
             created_at: "2026-09-03T09:00:00Z", next_call_at: "2026-09-03T11:00:00Z" }),
      lead({ id: "l2", name: "Marizete", board_column: "nao_atendeu", call_attempts: 1,
             created_at: "2026-09-01T09:00:00Z", next_call_at: "2026-09-03T12:00:00Z" }),
    ]} />);

    const namesInColumn = () =>
      Array.from(column("Não atendeu").querySelectorAll(".board-card"))
        .map((card) => card.firstElementChild?.textContent);

    expect(namesInColumn()).toEqual(["Lenita", "Marizete"]);

    const lenita = cardFor("Lenita");
    fireEvent.click(within(lenita).getByRole("button", { name: "+1 tentativa" }));
    await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));

    expect(namesInColumn()).toEqual(["Lenita", "Marizete"]);
  });

  it("keeps a missed callback in plain words, never in red", () => {
    // "Retorno marcado" is the one column that still carries a date on the card: the
    // caller chose that day herself, so it is the whole reason the card is there.
    render(<LeadsBoard rows={[lead({
      board_column: "retorno",
      next_call_at: "2026-01-08T17:00:00Z",
    })]} />);

    expect(screen.getByText("retorno 08/01 14:00")).toBeInTheDocument();
    expect(screen.queryByText(/atrasada/)).not.toBeInTheDocument();
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

  it("offers no click-based way to move a card on a mouse — dragging is the only path", () => {
    // No matchMedia stub here, so the pointer is fine and the board is the desktop one.
    render(<LeadsBoard rows={[lead()]} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    // A mouse click on the card must select nothing: no bar, no move, no dialog.
    fireEvent.click(cardFor("Lenita"));
    expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
    expect(updateFormLeadBoard).not.toHaveBeenCalled();
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

    it("shows the bairro and the weight goal the lead submitted", async () => {
      render(<LeadsBoard rows={[lead({
        raw: {
          "Em qual bairro você mora?": "Praia da Costa",
          "Quantos quilos você quer perder?": "12kg",
        },
      })]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("Bairro")).toBeInTheDocument();
      expect(within(drawer).getByText("Praia da Costa")).toBeInTheDocument();
      expect(within(drawer).getByText("Quer perder")).toBeInTheDocument();
      expect(within(drawer).getByText("12kg")).toBeInTheDocument();
    });

    it("leaves both rows out for a lead who filled the older form", async () => {
      render(<LeadsBoard rows={[lead({ raw: { "Nome completo": "Lenita" } })]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).queryByText("Bairro")).not.toBeInTheDocument();
      expect(within(drawer).queryByText("Quer perder")).not.toBeInTheDocument();
      // The rest of the card is unaffected.
      expect(within(drawer).getByText("Telefone")).toBeInTheDocument();
    });

    // They are the lead's own words, and the textarea is the caller's — she rewrites it
    // after every call, and a restart wipes it. Seeding one into the other loses them.
    it("keeps them out of the observações textarea", async () => {
      render(<LeadsBoard rows={[lead({
        notes: "atendeu, pediu para ligar depois",
        raw: { Bairro: "Itapuã", "Quantos quilos você quer perder?": "12kg" },
      })]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      const textarea = within(drawer).getByLabelText("Observações") as HTMLTextAreaElement;
      expect(textarea.value).toBe("atendeu, pediu para ligar depois");
    });

    it("lists when each call was placed", async () => {
      render(<LeadsBoard rows={[lead({
        board_column: "nao_atendeu",
        call_attempts: 2,
        last_call_at: "2026-09-03T19:40:00-03:00",
        call_log: ["2026-09-03T14:32:00-03:00", "2026-09-03T16:40:00-03:00"],
      })]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("1ª ligação")).toBeInTheDocument();
      expect(within(drawer).getByText("qui 03/09 14:32")).toBeInTheDocument();
      expect(within(drawer).getByText("2ª ligação")).toBeInTheDocument();
      expect(within(drawer).getByText("qui 03/09 16:40")).toBeInTheDocument();
    });

    it("shows the call the +1 tentativa button just registered", async () => {
      // The whole point of the history: the caller clicks, then opens Notas to write
      // what happened, and the call she just made is already listed there.
      updateFormLeadBoard.mockResolvedValue({
        ok: true, attempts: 2, nextCallAt: null,
        callLog: ["2026-09-03T17:32:00.000Z", "2026-09-03T19:40:00.000Z"],
      });
      render(<LeadsBoard rows={[lead({
        board_column: "nao_atendeu",
        call_attempts: 1,
        call_log: ["2026-09-03T14:32:00-03:00"],
      })]} />);

      fireEvent.click(screen.getByRole("button", { name: "+1 tentativa" }));
      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      // Both times come back from the action, which is what was actually stored.
      expect(within(drawer).getByText("qui 03/09 14:32")).toBeInTheDocument();
      expect(within(drawer).getByText("qui 03/09 16:40")).toBeInTheDocument();
    });

    it("says nothing about calls for a lead nobody has phoned", async () => {
      render(<LeadsBoard rows={[lead()]} />);

      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).queryByText("Ligações")).not.toBeInTheDocument();
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
      updateFormLeadBoard.mockResolvedValue({ ok: true, attempts: 0, nextCallAt: null, callLog: [] });
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

  /**
   * The phone's half of the board. jsdom implements no drag, but it implements click
   * perfectly well — so unlike the drag tests below, these exercise the real gesture
   * end to end rather than a synthetic stand-in.
   */
  describe("toque e escolhe (celular)", () => {
    beforeEach(() => touchScreen());

    it("um toque seleciona o card e abre os destinos", () => {
      render(<LeadsBoard rows={[lead()]} />);

      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
      fireEvent.click(cardFor("Lenita"));

      expect(moveBar()).toBeInTheDocument();
      expect(within(moveBar()).getByText("Lenita")).toBeInTheDocument();
      expect(cardFor("Lenita")).toHaveAttribute("data-selected", "true");
    });

    it("não oferece a coluna em que a lead já está", () => {
      render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 1 })]} />);
      fireEvent.click(cardFor("Lenita"));

      const bar = moveBar();
      // Moving onto her own column writes nothing, so it would be a dead button.
      expect(within(bar).queryByRole("button", { name: "Não atendeu" })).not.toBeInTheDocument();
      for (const label of ["A ligar", "Retorno marcado", "Qualificado", "Agendado", "Removido"]) {
        expect(within(bar).getByRole("button", { name: label })).toBeInTheDocument();
      }
    });

    it("um toque no destino move a lead", async () => {
      render(<LeadsBoard rows={[lead()]} />);

      tapMove("Lenita", "Qualificado");

      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "qualificado", {
        registerAttempt: false,
        callbackAtIso: null,
      });
      // The bar closes with the move: the card is where it was going.
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
      expect(within(column("Qualificado")).getByText("Lenita")).toBeInTheDocument();
    });

    it("herda o +1 tentativa de Não atendeu, como o arrastar", async () => {
      render(<LeadsBoard rows={[lead()]} />);

      tapMove("Lenita", "Não atendeu");

      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "nao_atendeu", {
        registerAttempt: true,
        callbackAtIso: null,
      });
    });

    it("herda o modal de Retorno marcado, e cancelar não escreve nada", () => {
      render(<LeadsBoard rows={[lead()]} />);

      tapMove("Lenita", "Retorno marcado");

      fireEvent.click(within(modal("Retorno marcado")).getByRole("button", { name: "Cancelar" }));
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
      expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
    });

    it("herda o aviso de começar do zero", () => {
      render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 2 })]} />);

      tapMove("Lenita", "A ligar");

      expect(within(modal("Começar do zero?")).getByText(/2 tentativas/)).toBeInTheDocument();
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });

    it("um toque fora cancela sem escrever nada", () => {
      render(<LeadsBoard rows={[lead()]} />);
      fireEvent.click(cardFor("Lenita"));
      expect(moveBar()).toBeInTheDocument();

      fireEvent.click(document.body);

      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
      expect(within(column("A ligar")).getByText("Lenita")).toBeInTheDocument();
    });

    it("um toque no próprio card de novo cancela", () => {
      render(<LeadsBoard rows={[lead()]} />);
      fireEvent.click(cardFor("Lenita"));
      fireEvent.click(cardFor("Lenita"));

      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });

    it("Esc cancela, e o botão Cancelar também", () => {
      render(<LeadsBoard rows={[lead()]} />);

      fireEvent.click(cardFor("Lenita"));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();

      fireEvent.click(cardFor("Lenita"));
      fireEvent.click(within(moveBar()).getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();

      expect(updateFormLeadBoard).not.toHaveBeenCalled();
    });

    it("tocar num outro card passa a seleção em vez de cancelar", () => {
      render(<LeadsBoard rows={[
        lead({ id: "a", name: "Lenita" }),
        lead({ id: "b", name: "Marcia" }),
      ]} />);

      fireEvent.click(cardFor("Lenita"));
      fireEvent.click(cardFor("Marcia"));

      expect(within(moveBar()).getByText("Marcia")).toBeInTheDocument();
      expect(cardFor("Lenita")).toHaveAttribute("data-selected", "false");
      expect(cardFor("Marcia")).toHaveAttribute("data-selected", "true");
    });

    it("os chips do card não selecionam o card debaixo deles", async () => {
      render(<LeadsBoard rows={[lead({ board_column: "nao_atendeu", call_attempts: 1 })]} />);

      // Notas opens the drawer and nothing else.
      fireEvent.click(screen.getByRole("button", { name: /^Notas/ }));
      await screen.findByRole("dialog");
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

      // "+1 tentativa" writes its own move, without ever opening the bar.
      fireEvent.click(screen.getByRole("button", { name: "+1 tentativa" }));
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();

      // And so does the dialer link.
      fireEvent.click(screen.getByTitle("Ligar para 27 98182-0451"));
      expect(screen.queryByRole("group", { name: "Mover lead para" })).not.toBeInTheDocument();
    });

    it("arrastar continua funcionando lado a lado com o toque", async () => {
      render(<LeadsBoard rows={[lead()]} />);

      drag("Lenita", "Agendado");

      await waitFor(() => expect(updateFormLeadBoard).toHaveBeenCalledTimes(1));
      expect(updateFormLeadBoard).toHaveBeenCalledWith("l1", "agendado", {
        registerAttempt: false,
        callbackAtIso: null,
      });
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
