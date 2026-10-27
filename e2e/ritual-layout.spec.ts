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

test("morning and evening previews fill the viewport independently of the ritual card", async ({
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
      ? [
          { width: 390, height: 844 },
          { width: 320, height: 568 },
        ]
      : [
          { width: 1440, height: 1000 },
          { width: 1280, height: 600 },
        ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await fillsViewport(page, preview);
      await fillsViewport(page, preview.locator(".ritual-clouds"));
      await expect(preview).not.toHaveAttribute("data-presentation", "drawer");
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

test("weather skies show the six approved combinations and degrade without blocking routines", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const instant = Date.now();
  const iso = (hours: number) => new Date(instant + hours * 3600_000).toISOString();
  let atmospheric: {
    weatherCode: number;
    cloudCoverPercent: number;
    windSpeedKmh: number;
    isDay: boolean;
    sunriseAt: string;
    sunsetAt: string;
    observedAt: string;
  } | null = {
    weatherCode: 0,
    cloudCoverPercent: 12,
    windSpeedKmh: 10,
    isDay: true,
    sunriseAt: iso(-3),
    sunsetAt: iso(8),
    observedAt: iso(0),
  };
  await page.route(/\/v1\/weather(?:\?|$)/, (route) =>
    route.fulfill({
      status: atmospheric ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(
        atmospheric
          ? {
              weather: {
                alerts: [],
                condition: "Current conditions",
                temperatureF: 60,
                usAqi: null,
                observedAt: iso(0),
                location: {
                  city: "New York",
                  coordinates: { latitude: 40.7, longitude: -74 },
                  country: "US",
                  label: "New York",
                  mapUrl: "https://example.com",
                  region: "NY",
                  shortLabel: "NYC",
                  source: "saved",
                },
                atmosphere: atmospheric,
              },
            }
          : { error: { code: "service_unavailable", message: "Weather unavailable" } },
      ),
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  await page.goto("/settings?page=rituals");
  for (const sample of [
    {
      name: "clear-dawn",
      code: 0,
      cover: 12,
      rise: 0.3,
      set: 11,
      phase: "dawn",
      condition: "clear",
      kind: "Morning",
    },
    {
      name: "overcast-morning",
      code: 3,
      cover: 90,
      rise: -3,
      set: 8,
      phase: "day",
      condition: "overcast",
      kind: "Morning",
    },
    {
      name: "rain-afternoon",
      code: 63,
      cover: 80,
      rise: -8,
      set: 3,
      phase: "day",
      condition: "rain",
      kind: "Morning",
    },
    {
      name: "clear-sunset",
      code: 0,
      cover: 12,
      rise: -10,
      set: -0.08,
      phase: "sunset",
      condition: "clear",
      kind: "Evening",
    },
    {
      name: "cloudy-blue-hour",
      code: 2,
      cover: 40,
      rise: -12,
      set: -0.75,
      phase: "twilight",
      condition: "cloudy",
      kind: "Evening",
    },
    {
      name: "snow-night",
      code: 73,
      cover: 70,
      rise: -16,
      set: -5,
      phase: "night",
      condition: "snow",
      kind: "Evening",
    },
  ]) {
    atmospheric = {
      weatherCode: sample.code,
      cloudCoverPercent: sample.cover,
      windSpeedKmh: 12,
      isDay: sample.set > 0 && sample.rise < 0,
      sunriseAt: iso(sample.rise),
      sunsetAt: iso(sample.set),
      observedAt: iso(0),
    };
    await page.getByRole("button", { name: `Preview ${sample.kind} Ritual`, exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Ritual preview" });
    const scene = preview.locator(".ritual-scene");
    await expect(scene).toHaveAttribute("data-sky-source", "weather");
    await expect(scene).toHaveAttribute("data-sky-condition", sample.condition);
    await expect(scene).toHaveAttribute("data-sky-phase", sample.phase);
    await fillsViewport(page, preview.locator(".ritual-atmosphere"));
    await cloudsPainted(preview.locator(".ritual-atmosphere"));
    await expect(preview.getByRole("button", { name: "Close Preview" })).toBeVisible();
    const canvas = preview.locator(".ritual-atmosphere");
    const first = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL())).toBe(first);
    await expect
      .poll(() =>
        preview.locator(".ritual-card").evaluate((card) => {
          const title = card.querySelector('[data-slot="card-title"]');
          const close = card.querySelector('button[aria-label="Close Preview"]');
          if (!title || !close) return false;
          const background = getComputedStyle(card).backgroundColor;
          return (
            getComputedStyle(title).color !== background &&
            getComputedStyle(close).backgroundColor !== background &&
            [card, title, close].every(
              (el) =>
                getComputedStyle(el).opacity === "1" &&
                getComputedStyle(el).visibility === "visible",
            )
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        preview.locator(".ritual-card").evaluate((card) => {
          const box = card.getBoundingClientRect();
          return Array.from(card.children).every((child) => {
            const b = child.getBoundingClientRect();
            return (
              b.x >= box.x && b.y >= box.y && b.right <= box.right + 1 && b.bottom <= box.bottom + 1
            );
          });
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`${sample.name}-first.png`),
      animations: "disabled",
      scale: "css",
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({
      path: info.outputPath(`${sample.name}.png`),
      animations: "disabled",
      scale: "css",
    });
    await preview.getByRole("button", { name: "Close Preview" }).click();
  }
  atmospheric = null;
  await page.getByRole("button", { name: "Preview Morning Ritual", exact: true }).click();
  const fallback = page.getByRole("dialog", { name: "Ritual preview" });
  await expect(fallback.locator(".ritual-scene")).toHaveAttribute("data-sky-source", "time");
  await fallback.getByRole("button", { name: "Close Preview" }).click();
  await expect(fallback).not.toBeVisible();
});
