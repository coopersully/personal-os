// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { Popover } from "@/components/ui/popover";
import {
  AccountSelectionPopoverContent,
  AccountSelectionTrigger,
  reconnectAccountsLabel,
} from "./account-selection-trigger";

describe("AccountSelectionTrigger", () => {
  it("shows a standard visibility count without avatar or status ornamentation", async () => {
    const view = render(
      <AccountSelectionTrigger
        ariaLabel="2 of 2 accounts, attention required"
        needsAttention
        selectedCount={2}
        totalCount={2}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "2 of 2 accounts, attention required",
    });
    expect(trigger.querySelector(".action-count-badge")).toBeNull();
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(0);
    expect(trigger.querySelector(".account-selection-trigger__warning")).toBeNull();

    view.rerender(
      <AccountSelectionTrigger
        allSynced
        ariaLabel="1 of 1 account"
        selectedCount={1}
        totalCount={1}
      />,
    );
    expect(
      screen.getByRole("button", { name: "1 of 1 account" }).querySelector(".action-count-badge"),
    ).toBeNull();
    expect(document.querySelector(".account-selection-trigger__warning")).toBeNull();
    await userEvent.hover(screen.getByRole("button", { name: "1 of 1 account" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "1 of 1 account, all accounts connected and syncing",
    );
  });

  it("shows the selected subset, including zero, in the shared count badge", () => {
    const view = render(
      <AccountSelectionTrigger ariaLabel="1 of 3 accounts" selectedCount={1} totalCount={3} />,
    );
    expect(screen.getByRole("button").querySelector(".action-count-badge")).toHaveTextContent("1");
    view.rerender(
      <AccountSelectionTrigger ariaLabel="0 of 3 accounts" selectedCount={0} totalCount={3} />,
    );
    expect(screen.getByRole("button").querySelector(".action-count-badge")).toHaveTextContent("0");
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
