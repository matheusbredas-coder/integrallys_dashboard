import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/theme-toggle";

// jsdom provides localStorage automatically; reset between tests
beforeEach(() => {
  localStorage.clear();
  delete (document.documentElement.dataset as { theme?: string }).theme;
});

test("renders dark button as active by default", () => {
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: /escuro/i })).toHaveAttribute(
    "data-active",
    "true"
  );
  expect(screen.getByRole("button", { name: /claro/i })).toHaveAttribute(
    "data-active",
    "false"
  );
});

test("renders light button as active when localStorage has theme=light", () => {
  localStorage.setItem("theme", "light");
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: /claro/i })).toHaveAttribute(
    "data-active",
    "true"
  );
});

test("clicking Claro sets data-theme=light and persists to localStorage", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: /claro/i }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("theme")).toBe("light");
});

test("clicking Escuro removes data-theme and persists to localStorage", () => {
  localStorage.setItem("theme", "light");
  document.documentElement.dataset.theme = "light";
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: /escuro/i }));
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(localStorage.getItem("theme")).toBe("dark");
});
