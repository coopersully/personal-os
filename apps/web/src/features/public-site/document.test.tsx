// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { PublicDocument } from "./document.js";

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
