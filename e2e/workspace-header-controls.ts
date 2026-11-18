import { expect, type Page } from "@playwright/test";

/** Page options are direct header controls in every layout, without an extra overflow menu. */
export async function revealWorkspaceOptions(page: Page) {
  const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
  await expect(header).toBeVisible();
  await expect(header.getByRole("button", { name: "View options", exact: true })).toHaveCount(0);
  await expect(
    header.locator(".workspace-header-options").getByRole("button").first(),
  ).toBeVisible();
}
