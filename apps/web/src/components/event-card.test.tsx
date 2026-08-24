// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarIcon } from "@/components/icons";
import {
  EventCard,
  EventCardAside,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardFooter,
  EventCardIndicator,
  EventCardPrimaryAction,
  EventCardTime,
  EventCardTitle,
} from "./event-card";

describe("EventCard", () => {
  it("keeps the primary event action separate from optional supporting actions", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(
      <EventCard>
        <EventCardContent>
          <EventCardTime>9:30 AM</EventCardTime>
          <EventCardIndicator />
          <EventCardPrimaryAction aria-label="Design review. Open details" onClick={onOpen}>
            <EventCardBody>
              <EventCardTitle>Design review</EventCardTitle>
              <EventCardDescription>Product calendar · 45 min</EventCardDescription>
            </EventCardBody>
          </EventCardPrimaryAction>
          <EventCardAside>
            <CalendarIcon aria-label="Local calendar" role="img" />
          </EventCardAside>
        </EventCardContent>
        <EventCardFooter>
          <span>In progress</span>
          <a href="https://meet.example.com/design-review">Join meeting</a>
        </EventCardFooter>
      </EventCard>,
    );

    await user.click(screen.getByRole("button", { name: "Design review. Open details" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute(
      "href",
      "https://meet.example.com/design-review",
    );
    expect(screen.getByRole("img", { name: "Local calendar" })).toBeInTheDocument();
  });

  it("supports a static inverse composition with optional slots omitted", () => {
    render(
      <EventCard tone="inverse">
        <EventCardContent>
          <EventCardBody>
            <EventCardTitle>Design review</EventCardTitle>
          </EventCardBody>
        </EventCardContent>
      </EventCard>,
    );

    expect(screen.getByText("Design review")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
