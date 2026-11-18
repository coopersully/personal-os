import { expect, it } from "vitest";
import { storedLabel } from "./labels";

it("reads a stored kind or state as words with a leading capital", () => {
  expect(storedLabel("follow_up")).toBe("Follow up");
  expect(storedLabel("approved_rule")).toBe("Approved rule");
  expect(storedLabel("waiting")).toBe("Waiting");
  expect(storedLabel("")).toBe("");
});
