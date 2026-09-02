// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuoteCard } from "./quote-card";

describe("QuoteCard", () => {
  it("renders optional author and source attribution", () => {
    render(
      <QuoteCard
        author="Marcus Aurelius"
        label="An open calendar"
        source="Meditations"
        text="Very little is needed to make a happy life."
      />,
    );

    const card = screen.getByLabelText("An open calendar");
    expect(within(card).getByText("Very little is needed to make a happy life.")).toBeVisible();
    expect(within(card).getByText("Marcus Aurelius")).toBeVisible();
    expect(within(card).getByText("Meditations")).toBeVisible();
  });

  it("omits attribution when a line stands on its own", () => {
    render(<QuoteCard label="An open calendar" text="Unclaimed hours." />);

    expect(screen.getByLabelText("An open calendar").querySelector("figcaption")).toBeNull();
  });
});
