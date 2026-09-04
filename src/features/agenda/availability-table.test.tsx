import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";

const setAgendaBlocks = vi.fn(async () => ({ ok: true as const }));
vi.mock("./actions", () => ({ refreshAgenda: vi.fn(), setAgendaBlocks: (...args: unknown[]) => setAgendaBlocks(...(args as [])) }));

import { AvailabilityTable } from "./availability-table";
import type { AgendaWeek } from "./types";

const H = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

const week: AgendaWeek = {
  weekStartISO: "2026-08-31",
  offset: 0,
  fetchedAt: "09:00",
  days: [
    {
      dateISO: "2026-09-03",
      weekday: 4,
      outcome: "ok",
      slots: [{ time: "13:30", startMin: H("13:30"), endMin: H("14:00"), deadTime: 0, anchor: "booking" }],
      bookings: [{ startMin: H("12:00"), endMin: H("13:00") }],
      bookedCount: 1,
      blockedStarts: [],
      openedStarts: [],
    },
  ],
};

const withBlocks = (blockedStarts: number[]): AgendaWeek => ({
  ...week,
  days: [{ ...week.days[0]!, blockedStarts }],
});

const withOpened = (openedStarts: number[]): AgendaWeek => ({
  ...week,
  days: [{ ...week.days[0]!, openedStarts }],
});

/** The row whose first cell is `time`, as the caller reads it: across the clock. */
function row(time: string) {
  const th = screen.getByText(time);
  return th.closest("tr")!;
}

/** The clickable half hour in `time`'s row. Absent on a booked or past cell. */
function slot(time: string) {
  return within(row(time)).getByRole("button");
}

const saveButton = () => screen.getByRole("button", { name: /^Salvar/ });

/** Click without dragging: down and up on the same cell. */
function click(time: string) {
  fireEvent.pointerDown(slot(time));
  fireEvent.pointerUp(slot(time));
}

beforeEach(() => {
  setAgendaBlocks.mockClear();
  setAgendaBlocks.mockResolvedValue({ ok: true as const });
});

test("draws a fixed half-hour ladder across the clinic's whole day", () => {
  render(<AvailabilityTable week={week} />);
  for (const time of ["11:30", "12:00", "12:30", "15:30", "18:00"]) {
    expect(screen.getByText(time)).toBeTruthy();
  }
});

test("crosses out every half hour an appointment covers", () => {
  render(<AvailabilityTable week={week} />);
  // Both halves of the hour-long booking: each one is its own cell to act on.
  expect(within(row("12:00")).getByText("×")).toBeTruthy();
  expect(within(row("12:30")).getByText("×")).toBeTruthy();
  expect(within(row("12:30")).getByTitle(/ocupado/)).toBeTruthy();
});

test("never says bloqueado in words — the cross is the whole vocabulary", () => {
  render(<AvailabilityTable week={week} />);
  expect(screen.queryByText("bloqueado")).toBeNull();
});

test("never names a patient", () => {
  render(<AvailabilityTable week={week} />);
  expect(screen.queryByText(/maria/i)).toBeNull();
});

test("does not mark offerable times — busy or blank only", () => {
  render(<AvailabilityTable week={week} />);
  expect(screen.queryByText("vaga")).toBeNull();
  expect(within(row("13:30")).getByText("—")).toBeTruthy();
});

test("opening a booked half hour hands it back out", async () => {
  render(<AvailabilityTable week={week} />);
  click("12:00");
  expect(within(row("12:00")).getByTitle(/marcado para liberar/)).toBeTruthy();

  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("12:00")], "open"));
  // Reads as available, like any other free half hour.
  expect(within(row("12:00")).getByText("—")).toBeTruthy();
  expect(within(row("12:00")).getByTitle(/liberado por vocês/)).toBeTruthy();
});

test("clicking an opened half hour puts the appointment back", async () => {
  render(<AvailabilityTable week={withOpened([H("12:00")])} />);
  expect(within(row("12:00")).getByText("—")).toBeTruthy();

  click("12:00");
  expect(within(row("12:00")).getByTitle(/marcado para voltar a ficar ocupado/)).toBeTruthy();
  // Withdrawing the decision, not writing a block: the row is deleted.
  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("12:00")], null));
  expect(within(row("12:00")).getByText("×")).toBeTruthy();
});

test("a drag that starts on a booked cell opens what it crosses, both kinds", async () => {
  // 12:30 is booked, 13:00 and 13:30 are free — the sweep must free the booked one
  // and leave the already-free ones alone rather than blocking them.
  render(<AvailabilityTable week={week} />);
  fireEvent.pointerDown(slot("12:30"));
  fireEvent.pointerEnter(slot("13:00"));
  fireEvent.pointerUp(slot("13:00"));

  expect(saveButton().textContent).toBe("Salvar 1 horário");
  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("12:30")], "open"));
});

test("opening a blocked half hour withdraws the block instead of overruling Gestek", async () => {
  render(<AvailabilityTable week={withBlocks([H("13:30")])} />);
  click("13:30");
  fireEvent.click(saveButton());

  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30")], null));
  // Withdrawn, not reopened: the cell goes back to being an ordinary free one.
  expect(within(row("13:30")).getByTitle(/livre/)).toBeTruthy();
});

