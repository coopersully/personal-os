// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MutationFeedback } from "./mutation-feedback.js";

describe("MutationFeedback", () => {
  it("only announces ongoing conditions, politely", () => {
    const { rerender } = render(<MutationFeedback feedback={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <MutationFeedback
        feedback={{ kind: "retryable", fields: {}, persistent: false, message: "Try again." }}
      />,
    );
    expect(screen.queryByText("Try again.")).not.toBeInTheDocument();
    rerender(
      <MutationFeedback
        feedback={{ kind: "access", fields: {}, persistent: true, message: "Sign in again." }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sign in again.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
