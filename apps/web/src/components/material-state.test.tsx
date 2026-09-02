// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CircleIcon } from "@/components/icons";
import { LoadingIndicator, MaterialEmpty } from "./material-state.js";

describe("material state composition", () => {
  it("labels loading progress", () => {
    render(<LoadingIndicator label="Saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
  });

  it("uses a heading and description for empty material", () => {
    render(
      <MaterialEmpty icon={<CircleIcon />} title="Nothing here">
        Add something when you’re ready.
      </MaterialEmpty>,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Add something when you’re ready.")).toBeInTheDocument();
  });
});
