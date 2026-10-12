import { accessScopeSchema } from "./auth.js";

describe("explicit workspace execution grants", () => {
  it.each([
    "mail",
    "finances",
    "calendar",
    "tasks",
    "texting",
  ])("recognizes opt-in %s execution authority separately from write", (workspace) => {
    expect(accessScopeSchema.safeParse(`${workspace}:execute`).success).toBe(true);
  });
});
