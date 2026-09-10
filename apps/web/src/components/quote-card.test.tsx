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

  it("renders author-only and source-only attribution without a separator", () => {
    render(
      <>
        <QuoteCard author="Anne Lamott" label="Author only" text="Take a breath." />
        <QuoteCard label="Source only" source="A field note" text="Leave some room." />
      </>,
    );

    const authorCard = screen.getByLabelText("Author only");
    expect(within(authorCard).getByText("Anne Lamott")).toBeVisible();
    expect(within(authorCard).queryByText("·")).not.toBeInTheDocument();

    const sourceCard = screen.getByLabelText("Source only");
    expect(within(sourceCard).getByText("A field note")).toBeVisible();
    expect(within(sourceCard).queryByText("·")).not.toBeInTheDocument();
  });
});
