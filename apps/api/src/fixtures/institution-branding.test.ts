import { financeInstitutionBrandingSchema } from "@personal-os/domain";
import { expect, it } from "vitest";
import { fixtureInstitutionBranding } from "./institution-branding.js";

it("ships distinct valid offline PNG logos for all demo institutions", () => {
  const entries = Object.values(fixtureInstitutionBranding);
  expect(entries).toHaveLength(4);
  expect(new Set(entries.map((entry) => entry.logo)).size).toBe(4);
  for (const entry of entries) {
    expect(financeInstitutionBrandingSchema.safeParse(entry).success).toBe(true);
    const png = Buffer.from(entry.logo.slice(entry.logo.indexOf(",") + 1), "base64");
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
  }
});
