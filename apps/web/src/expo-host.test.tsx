// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ prepared: 0 }));
vi.mock("./styles.css", () => ({}));
vi.mock("./web-root.js", () => ({
  prepareWebDocument: () => {
    h.prepared += 1;
  },
  WebRoot: () => <main>shared web ui</main>,
}));

it("prepares the document once and renders the shared web UI", async () => {
  const { ExpoWebHost } = await import("./expo-host.js");
  expect(h.prepared).toBe(1);
  render(<ExpoWebHost />);
  expect(screen.getByText("shared web ui")).toBeInTheDocument();
  expect(h.prepared).toBe(1);
});
