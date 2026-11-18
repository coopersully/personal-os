import { dailyDemoTransactions, qaFixtureClockEnabled } from "./qa-fixture-clock.js";

it("only enables the fictional clock for explicitly opted-in local development databases", () => {
  expect(qaFixtureClockEnabled({}, "postgres://localhost/test")).toBe(false);
  expect(qaFixtureClockEnabled({ QA_FIXTURE_CLOCK: "true" }, "postgres://postgres/test")).toBe(
    true,
  );
  expect(
    qaFixtureClockEnabled(
      { QA_FIXTURE_CLOCK: "true", NODE_ENV: "production" },
      "postgres://localhost/test",
    ),
  ).toBe(false);
  expect(
    qaFixtureClockEnabled({ QA_FIXTURE_CLOCK: "true" }, "postgres://db.example.com/test"),
  ).toBe(false);
});

it("creates stable daily purchase identities with weekday/weekend variation", () => {
  const now = new Date("2026-11-01T06:00:00Z");
  const sunday = dailyDemoTransactions("2026-11-01", now);
  expect(sunday).toHaveLength(2);
  expect(sunday.map((row) => row.category)).toEqual(["Dining", "Groceries"]);
  expect(
    dailyDemoTransactions("2026-11-01", new Date("2026-11-01T18:00:00Z")).map((row) => row.id),
  ).toEqual(sunday.map((row) => row.id));
  expect(dailyDemoTransactions("2026-11-02", now)).toHaveLength(1);
  expect(dailyDemoTransactions("2026-10-31", now).map((row) => row.merchant)).toContain(
    "HUDSON TABLE",
  );
});
