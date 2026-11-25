// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Unmatched } from "expo-router";
import { afterEach, expect, it, vi } from "vitest";
import WebRootLayout from "../app/_layout.web";
import NativeNotFound from "../app/+not-found";
import WebNotFound from "../app/+not-found.web";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("expo-router", () => ({ Unmatched: () => <p>unmatched</p> }));
vi.mock("@personal-os/web/expo-host", () => ({ ExpoWebHost: () => <main>shared web ui</main> }));

afterEach(cleanup);

it("renders the shared web UI as the web root", () => {
  render(<WebRootLayout />);
  expect(screen.getByText("shared web ui")).toBeTruthy();
});

it("leaves unmatched web paths to the shared web UI", () => {
  const { container } = render(<WebNotFound />);
  expect(container.innerHTML).toBe("");
});

it("keeps Expo Router's unmatched screen on native", () => {
  expect(NativeNotFound).toBe(Unmatched);
});
