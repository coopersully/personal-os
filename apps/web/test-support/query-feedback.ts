import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { expect, vi } from "vitest";

export function watchQueryFeedback() {
  vi.spyOn(toast, "error");
}
export async function expectQueryToast(message: string) {
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, expect.any(Object)));
  expect(screen.queryByText(message)).not.toBeInTheDocument();
}
export function retryQueryToast(message: string) {
  const action = vi
    .mocked(toast.error)
    .mock.calls.findLast(([title]) => title === message)?.[1]?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error(`No retry for ${message}`);
  action.onClick({} as never);
}
