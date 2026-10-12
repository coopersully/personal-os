import { expect, test } from "@playwright/test";

test("desktop downloads are public, versioned and usable on a narrow screen", async ({ page }) => {
  let accountReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/me") accountReads++;
  });
  await page.route("**/v1/desktop-release", (route) =>
    route.fulfill({
      json: {
        status: "available",
        release: {
          version: "0.2.0",
          publishedAt: "2026-09-30T12:00:00Z",
          notes: "Safer updates and desktop improvements",
          releaseUrl: "https://github.com/coopersully/personal-os/releases/tag/v0.2.0",
          installers: ["aarch64", "x86_64"].map((architecture) => ({
            architecture,
            url: `https://github.com/coopersully/personal-os/releases/download/v0.2.0/nohmi_0.2.0_${architecture}.dmg`,
          })),
        },
      },
    }),
  );
  await page.goto("/downloads");
  await expect(page.getByText("Version 0.2.0 · macOS 14 or later")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download for Apple Silicon" })).toHaveAttribute(
    "href",
    /nohmi_0.2.0_aarch64.dmg$/,
  );
  await expect(page.getByRole("link", { name: "Download for Intel" })).toBeVisible();
  await page.getByText(/Release notes ·/).click();
  await expect(page.getByText("Safer updates and desktop improvements")).toBeVisible();
  expect(accountReads).toBe(0);
  const width = page.viewportSize()?.width;
  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    (width ?? 0) + 1,
  );
});
