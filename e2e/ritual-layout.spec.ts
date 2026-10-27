import { expect, type Locator, type Page, test } from "@playwright/test";

async function fillsViewport(page: Page, layer: Locator) {
  await expect(layer).toBeVisible();
  await expect
    .poll(async () => {
      const box = await layer.boundingBox();
      const view = page.viewportSize();
      return (
        !!box &&
        !!view &&
        Math.abs(box.x) <= 1 &&
        Math.abs(box.y) <= 1 &&
        Math.abs(box.width - view.width) <= 1 &&
        Math.abs(box.height - view.height) <= 1
      );
    })
    .toBe(true);
}

async function cloudsPainted(layer: Locator) {
  await expect
    .poll(() =>
      layer.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d");
        return (
          !!context &&
          context
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0)
        );
      }),
    )
    .toBe(true);
}

test("morning and evening previews keep their sky within responsive overlays independently of the ritual card", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  await page.goto("/settings?page=rituals");
  for (const kind of ["Morning", "Evening"]) {
    await page.getByRole("button", { name: `Preview ${kind} Ritual`, exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Ritual preview" });
    await expect(preview).toBeVisible();
    const sizes = info.project.use.isMobile
      ? [{ width: 390, height: 844 }]
      : [
          { width: 1440, height: 1000 },
          { width: 1280, height: 600 },
        ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      // Browser previews follow the shared modal/drawer contract; native windows stay fullscreen.
      await expect(preview).toHaveAttribute(
        "data-presentation",
        size.width < 768 ? "drawer" : "dialog",
      );
      await expect
        .poll(async () => {
          const box = await preview.boundingBox();
          const sky = await preview.locator(".ritual-clouds").boundingBox();
          if (!box || !sky) return false;
          const contained =
            box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= size.width + 1 &&
            box.y + box.height <= size.height + 1;
          const aligned =
            size.width < 768
              ? Math.abs(box.y + box.height - size.height) <= 1
              : Math.abs(box.x + box.width / 2 - size.width / 2) <= 1 &&
                Math.abs(box.y + box.height / 2 - size.height / 2) <= 1;
          return (
            contained &&
            aligned &&
            Math.abs(sky.x - box.x) <= 1 &&
            Math.abs(sky.y - box.y) <= 1 &&
            Math.abs(sky.width - box.width) <= 1 &&
            Math.abs(sky.height - box.height) <= 1
          );
        })
        .toBe(true);
      await cloudsPainted(preview.locator(".ritual-clouds"));
      const close = preview.getByRole("button", { name: "Close Preview" });
      await expect(close).toBeVisible();
      const bounds = await close.boundingBox();
      expect(bounds && bounds.y + bounds.height).toBeLessThanOrEqual(size.height + 1);
      await page.screenshot({
        path: info.outputPath(`${kind.toLowerCase()}-${size.width}x${size.height}.png`),
        animations: "disabled",
        scale: "css",
      });
    }
    await preview.getByRole("button", { name: "Close Preview" }).click();
  }
});

test("native ritual surface and clouds fill the whole window after resize", async ({
  page,
}, info) => {
  test.skip(!!info.project.use.isMobile, "Native window geometry is a desktop concern");
  const now = new Date().toISOString();
  const definition = {
    id: "morning",
    revision: 1,
    enabled: true,
    kind: "morning",
    title: "Good morning",
    time: "06:00",
    timeZone: "UTC",
    steps: [{ id: "water", kind: "checkbox", label: "Drink water" }],
  };
  const state = {
    definitions: [definition],
    serverNow: now,
    syncStatus: "saved",
    snoozeCount: 0,
    current: {
      id: "layout-preview",
      ritualId: "morning",
      definitionRevision: 1,
      scheduledLocalDate: now.slice(0, 10),
      timeZone: "UTC",
      dueAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      revision: 1,
      status: "pending",
      snoozedUntil: null,
      settledAt: null,
      definition,
      responses: [],
      actions: [],
    },
  };
  await page.addInitScript((snapshot) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string) => (command === "ritual_state" ? snapshot : undefined),
      },
    });
  }, state);
  await page.goto("/index.html#ritual");
  const surface = page.locator(".ritual-surface");
  await expect(surface).toHaveAttribute("data-ready", "true");
  for (const size of [
    { width: 648, height: 828 },
    { width: 1440, height: 1000 },
    { width: 1280, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await fillsViewport(page, surface);
    await fillsViewport(page, page.locator(".ritual-clouds"));
    await cloudsPainted(page.locator(".ritual-clouds"));
    await expect(page.getByRole("checkbox", { name: "Drink water" })).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`native-${size.width}x${size.height}.png`),
      animations: "disabled",
      scale: "css",
    });
  }
});
