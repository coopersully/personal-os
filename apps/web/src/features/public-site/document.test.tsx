// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PublicDocument } from "./document.js";
import { guideSlugs } from "./guide-pages.js";

it("renders readable policy content and working public navigation without client scripts", () => {
  const html = renderToStaticMarkup(
    <PublicDocument
      slug="privacy"
      title="Privacy policy"
      intro="How your data is used."
      eyebrow="nohmi / Privacy policy"
      content='<h2>Contact</h2><p>Request help at <a href="mailto:support@example.com">support@example.com</a>.</p>'
    />,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("h1")?.textContent).toBe("Privacy policy");
  expect(document.querySelector("main h2")?.textContent).toBe("Contact");
  expect(document.querySelector("main a")?.getAttribute("href")).toBe("mailto:support@example.com");
  expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/privacy/");
  expect(document.querySelector('header a[href="/login"]')).not.toBeNull();
  expect(document.querySelector('footer a[href="/terms/"]')).not.toBeNull();
  expect(document.querySelectorAll("script")).toHaveLength(0);
});

it.each([
  "about",
  "docs",
  "support",
  ...guideSlugs.filter((slug) => slug !== "docs"),
  "privacy",
  "terms",
  "data-use",
  "sms",
])("selects the intended reading layout for %s", (slug) => {
  const html = renderToStaticMarkup(
    <PublicDocument
      slug={slug}
      title="page"
      intro="intro"
      eyebrow="nohmi"
      content="<h2>details</h2><p>readable content</p>"
    />,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(Boolean(document.querySelector(".public-editorial"))).toBe(
    ["about", "support", ...guideSlugs].includes(slug),
  );
  expect(document.querySelector("main")?.textContent).toContain("readable content");
  expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(`/${slug}/`);
});

it.each([
  "mail",
  "tasks",
  "calendar",
  "finances",
])("renders a real screenshot and separated example for %s", (workspace) => {
  const html = renderToStaticMarkup(
    <PublicDocument
      slug={`docs/${workspace}`}
      title="guide"
      intro="intro"
      eyebrow="nohmi"
      content="<h2>instructions</h2><h3>what you can do</h3><!-- guide:screenshot --><p>manual instructions</p><!-- guide:manual --><h3>what an agent can do</h3><p>agent instructions</p><!-- guide:agent -->"
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector(".public-guide-screenshot img")?.getAttribute("src")).toContain(
    `${workspace}-premiere.jpg`,
  );
  expect(doc.querySelector("main")?.textContent).toContain("example workflow");
  expect(
    doc.querySelectorAll('.public-guide-example [data-variant="muted"]').length,
  ).toBeGreaterThanOrEqual(1);
  expect(doc.querySelector(".public-guide-walkthrough")?.firstElementChild?.textContent).toContain(
    "instructions",
  );
  expect(doc.querySelectorAll('nav[aria-label="document navigation"] a')).toHaveLength(7);
});
