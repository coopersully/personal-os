// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SettingsPageLayout } from "./settings-layout";

describe("Settings breadcrumbs", () => {
  it("keeps linked ancestors and one complete current-page heading", () => {
    render(
      <MemoryRouter>
        <SettingsPageLayout
          title="Workspace access"
          description="Choose access."
          section="workspace-access"
          search={null}
          back={{ to: "/settings?page=security", label: "Back to Security & access" }}
        >
          <p>Settings content</p>
        </SettingsPageLayout>
      </MemoryRouter>,
    );
    expect(screen.queryByText("Choose access.")).not.toBeInTheDocument();
    const breadcrumbs = screen.getByRole("navigation", { name: "Settings breadcrumbs" });
    expect(within(breadcrumbs).getByRole("link", { name: "settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(breadcrumbs).getByRole("link", { name: "Security & access" })).toHaveAttribute(
      "href",
      "/settings?page=security",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Workspace access" })).toBeVisible();
    expect(within(breadcrumbs).queryByText("Workspace access")).not.toBeInTheDocument();
  });
});
