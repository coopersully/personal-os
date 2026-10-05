// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PaintBrushIcon, SparklesIcon, UserIcon } from "@/components/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsSearch } from "./settings-search.js";

function Location() {
  return <output aria-label="Location">{useLocation().search}</output>;
}
function setup() {
  render(
    <MemoryRouter initialEntries={["/settings?section=rituals"]}>
      <TooltipProvider>
        <SettingsSearch
          groups={[
            { label: "Account", items: [{ id: "profile", label: "Account", icon: UserIcon }] },
            { label: "Personal", items: [{ id: "rituals", label: "Rituals", icon: SparklesIcon }] },
            {
              label: "Experience",
              items: [{ id: "appearance", label: "Appearance", icon: PaintBrushIcon }],
            },
          ]}
        />
        <Location />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe("Settings search", () => {
  it("finds preferences across sections by topic and navigates without retaining the search", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Search settings" }));
    const input = screen.getByRole("searchbox", { name: "Search all settings" });
    expect(input).toHaveFocus();
    await user.type(input, "time zone");
    const results = screen.getByRole("navigation", { name: "Settings search results" });
    expect(within(results).getByRole("link", { name: /^Account Your/ })).toBeInTheDocument();
    expect(within(results).getByRole("link", { name: /^Rituals Shape/ })).toBeInTheDocument();
    expect(
      within(results).queryByRole("link", { name: /^Appearance Choose/ }),
    ).not.toBeInTheDocument();
    await user.click(within(results).getByRole("link", { name: /^Account Your/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toHaveTextContent("?section=profile");
    await user.click(screen.getByRole("button", { name: "Search settings" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
  it("returns individual fields with a canonical field destination", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Search settings" }));
    await user.type(screen.getByRole("searchbox"), "working hours");
    const start = screen.getByRole("link", { name: "Day start Account" });
    expect(start).toHaveAttribute("href", "/settings?section=profile&field=profile%3Aday-start");
    expect(screen.getByRole("link", { name: "Day end Account" })).toBeInTheDocument();
    await user.click(start);
    expect(screen.getByLabelText("Location")).toHaveTextContent("field=profile%3Aday-start");
  });
  it("keeps unavailable sections out and supports no results and keyboard dismissal", async () => {
    const user = setup();
    const trigger = screen.getByRole("button", { name: "Search settings" });
    await user.click(trigger);
    await user.type(screen.getByRole("searchbox"), "invitations");
    expect(screen.getByRole("status")).toHaveTextContent("No settings found");
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "DARK");
    expect(screen.getByRole("link", { name: /^Appearance Choose/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
