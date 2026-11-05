// Exercise the shipped sample under the real production service worker, without account data.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve, relative, extname } = require("node:path");
const root = resolve(__dirname, "../dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
(async () => {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    // This existing excluded public route provides a controlled, account-free test harness.
    if (pathname === "/privacy/active-cards-build-check") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<iframe title="cards" src="/active-cards-playground.html?embedded=1"></iframe>',
      );
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const file = resolve(root, pathname.slice(1));
    if (relative(root, file).startsWith("..")) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log("preview page error", error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.log("preview console error", message.text());
    });
    await page.addInitScript(() => {
      window.addEventListener("message", (event) => {
        if (event.origin === location.origin && event.data?.type === "nohmi:active-cards-ready")
          window.previewReady = true;
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/privacy/active-cards-build-check`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload();
    assert(
      await page.evaluate(() => !!navigator.serviceWorker.controller),
      "Production worker must control navigation",
    );
    try {
      await page.waitForFunction(() => window.previewReady === true, { timeout: 10_000 });
    } catch (error) {
      console.log(
        "frames",
        await Promise.all(
          page.frames().map(async (frame) => ({
            url: frame.url(),
            title: await frame.title(),
            items: await frame.locator(".item").count(),
            text: (await frame.locator("body").innerText()).slice(0, 150),
          })),
        ),
      );
      throw error;
    }
    await page
      .frameLocator('iframe[title="cards"]')
      .locator(".item")
      .first()
      .waitFor({ state: "visible" });
    console.log("PASS production service-worker-controlled settings preview handshake and cards");
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
