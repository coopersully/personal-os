import { writeFile } from "node:fs/promises";
import type { FinanceAccountList } from "@personal-os/domain";
import { expect, test } from "@playwright/test";

test("duplicate confirmation keeps counts and consequences inside the scrolling body", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const response = await page.request.get("/v1/finances/accounts");
  expect(response.ok()).toBeTruthy();
  const material: FinanceAccountList = await response.json();
  const fixture = material.accounts[0];
  if (!fixture) throw new Error("Missing representative Finance fixture");
  const redundant = {
    ...fixture,
    id: "duplicate-review-old",
    provider: "plaid" as const,
    status: "connected" as const,
    name: "Duplicate checking with a long account name",
    accountMask: "1234",
    institution: "Synthetic test bank",
    lastSyncedAt: "2026-10-29T12:00:00Z",
    synchronization: { ...fixture.synchronization, state: "current" as const },
  };
  const keeper = { ...redundant, id: "duplicate-review-keep", name: "Current checking" };
  await page.route(/\/v1\/finances\/accounts(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ...material,
        accounts: [redundant, keeper],
        accountSemantics: {
          ...material.accountSemantics,
          possibleDuplicateGroups: [{ accountIds: [redundant.id, keeper.id] }],
        },
      },
    }),
  );
  await page.route("**/duplicate-preview?*", (route) =>
    route.fulfill({
      json: {
        outcome: "completed",
        data: {
          keptAccount: keeper,
          redundantAccount: redundant,
          keptTransactionCount: 10,
          redundantTransactionCount: 7,
          overlappingTransactionCount: 5,
          uniqueRedundantTransactionCount: 2,
          match: "provider_identity",
          revision: "a".repeat(64),
        },
        communication: { headline: "Ready", optionalDetails: [], requiredDisclosures: [] },
      },
    }),
  );
  await page.goto("/finances/accounts");
  await page.getByRole("button", { name: `Compare duplicates for ${redundant.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account to keep tracking").selectOption(keeper.id);
  await dialog.getByRole("button", { name: "Preview comparison" }).click();
  const body = dialog.locator('[data-responsive-slot="body"]');
  const layout: Array<{ stage: string; metrics: unknown }> = [];
  const recordLayout = async (stage: string) => {
    layout.push({
      stage,
      metrics: await dialog.evaluate((element) => {
        const measure = (node: Element | null) => {
          if (!node) return null;
          const bounds = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            bounds: {
              x: bounds.x,
              y: bounds.y,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              left: bounds.left,
              width: bounds.width,
              height: bounds.height,
            },
            scrollTop: node.scrollTop,
            scrollLeft: node.scrollLeft,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            flexShrink: style.flexShrink,
          };
        };
        return {
          root: measure(element),
          body: measure(element.querySelector('[data-responsive-slot="body"]')),
          header: measure(element.querySelector('[data-responsive-slot="header"]')),
          footer: measure(element.querySelector('[data-responsive-slot="footer"]')),
          buttons: [...element.querySelectorAll("button")].map(measure),
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollX,
            scrollY,
            devicePixelRatio,
            visualWidth: visualViewport?.width,
            visualHeight: visualViewport?.height,
            pageTop: visualViewport?.pageTop,
            pageLeft: visualViewport?.pageLeft,
            offsetTop: visualViewport?.offsetTop,
            offsetLeft: visualViewport?.offsetLeft,
            scale: visualViewport?.scale,
          },
        };
      }),
    });
  };
  const assertAnatomy = async () => {
    await expect(
      dialog.getByRole("heading", { name: "Compare duplicates", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator('[data-responsive-slot="footer"]')).toBeInViewport({ ratio: 1 });
    for (const name of ["Stop tracking duplicate", "Cancel"]) {
      await expect(dialog.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
    expect(
      await dialog.evaluate((element) => {
        const root = element.getBoundingClientRect();
        const header = element
          .querySelector('[data-responsive-slot="header"]')
          ?.getBoundingClientRect();
        const footer = element
          .querySelector('[data-responsive-slot="footer"]')
          ?.getBoundingClientRect();
        return (
          !!header && !!footer && header.top >= root.top - 1 && footer.bottom <= root.bottom + 1
        );
      }),
    ).toBe(true);
  };
  const capture = async (name: string) => {
    await recordLayout(`before-${name}`);
    await assertAnatomy();
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Missing dialog capture bounds");
    // Page clipping observes the visible dialog without locator.screenshot's
    // automatic ancestor scrolling.
    await page.screenshot({ path: test.info().outputPath(name), clip: bounds });
    await recordLayout(`after-${name}`);
    await assertAnatomy();
  };
  try {
    await recordLayout("initial");
    await assertAnatomy();
    // Record the previous harness's programmatic ancestor scrolling before
    // restoring its initial position; this is diagnostic, not a layout fix.
    await body.getByText(/This does not revoke provider access/).scrollIntoViewIfNeeded();
    await recordLayout("after-legacy-scroll");
    await dialog.screenshot();
    await recordLayout("after-legacy-element-capture");
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    await recordLayout("restored-initial-scroll");
    await assertAnatomy();
    for (const [label, count] of [
      ["Overlapping transactions", "5"],
      ["Unique transactions on the redundant account", "2"],
    ] as const) {
      const value = body
        .locator("dt")
        .filter({ hasText: label })
        .locator("xpath=following-sibling::dd[1]");
      await value.evaluate((element) => {
        const scroller = element.closest('[data-responsive-slot="body"]');
        if (!scroller) throw new Error("Missing dialog body");
        scroller.scrollTop += Math.max(
          0,
          element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 16,
        );
      });
      await expect(value).toHaveText(count);
      await expect(value).toBeInViewport({ ratio: 1 });
    }
    await capture("duplicate-counts.png");
    expect(
      await body.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        return [...element.querySelectorAll("p,dt,dd,section")]
          .filter((child) => {
            const bounds = child.getBoundingClientRect();
            return (
              bounds.left < frame.left - 1 ||
              bounds.right > frame.right + 1 ||
              child.scrollWidth > child.clientWidth + 1
            );
          })
          .map((child) => child.textContent);
      }),
    ).toEqual([]);
    await recordLayout("before-bottom-body-scroll");
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await recordLayout("after-bottom-body-scroll");
    await expect(body.getByText(/This does not revoke provider access/)).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Account comparison ready." }),
    ).toBeHidden({ timeout: 10_000 });
    await capture("duplicate-comparison.png");
  } finally {
    // Numeric geometry only: no DOM, account content, credentials or URLs.
    await writeFile(
      test.info().outputPath("duplicate-layout.json"),
      JSON.stringify(layout, null, 2),
    );
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
