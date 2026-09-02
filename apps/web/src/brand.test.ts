import { describe, expect, it } from "vitest";
import { BRAND_NAME, BRAND_PROMISE, BRAND_PRONUNCIATION } from "./brand.js";

describe("nohmi brand", () => {
  it("keeps the public identity stable", () => {
    expect(BRAND_NAME).toBe("nohmi");
    expect(BRAND_PRONUNCIATION).toBe("know me");
    expect(BRAND_PROMISE).toBe("know what matters.");
  });
});
