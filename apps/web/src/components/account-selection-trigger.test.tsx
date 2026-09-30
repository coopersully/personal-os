// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { Popover } from "@/components/ui/popover";
import {
  AccountSelectionPopoverContent,
  AccountSelectionTrigger,
  reconnectAccountsLabel,
} from "./account-selection-trigger";

describe("AccountSelectionTrigger", () => {
  it("renders selected identities with optional artwork and attention state", () => {
    const view = render(
      <AccountSelectionTrigger
        ariaLabel="2 of 2 accounts, attention required"
        identities={[
          { avatarUrl: "https://example.com/account.png", fallback: "EX", id: "example" },
          { fallback: "IC", id: "icloud" },
        ]}
        needsAttention
        selectedCount={2}
        totalCount={2}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "2 of 2 accounts, attention required",
    });
    expect(trigger).toHaveTextContent("2/2 accounts");
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(trigger.querySelector(".account-selection-trigger__warning")).not.toBeNull();

    view.rerender(
      <AccountSelectionTrigger
        ariaLabel="1 of 1 account"
        identities={[{ fallback: "IC", id: "icloud" }]}
        selectedCount={1}
        totalCount={1}
      />,
    );
    expect(screen.getByRole("button", { name: "1 of 1 account" })).toHaveTextContent(
      "1/1 accounts",
    );
    expect(document.querySelector(".account-selection-trigger__warning")).toBeNull();
  });

  it("renders optional popover action slots", () => {
    const view = render(
      <Popover defaultOpen>
        <AccountSelectionPopoverContent
          description="Choose visible accounts"
          primaryAction={<button type="button">Reconnect</button>}
          secondaryAction={<button type="button">Manage</button>}
          title="Accounts"
        >
          Account list
        </AccountSelectionPopoverContent>
      </Popover>,
    );

    expect(screen.getByText("Accounts")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage" })).toBeVisible();

    view.rerender(
      <Popover defaultOpen>
        <AccountSelectionPopoverContent description="Choose visible accounts" title="Accounts">
          Account list
        </AccountSelectionPopoverContent>
      </Popover>,
    );
    expect(document.querySelector(".account-selection-popover__actions")).toBeNull();
  });

  it("uses concise singular and plural reconnect labels", () => {
    expect(reconnectAccountsLabel(1)).toBe("Reconnect 1 account");
    expect(reconnectAccountsLabel(4)).toBe("Reconnect 4 accounts");
  });
});
