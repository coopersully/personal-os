import { assertSettingsRevision } from "./settings-save.js";

it("accepts exact missing and persisted domain revisions without treating defaults as interchangeable", () => {
  for (const revision of [null, 0, 1, 8])
    expect(() => assertSettingsRevision(revision, revision, "Changed")).not.toThrow();
  for (const [current, expected] of [
    [null, 0],
    [0, null],
    [2, 1],
    [1, 2],
  ]) {
    expect(() => assertSettingsRevision(current, expected, "Changed")).toThrow("Changed");
  }
});
it("retains domain-specific conflict details", () => {
  try {
    assertSettingsRevision(3, 2, "Policy changed", { currentVersion: 3 });
  } catch (error) {
    expect(error).toMatchObject({ code: "conflict", details: { currentVersion: 3 } });
  }
});
