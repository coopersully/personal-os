// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { MutationFeedback } from "./mutation-feedback";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
describe("MutationFeedback", () => {
  it("announces custom feedback once without adding any layout content", () => {
    vi.clearAllMocks();
    const feedback = {
      kind: "uncertain" as const,
      fields: {},
      persistent: true,
      message: "Check the latest state before retrying.",
    };
    const { container, rerender } = render(<MutationFeedback feedback={feedback} />);
    expect(container).toBeEmptyDOMElement();
    expect(toast.error).toHaveBeenCalledWith(feedback.message, expect.anything());
    rerender(<MutationFeedback feedback={feedback} />);
    expect(toast.error).toHaveBeenCalledOnce();
    rerender(<MutationFeedback feedback={null} />);
    expect(toast.dismiss).toHaveBeenCalled();
  });
  it("does not duplicate feedback already announced by the mutation hook", () => {
    vi.clearAllMocks();
    const { container } = render(
      <MutationFeedback
        feedback={{
          kind: "access",
          fields: {},
          persistent: true,
          message: "Sign in again.",
          toastId: "attempt-1",
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

it("restores custom feedback after Strict Mode replays effects using the same toast identity", () => {
  vi.clearAllMocks();
  const { container } = render(
    <StrictMode>
      <MutationFeedback
        feedback={{
          kind: "uncertain",
          fields: {},
          persistent: true,
          message: "Check the saved draft before retrying.",
        }}
      />
    </StrictMode>,
  );
  expect(container).toBeEmptyDOMElement();
  const calls = vi.mocked(toast.error).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]?.[1]?.id).toBe(calls[1]?.[1]?.id);
  expect(vi.mocked(toast.dismiss).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(toast.error).mock.invocationCallOrder[1] ?? 0,
  );
});
