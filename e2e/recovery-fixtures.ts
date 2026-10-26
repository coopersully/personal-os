import { test as base, expect, type Page, request } from "@playwright/test";
import { fixtureWeather } from "./weather-fixtures.js";

type Cleanup = (restore: () => Promise<void>) => void;

/** Fixture teardown has its own budget even when the test body times out. */
export const test = base.extend<{ cleanup: Cleanup }>({
  page: async ({ page }, use) => {
    await fixtureWeather(page);
    await use(page);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture dependencies; this fixture has none.
  cleanup: async ({}, use) => {
    const restores: Array<() => Promise<void>> = [];
    await use((restore) => restores.push(restore));
    const failures: unknown[] = [];
    for (const restore of restores.reverse()) {
      try {
        await restore();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Browser fixture restoration failed");
  },
});

/** Capture authentication before mutation; cleanup must not depend on a live page. */
export async function cleanupRitual(page: Page, cleanup: Cleanup, kind: "morning" | "night") {
  const context = await request.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  cleanup(async () => {
    try {
      try {
        const response = await context.get("/v1/rituals/current");
        expect(response.ok()).toBe(true);
        const current = (await response.json()).current;
        if (current?.definition?.kind === kind) {
          for (const id of current.optionalFollowUp?.reminderIds ?? []) {
            const removed = await context.delete(`/v1/reminders/${id}`);
            expect([204, 404]).toContain(removed.status());
          }
        }
      } finally {
        const removed = await context.delete(`/v1/rituals/${kind}/data`);
        expect([204, 404]).toContain(removed.status());
      }
    } finally {
      await context.dispose();
    }
  });
}
