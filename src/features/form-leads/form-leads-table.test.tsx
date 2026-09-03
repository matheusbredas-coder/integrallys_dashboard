import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const updateFormLeadStage = vi.fn(async () => ({ ok: true as const }));
const previewFormLeadsCsv = vi.fn();
const commitFormLeadsCsv = vi.fn();
vi.mock("./actions", () => ({
  updateFormLeadStage: (...args: unknown[]) => updateFormLeadStage(...args),
  previewFormLeadsCsv: (...args: unknown[]) => previewFormLeadsCsv(...args),
  commitFormLeadsCsv: (...args: unknown[]) => commitFormLeadsCsv(...args),
}));

import { FormLeadsTable } from "./form-leads-table";
import type { FormLeadRow } from "./types";

beforeEach(() => {
  previewFormLeadsCsv.mockReset();
  commitFormLeadsCsv.mockReset();
});

function pickCsvFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "leads.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

test("shows a preview after picking a file, and only commits on Confirmar", async () => {
  previewFormLeadsCsv.mockResolvedValue({
    ok: true,
    summary: { total: 3, new: 2, duplicate: 1, invalid: 0 },
  });
  commitFormLeadsCsv.mockResolvedValue({ ok: true, inserted: 2, duplicate: 1, invalid: 0 });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\nl:2,Bea\nl:3,Ana\n");

  await waitFor(() => expect(previewFormLeadsCsv).toHaveBeenCalled());
  expect(await screen.findByText(/2 leads novos, 1 já existem, 0 inválidos/)).toBeTruthy();
  expect(commitFormLeadsCsv).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Confirmar"));
  await waitFor(() => expect(commitFormLeadsCsv).toHaveBeenCalled());
  expect(await screen.findByText(/2 leads novos adicionados, 1 já existiam, 0 inválidos/)).toBeTruthy();
});

test("Cancelar clears the preview without committing", async () => {
  previewFormLeadsCsv.mockResolvedValue({
    ok: true,
    summary: { total: 1, new: 1, duplicate: 0, invalid: 0 },
  });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\n");

  await screen.findByText("Confirmar");
  fireEvent.click(screen.getByText("Cancelar"));

  await waitFor(() => expect(screen.queryByText("Confirmar")).toBeNull());
  expect(commitFormLeadsCsv).not.toHaveBeenCalled();
});

test("a preview error surfaces without offering Confirmar", async () => {
  previewFormLeadsCsv.mockResolvedValue({ error: "Sessão expirada. Entre novamente." });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\n");

  expect(await screen.findByText("Sessão expirada. Entre novamente.")).toBeTruthy();
  expect(screen.queryByText("Confirmar")).toBeNull();
});

function row(id: string, name: string | null): FormLeadRow {
  return {
    id, source: "meta", external_id: null, sheet_row: null, campaign: null, form_name: null,
    name, phone: null, email: null, raw: {}, protocolo: "emagrecimento", stage: "novo",
    notes: null, submitted_at: null, created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z", board_column: null, call_attempts: 0,
    last_call_at: null, next_call_at: null,
  };
}

function namesInOrder() {
  return Array.from(document.querySelectorAll("tbody tr td:first-child")).map((el) => el.textContent);
}

test("clicking Nome cycles A-Z, Z-A, then back to the order the server sent", () => {
  // Server order is by date, newest first — deliberately not alphabetical.
  render(<FormLeadsTable rows={[row("1", "Carla"), row("2", "ana"), row("3", "Bruno")]} />);
  expect(namesInOrder()).toEqual(["Carla", "ana", "Bruno"]);

  const header = screen.getByRole("button", { name: /Nome/ });

  fireEvent.click(header);
  expect(namesInOrder()).toEqual(["ana", "Bruno", "Carla"]);

  fireEvent.click(header);
  expect(namesInOrder()).toEqual(["Carla", "Bruno", "ana"]);

  fireEvent.click(header);
  expect(namesInOrder()).toEqual(["Carla", "ana", "Bruno"]);
});

test("leads with no name stay at the bottom in both directions", () => {
  render(<FormLeadsTable rows={[row("1", null), row("2", "Bruno"), row("3", "Ana")]} />);
  const header = screen.getByRole("button", { name: /Nome/ });

  fireEvent.click(header);
  expect(namesInOrder()).toEqual(["Ana", "Bruno", "—"]);

  fireEvent.click(header);
  expect(namesInOrder()).toEqual(["Bruno", "Ana", "—"]);
});
