// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";
import { beginPetAppearance, savePetAppearance } from "./bridge";
import { usePetAppearance } from "./use-pet-appearance";

vi.mock("./bridge", () => ({
  beginPetAppearance: vi.fn(),
  savePetAppearance: vi.fn(),
  previewPetAppearance: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it.each(["edit", "retry"])("recovers a rejected session on a later %s", async (mode) => {
  vi.mocked(beginPetAppearance).mockRejectedValue(new Error("temporarily unavailable"));
  const { result } = renderHook(() => usePetAppearance("https://example.test|a", vi.fn()));
  act(() => {
    result.current.change({ color: "#123456", scale: 1, revision: 1 });
    result.current.commit();
  });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t save pet appearance.", expect.anything()),
  );
  vi.mocked(beginPetAppearance).mockResolvedValue({
    serverUrl: "https://example.test",
    accountId: "a",
    sessionId: "recovered",
  });
  if (mode === "edit")
    act(() => {
      result.current.change({ color: "#654321", scale: 1, revision: 2 });
      result.current.commit();
    });
  else {
    const options = vi
      .mocked(toast.error)
      .mock.calls.find(([message]) => message === "Couldn’t save pet appearance.")?.[1];
    const action = options?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("Missing retry");
    act(() => action.onClick({} as never));
  }
  await waitFor(() =>
    expect(savePetAppearance).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "recovered",
        color: mode === "edit" ? "#654321" : "#123456",
      }),
    ),
  );
});

it("rejects a native session for a different account before sending appearance changes", async () => {
  vi.mocked(beginPetAppearance).mockResolvedValue({
    serverUrl: "https://example.test",
    accountId: "other",
    sessionId: "wrong-account",
  });
  const { result } = renderHook(() => usePetAppearance("https://example.test|a", vi.fn()));
  act(() => {
    result.current.change({ color: "#123456", scale: 1, revision: 1 });
    result.current.commit();
  });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t save pet appearance.", expect.anything()),
  );
  expect(savePetAppearance).not.toHaveBeenCalled();
});

it("flushes the last edit on unmount and reports a failed flush without a dead retry", async () => {
  vi.mocked(beginPetAppearance).mockResolvedValue({
    serverUrl: "https://example.test",
    accountId: "a",
    sessionId: "valid",
  });
  vi.mocked(savePetAppearance).mockRejectedValue(new Error("offline"));
  const onSaved = vi.fn();
  const { result, unmount } = renderHook(() => usePetAppearance("https://example.test|a", onSaved));
  act(() => {
    result.current.change({ color: "#123456", scale: 1, revision: 1 });
    result.current.change({ color: "#654321", scale: 2, revision: 2 });
  });
  unmount();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t save pet appearance. Reopen pet settings to retry.",
      { id: "pet-appearance-save" },
    ),
  );
  expect(savePetAppearance).toHaveBeenCalledWith(
    expect.objectContaining({ color: "#654321", scale: 2, revision: 2 }),
  );
  expect(onSaved).not.toHaveBeenCalled();
});
