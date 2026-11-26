// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./app.js", () => ({ App: () => <main>web app</main> }));
vi.mock("./features/desktop/pet-overlay.js", () => ({ PetOverlay: () => <div>pet overlay</div> }));
vi.mock("./features/tracking/ritual-overlay.js", () => ({
  RitualOverlay: () => <div>ritual overlay</div>,
}));
vi.mock("./features/desktop/updates.js", () => ({
  DesktopStartupGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./components/portfolio-cursor/portfolio-cursor.js", () => ({
  PortfolioCursor: () => null,
}));

const { createWebQueryClient, isDesktopShell, prepareWebDocument, WebRoot } = await import(
  "./web-root.js"
);

function setTauri(present: boolean) {
  if (present)
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

function setSystemDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    addEventListener() {},
    addListener() {},
    dispatchEvent: () => false,
    matches: dark && query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    removeEventListener() {},
    removeListener() {},
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  setTauri(false);
});

describe("prepareWebDocument", () => {
  it("applies the light system theme outside the desktop shell", () => {
    setSystemDark(false);
    prepareWebDocument();
    expect(document.documentElement.classList.contains("desktop")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("applies the dark system theme and desktop window classes", () => {
    setSystemDark(true);
    setTauri(true);
    window.history.replaceState(null, "", "/#ritual");
    prepareWebDocument();
    const classes = document.documentElement.classList;
    expect(classes.contains("desktop")).toBe(true);
    expect(classes.contains("dark")).toBe(true);
    expect(classes.contains("ritual-window")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    window.history.replaceState(null, "", "/#pet");
    prepareWebDocument();
    expect(classes.contains("pet-window")).toBe(true);
  });

  it("keeps window classes to the desktop shell", () => {
    setSystemDark(false);
    window.history.replaceState(null, "", "/#pet");
    prepareWebDocument();
    expect(document.documentElement.classList.contains("pet-window")).toBe(false);
  });
});

describe("createWebQueryClient", () => {
  it("uses the web query defaults", () => {
    const defaults = createWebQueryClient().getDefaultOptions().queries;
    expect(defaults?.retry).toBe(false);
    expect(defaults?.staleTime).toBe(15_000);
  });
});

describe("WebRoot", () => {
  it("renders the web app in a browser", () => {
    expect(isDesktopShell()).toBe(false);
    render(<WebRoot />);
    expect(screen.getByText("web app")).toBeInTheDocument();
  });

  it("renders the desktop overlay windows by hash", () => {
    setTauri(true);
    window.history.replaceState(null, "", "/#pet");
    const pet = render(<WebRoot />);
    expect(screen.getByText("pet overlay")).toBeInTheDocument();
    pet.unmount();

    window.history.replaceState(null, "", "/#ritual");
    render(<WebRoot />);
    expect(screen.getByText("ritual overlay")).toBeInTheDocument();
    expect(screen.queryByText("web app")).not.toBeInTheDocument();
  });
});
