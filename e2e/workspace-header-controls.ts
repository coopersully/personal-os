import { expect, type Page } from "@playwright/test";

/** Wait for closing dialogs to release the mobile utility row before opening its menu. */
export async function revealWorkspaceOptions(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return;
  const trigger = page.getByRole("button", { name: "View options", exact: true });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}