test("marking a half hour writes nothing until Salvar is pressed", () => {
  render(<AvailabilityTable week={week} />);
  click("13:30");

  expect(within(row("13:30")).getByText("×")).toBeTruthy();
  expect(within(row("13:30")).getByTitle(/marcado para bloquear/)).toBeTruthy();
  expect(setAgendaBlocks).not.toHaveBeenCalled();
});

test("the button counts what is waiting to be saved", () => {
  render(<AvailabilityTable week={week} />);
  click("13:30");
  expect(saveButton().textContent).toBe("Salvar 1 horário");
  click("14:00");
  expect(saveButton().textContent).toBe("Salvar 2 horários");
});

test("Salvar files the marks and settles the cells", async () => {
  render(<AvailabilityTable week={week} />);
  click("13:30");
  fireEvent.click(saveButton());

  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30")], "block"));
  // Settled: no longer a mark waiting, and the cell reads like any other taken one.
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Salvar/ })).toBeNull());
  expect(within(row("13:30")).getByTitle(/bloqueado por vocês/)).toBeTruthy();
});

test("dragging down the column marks every half hour it crosses, in one save", async () => {
  render(<AvailabilityTable week={week} />);
  fireEvent.pointerDown(slot("13:30"));
  fireEvent.pointerEnter(slot("14:00"));
  fireEvent.pointerEnter(slot("14:30"));
  fireEvent.pointerUp(slot("14:30"));

  for (const time of ["13:30", "14:00", "14:30"]) {
    expect(within(row(time)).getByText("×")).toBeTruthy();
  }
  expect(setAgendaBlocks).not.toHaveBeenCalled();

  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledTimes(1));
  expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30"), H("14:00"), H("14:30")], "block");
});

test("a drag keeps the direction its first cell set, instead of inverting each one", async () => {
  // Sweeping from a free cell over a blocked one must not leave the blocked one open.
  render(<AvailabilityTable week={withBlocks([H("14:00")])} />);
  fireEvent.pointerDown(slot("13:30"));
  fireEvent.pointerEnter(slot("14:00"));
  fireEvent.pointerUp(slot("14:00"));

  // 14:00 was already blocked, so only 13:30 is a change worth saving.
  expect(saveButton().textContent).toBe("Salvar 1 horário");
  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30")], "block"));
  expect(within(row("14:00")).getByText("×")).toBeTruthy();
});

test("marking a saved block frees it, once saved", async () => {
  render(<AvailabilityTable week={withBlocks([H("13:30")])} />);
  click("13:30");
  expect(within(row("13:30")).getByTitle(/marcado para liberar/)).toBeTruthy();

  fireEvent.click(saveButton());
  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30")], null));
  expect(within(row("13:30")).getByText("—")).toBeTruthy();
});

test("blocks and releases in the same save go as two calls, one per direction", async () => {
  render(<AvailabilityTable week={withBlocks([H("13:30")])} />);
  click("13:30"); // release this one
  click("14:00"); // block that one
  fireEvent.click(saveButton());

  await waitFor(() => expect(setAgendaBlocks).toHaveBeenCalledTimes(2));
  expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("14:00")], "block");
  expect(setAgendaBlocks).toHaveBeenCalledWith("2026-09-03", [H("13:30")], null);
});

test("marking a cell twice leaves nothing to save", () => {
  render(<AvailabilityTable week={week} />);
  click("13:30");
  click("13:30");
  expect(screen.queryByRole("button", { name: /^Salvar/ })).toBeNull();
  expect(within(row("13:30")).getByText("—")).toBeTruthy();
});

test("Descartar throws the marks away and writes nothing", () => {
  render(<AvailabilityTable week={week} />);
  click("13:30");
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

  expect(within(row("13:30")).getByText("—")).toBeTruthy();
  expect(setAgendaBlocks).not.toHaveBeenCalled();
});

test("moving over the grid without holding the button changes nothing", () => {
  render(<AvailabilityTable week={week} />);
  fireEvent.pointerEnter(slot("13:30"));
  expect(within(row("13:30")).getByText("—")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Salvar/ })).toBeNull();
});

test("a refused save keeps the marks, so Salvar can be pressed again", async () => {
  setAgendaBlocks.mockResolvedValueOnce({ error: "Sessão expirada. Entre novamente." } as never);
  render(<AvailabilityTable week={week} />);
  click("13:30");
  fireEvent.click(saveButton());

  await waitFor(() => expect(screen.getByText(/Sessão expirada/)).toBeTruthy());
  // Still gold, still counted: nothing was written, and the drag is not lost.
  expect(saveButton().textContent).toBe("Salvar 1 horário");
  expect(within(row("13:30")).getByTitle(/marcado para bloquear/)).toBeTruthy();
});

test("the keyboard can mark a half hour too", () => {
  render(<AvailabilityTable week={week} />);
  fireEvent.keyDown(slot("13:30"), { key: "Enter" });

  expect(within(row("13:30")).getByText("×")).toBeTruthy();
  expect(saveButton().textContent).toBe("Salvar 1 horário");
});
