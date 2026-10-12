import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PublicDocument } from "../src/features/public-site/document.js";
import { ProductLanding } from "../src/features/public-site/landing.js";
import { publicDocuments } from "../src/features/public-site/layout.js";

const root = new URL("../", import.meta.url);
const landingDirectory = new URL(".public-site/", root);
await mkdir(landingDirectory, { recursive: true });
await writeFile(
  new URL("landing.fragment", landingDirectory),
  renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <ProductLanding />
    </MemoryRouter>,
  ),
);
const theme = await readFile(new URL("src/styles.css", root), "utf8");
const darkTokens = theme.match(/^\.dark \{([\s\S]*?)^\}/m)?.[1];
if (!darkTokens) throw new Error("Missing shared dark theme tokens.");
for (const { slug } of publicDocuments) {
  let content = await readFile(new URL(`content/public/${slug}.html`, root), "utf8");
  function take(pattern: RegExp) {
    const match = content.match(pattern);
    if (!match?.[1]) throw new Error(`Missing document metadata: ${slug}`);
    content = content.replace(match[0], "");
    return match[1];
  }
  const eyebrow = take(/<p class="eyebrow">([^<]+)<\/p>/);
  const title = take(/<h1>([^<]+)<\/h1>/);
  const intro = take(/<p class="intro">([^<]+)<\/p>/);
  const html = renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={intro} />
        <title>{`${title} · nohmi`}</title>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/src/styles.css?direct" />
        <style>{`@media (prefers-color-scheme: dark) { :root { ${darkTokens} } }`}</style>
      </head>
      <body>
        <PublicDocument {...{ slug, title, intro, eyebrow, content }} />
      </body>
    </html>,
  );
  const directory = new URL(`public/${slug}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("index.html", directory), `<!doctype html>\n${html}\n`);
}
console.log(
  `Rendered ${publicDocuments.length} public documents into ${fileURLToPath(new URL("public/", root))}`,
);
