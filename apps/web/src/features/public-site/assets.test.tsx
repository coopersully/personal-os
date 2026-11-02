import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProductLanding } from "./landing.js";

function assertImage(path: string) {
  const bytes = readFileSync(new URL(`../../../public${path}`, import.meta.url));
  if (path.endsWith(".webp")) {
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  } else if (path.endsWith(".png")) {
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  } else if (path.endsWith(".jpg")) {
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  } else {
    throw new Error(`Unexpected image format: ${path}`);
  }
}

describe("public artwork", () => {
  it("ships every rendered image and responsive variant with the correct format", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProductLanding />
      </MemoryRouter>,
    );
    const assets = new Set(html.match(/\/brand\/[a-z0-9/.-]+\.(?:webp|jpg|png)/g));
    expect(assets.size).toBeGreaterThan(0);
    for (const path of assets) assertImage(path);
  });

  it("keeps the screenshot URLs used by previously cached previews available", () => {
    for (const workspace of ["tasks", "mail", "calendar", "finances"]) {
      assertImage(`/brand/devices/${workspace}-premiere.png`);
      assertImage(`/brand/devices/${workspace}-premiere.jpg`);
    }
  });
});
