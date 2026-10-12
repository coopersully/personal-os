import { readFileSync } from "node:fs";
import { completeReminderInputSchema, completeTaskInputSchema } from "@personal-os/domain";
import { expect, it } from "vitest";

it("accepts the desktop pet completion bodies at the domain boundary", () => {
  const bodies = JSON.parse(
    readFileSync(new URL("../../desktop/fixtures/pet-completion.json", import.meta.url), "utf8"),
  );
  expect(completeTaskInputSchema.parse(bodies.task)).toEqual({});
  expect(completeReminderInputSchema.parse(bodies.reminder)).toEqual({ completed: true });
});
