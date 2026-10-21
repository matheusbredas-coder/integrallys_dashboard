import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("./actions", () => ({
  updateFormLeadBoard: vi.fn(),
  updateFormLeadNotes: vi.fn(async (_id: string, notes: string) => ({ ok: true, notes })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { QualifiedLeads } from "./qualified-leads";
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

const rows = [
  lead({ id: "a", name: "Ana", board_column: "qualificado", submitted_at: "2026-09-15T14:00:00Z" }),
  lead({ id: "b", name: "Bia", board_column: "qualificado", submitted_at: "2026-01-10T14:00:00Z" }),
  lead({ id: "c", name: "Carla", board_column: "agendado", submitted_at: "2026-09-15T14:00:00Z" }),
];

describe("QualifiedLeads", () => {
  it("shows every qualified lead by default, and only those", () => {
    render(<QualifiedLeads rows={rows} />);
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Bia")).toBeInTheDocument();
    expect(screen.queryByText("Carla")).not.toBeInTheDocument();
    expect(screen.getByText("2 leads")).toBeInTheDocument();
  });

  it("narrows to the form day picked, and Todos brings everyone back", () => {
    render(<QualifiedLeads rows={rows} />);
    fireEvent.change(screen.getByLabelText("Dia do formulário"), { target: { value: "2026-09-15" } });
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("Bia")).not.toBeInTheDocument();
    expect(screen.getByText("1 lead")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("Bia")).toBeInTheDocument();
  });

  it("says so when nobody was qualified that day", () => {
    render(<QualifiedLeads rows={rows} />);
    fireEvent.change(screen.getByLabelText("Dia do formulário"), { target: { value: "2026-09-16" } });
    expect(screen.getByText("Nenhuma lead qualificada com formulário em 16/09/2026")).toBeInTheDocument();
  });

  it("opens the notes drawer from a card", () => {
    render(<QualifiedLeads rows={rows} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Notas/ })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
