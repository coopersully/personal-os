// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDraftField } from "./form-state";

// Match the repository DOM renderer; Expo has a separate React version.
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});

describe("form edit tracking", () => {
  it("initializes asynchronous defaults without marking a user edit", () => {
    const mark = vi.fn();
    const { result } = renderHook(() => useDraftField("", mark));
    act(() => result.current[2]("inbox"));
    expect(result.current[0]).toBe("inbox");
    expect(mark).not.toHaveBeenCalled();
  });
  it("marks explicit changes, including returning to the original value", () => {
    const mark = vi.fn();
    const { result } = renderHook(() => useDraftField("Original", mark));
    act(() => result.current[1]("Edited"));
    act(() => result.current[1]("Original"));
    expect(result.current[0]).toBe("Original");
    expect(mark).toHaveBeenCalledTimes(2);
  });
});
