import { expect, test } from "@playwright/test";

for (const sizing of ["root font", "independent header"] as const) {
  test(`Mail native history navigation aligns below a 96px header (${sizing})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    await page.goto("/mail");
    // Controlled browser sizing exercises actual stylesheet snapping, not mocked geometry.
    await page.addStyleTag({
      content:
        sizing === "root font"
          ? ":root { font-size: 24px; }"
          : ".mail-reader__history-nav { height: 96px; }",
    });
    await page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" }).click();
    const reader = page.getByRole("region", { name: "Message reader", exact: true });
    const messages = reader.locator(".mail-reader__message");
    await expect(messages).toHaveCount(2);
    await expect
      .poll(() =>
        reader
          .locator(".mail-reader__history-nav")
          .evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBe(96);
    await expect
      .poll(() =>
        messages.last().evaluate((el) => parseFloat(getComputedStyle(el).scrollMarginTop)),
      )
      .toBe(96);
    await expect
      .poll(() =>
        messages.last().evaluate((el) => {
          const header = el.closest(".mail-reader")?.querySelector(".mail-reader__history-nav");
          return header
            ? Math.abs(el.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
            : 1000;
        }),
      )
      .toBeLessThan(4);
    expect(await reader.evaluate((el) => getComputedStyle(el).scrollSnapType)).toMatch(
      /^y(?: proximity)?$/,
    );
    const previous = reader.getByRole("button", {
      name: "1 more message above. Go to previous message",
    });
    await expect(previous).toBeVisible();
    await previous.click();
    await expect(previous).toHaveCount(0);
    await expect(messages.first()).toBeInViewport();
    await expect
      .poll(() =>
        messages.first().evaluate((el) => {
          const header = el.closest(".mail-reader")?.querySelector(".mail-reader__history-nav");
          return header
            ? Math.abs(el.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
            : 1000;
        }),
      )
      .toBeLessThan(4);
  });
}
