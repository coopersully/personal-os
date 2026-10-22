import { expect, test } from "@playwright/test";

const pages = [
  ["about", "a personal harness."],
  ["docs", "set up your harness."],
  ["privacy", "Privacy policy"],
  ["terms", "Terms of use"],
  ["data-use", "Your data and agent access"],
  ["sms", "nohmi SMS terms and enrollment"],
  ["support", "Support and contact"],
] as const;

test.describe("public documentation without JavaScript or a session", () => {
  test.use({ javaScriptEnabled: false });

  test("the product landing page is readable and navigable", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("a personal harness.");
    await expect(
      page.getByRole("link", { name: "get started", exact: true }).first(),
    ).toHaveAttribute("href", "/signup");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole("navigation", { name: "public documentation" })
      .getByRole("link", { name: "privacy" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  });

  for (const [path, title] of pages) {
    test(`${path} is readable and navigable`, async ({ page }) => {
      const response = await page.goto(`/${path}/`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("navigation", { name: "public documentation" })).toBeVisible();
      await expect(page.locator('header [data-slot="navigation-menu"]')).toBeVisible();
      await expect(page.locator('main [data-slot="card"]')).toBeVisible();
      expect(
        await page
          .locator("footer")
          .evaluate(
            (footer) =>
              getComputedStyle(footer).backgroundColor !==
              getComputedStyle(document.body).backgroundColor,
          ),
      ).toBe(true);
      await expect(page.locator("footer")).toContainText(
        `© Cooper Sullivan ${new Date().getFullYear()}`,
      );
      await expect(page.locator('footer a[href^="mailto:"]')).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (path === "about" || path === "sms") {
        await page.screenshot({ path: test.info().outputPath(`${path}.png`), fullPage: true });
      }
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "skip to content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      await page
        .getByRole("navigation", { name: "public documentation" })
        .getByRole("link", { name: "privacy" })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
    });
  }

  test("extensionless policy URLs also resolve to the actual documents", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of use");
  });
});

test("sign-in exposes public policies without granting messaging consent", async ({ page }) => {
  await page.goto("/login");
  const links = page.getByRole("navigation", { name: "about nohmi and policies" });
  await expect(links).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("sign-in.png"), fullPage: true });
  await links.getByRole("link", { name: "texting terms", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "nohmi SMS terms and enrollment",
  );
  await expect(page.locator("main")).toContainText("does not collect a phone number or enroll you");
  await expect(page.locator("input")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("the product landing page links to dedicated authentication and public documents", async ({
  page,
}) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "a personal harness." })).toBeVisible();
  await expect(page.locator('[data-slot="card"]')).toHaveCount(5);
  await expect(
    page
      .getByRole("navigation", { name: "product navigation" })
      .getByRole("link", { name: "sign in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(
    page.getByRole("link", { name: "get started", exact: true }).first(),
  ).toHaveAttribute("href", "/signup");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("landing.png"), fullPage: true });
  await page
    .getByRole("navigation", { name: "public documentation" })
    .getByRole("link", { name: "privacy" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
});

test("sign-up is directly addressable and browser history restores the auth page", async ({
  page,
}) => {
  await page.goto("/signup");
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 740 });
  const inputBounds = await page.locator("[data-input-otp-container]").boundingBox();
  const lastSlot = await page.locator('[data-slot="input-otp-slot"]').last().boundingBox();
  expect(inputBounds).not.toBeNull();
  expect(lastSlot).not.toBeNull();
  if (!inputBounds || !lastSlot) throw new Error("Invitation input did not render.");
  expect(lastSlot.x + lastSlot.width).toBeLessThanOrEqual(inputBounds.x + inputBounds.width + 1);
  await page.screenshot({ path: test.info().outputPath("signup-narrow.png"), fullPage: true });
  if (originalViewport) await page.setViewportSize(originalViewport);
  await expect(page.getByLabel("confirm password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "create account", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "already have an account? sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "sign in", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("confirm password", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("confirm password", { exact: true })).toBeVisible();
});

test("login restores a protected destination and does not replace the product root", async ({
  page,
}) => {
  await page.goto("/settings?section=security");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("email", { exact: true }).fill("demo+full@nohmi.test");
  await page.getByLabel("password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?section=security$/);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "a personal harness." })).toBeVisible();
  await page
    .getByRole("navigation", { name: "product navigation" })
    .getByRole("link", { name: "sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/today$/);
});

for (const path of ["/", "/privacy/"]) {
  test(`public navigation docks and returns smoothly on ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(path);
    const nav = page.locator(".public-nav");
    await expect(nav.getByRole("link", { name: "sign in", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "get started", exact: true })).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await expect(nav).toHaveCSS("backdrop-filter", "none");
      return;
    }
    await expect(nav).toHaveCSS("background-color", /(?:,\s*0|\/\s*0)\)$/);
    await page.evaluate(() => window.scrollTo(0, 350));
    await expect
      .poll(() => nav.evaluate((node) => getComputedStyle(node).backdropFilter))
      .toBe("blur(16px)");
    expect((await page.locator("header").boundingBox())?.y).toBe(0);
    await page.screenshot({ path: test.info().outputPath("scrolled-nav.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav).toHaveCSS("background-color", /(?:,\s*0|\/\s*0)\)$/);
  });
}
