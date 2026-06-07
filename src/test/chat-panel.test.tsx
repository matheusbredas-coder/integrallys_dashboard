import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "@/features/chat/chat-panel";

const STORAGE_KEY = "integrallys_chat";
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
  // jsdom does not implement scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders input and send button", () => {
  render(<ChatPanel />);
  expect(screen.getByPlaceholderText(/pergunte sobre/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /enviar/i })).toBeInTheDocument();
});

test("renders hint text when no messages", () => {
  render(<ChatPanel />);
  expect(screen.getByText(/quanto faturamos/i)).toBeInTheDocument();
});

test("loads persisted messages from localStorage if date matches today", () => {
  const stored = { date: today, messages: [{ role: "user", content: "Olá" }] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  render(<ChatPanel />);
  expect(screen.getByText("Olá")).toBeInTheDocument();
});

test("does not load messages if stored date is not today", () => {
  const stored = { date: "2000-01-01", messages: [{ role: "user", content: "Velho" }] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  render(<ChatPanel />);
  expect(screen.queryByText("Velho")).not.toBeInTheDocument();
});

test("saves messages to localStorage after sending", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("Resposta"));
      controller.close();
    },
  });
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, body: stream });

  render(<ChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/pergunte sobre/i), { target: { value: "teste" } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

  await waitFor(() => expect(screen.getByText("Resposta")).toBeInTheDocument());

  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.date).toBe(today);
  expect(saved.messages.some((m: { content: string }) => m.content === "teste")).toBe(true);
});

test("shows error message when fetch returns non-ok status", async () => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 401, body: null });

  render(<ChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/pergunte sobre/i), { target: { value: "teste erro" } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

  await waitFor(() =>
    expect(screen.getByText("Desculpe — algo deu errado.")).toBeInTheDocument()
  );
});
