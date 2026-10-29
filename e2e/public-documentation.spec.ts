import { expect, test } from "@playwright/test";

const pages = [
  ["about", "About nohmi"],
  ["docs", "Using nohmi"],
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "your digital exoskeleton.",
    );
    await expect(page.getByRole("link", { name: "Sign up", exact: true }).first()).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole("navigation", { name: "Public documentation" })
      .getByRole("link", { name: "Privacy policy" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
  });

  for (const [path, title] of pages) {
    test(`${path} is readable and navigable`, async ({ page }) => {
      const response = await page.goto(`/${path}/`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("navigation", { name: "Public documentation" })).toBeVisible();
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
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      await page
        .getByRole("navigation", { name: "Public documentation" })
        .getByRole("link", { name: "Privacy policy" })
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
  const links = page.getByRole("navigation", { name: "About nohmi and policies" });
  await expect(links).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("sign-in.png"), fullPage: true });
  await links.getByRole("button", { name: "Legal", exact: true }).click();
  await page.getByRole("menuitem", { name: "SMS Policy", exact: true }).click();
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
  await expect(
    page.getByRole("heading", { level: 1, name: "your digital exoskeleton." }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="card"]')).toHaveCount(5);
  await expect(
    page
      .getByRole("navigation", { name: "Product navigation" })
      .getByRole("link", { name: "sign in", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Sign up", exact: true }).first()).toHaveAttribute(
    "href",
    "/signup",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("landing.png"), fullPage: true });
  await page
    .getByRole("navigation", { name: "Public documentation" })
    .getByRole("link", { name: "Privacy policy" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
});

test("sign-up is directly addressable and browser history restores the auth page", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(page.getByLabel("Confirm password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Confirm password", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Confirm password", { exact: true })).toBeVisible();
});

test("login restores a protected destination and does not replace the product root", async ({
  page,
}) => {
  await page.goto("/settings?page=security");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Email", { exact: true }).fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?page=security$/);
  for (const destination of ["/", "/login", "/signup"]) {
    await page.goto(destination);
    await expect(page).toHaveURL(/\/today$/);
  }
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
});

for (const path of ["/", "/privacy/"]) {
  test(`public navigation docks and returns smoothly on ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(path);
    const nav = page.locator(".public-nav");
    await expect(nav.getByRole("link", { name: "sign in", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sign up", exact: true })).toHaveCount(0);
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
