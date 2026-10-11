import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("production nginx keeps public directory redirects on the visitor's HTTPS origin", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nohmi-public-nginx-"));
  // The production nginx worker runs as an unprivileged container user.
  chmodSync(directory, 0o755);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = ["about", "docs", "privacy", "terms", "data-use", "sms", "support"];
  writeFileSync(join(directory, "index.html"), "<h1>Product landing</h1>");
  for (const path of paths) {
    mkdirSync(join(directory, path));
    writeFileSync(join(directory, path, "index.html"), `<h1>${path}</h1>`);
  }
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  const image = dockerfile.match(/^FROM (\S+) AS web$/m)?.[1];
  assert.ok(image, "Use the same nginx image as the production web container");
  const { stdout } = await execute("docker", [
    "run",
    "--detach",
    "--rm",
    "--publish",
    "127.0.0.1::8080",
    "--volume",
    `${directory}:/usr/share/nginx/html:ro`,
    "--volume",
    `${new URL("../nginx.conf", import.meta.url).pathname}:/etc/nginx/conf.d/default.conf:ro`,
    image,
  ]);
  const container = stdout.trim();
  t.after(async () => {
    await execute("docker", ["rm", "--force", container]);
  });
  const { stdout: port } = await execute("docker", ["port", container, "8080/tcp"]);
  const origin = `http://${port.trim()}`;
  const request = (path) =>
    fetch(`${origin}${path}`, {
      redirect: "manual",
      headers: { Host: "nohmi.coopersully.me", "X-Forwarded-Proto": "https" },
      signal: AbortSignal.timeout(2000),
    });
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    try {
      ready = (await request("/health/live")).ok;
    } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Production nginx starts within five seconds");
  for (const path of paths) {
    const response = await request(`/${path}?source=policy`);
    assert.equal(response.status, 301);
    const location = response.headers.get("location");
    assert.equal(location, `/${path}/?source=policy`);
    const publicDestination = new URL(location, "https://nohmi.coopersully.me");
    assert.equal(publicDestination.origin, "https://nohmi.coopersully.me");
    const document = await request(publicDestination.pathname + publicDestination.search);
    assert.equal(document.status, 200);
    assert.equal(await document.text(), `<h1>${path}</h1>`);
  }
});
