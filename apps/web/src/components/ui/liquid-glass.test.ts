import { expect, it } from "vitest";
import { svgBackdropEligible } from "./react-bits/GlassSurface";
it.each([
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)", false],
  ["Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", false],
  ["Mozilla/5.0 AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1", false],
  ["Mozilla/5.0 Gecko/20100101 Firefox/130.0", false],
  ["Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36", true],
  ["Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0", true],
  ["Mozilla/5.0 AppleWebKit/537.36 Chromium/130.0 Safari/537.36", true],
])("selects the supported optical engine for %s", (userAgent, eligible) => {
  expect(svgBackdropEligible(userAgent)).toBe(eligible);
});
