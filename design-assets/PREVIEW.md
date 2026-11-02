# Temporary public preview delivery

The shared marketing preview serves only `apps/web/dist` from loopback port 57892;
it does not expose the authenticated API or database. The development runtime remains
worktree-owned and separate. Keep the temporary static server and tunnel alive while reviewing.

On October 23, an iPhone Safari user-agent request without cookies or special headers to the
ngrok preview returned HTTP 200 `text/html` containing ngrok's interstitial for an image URL.
Earlier checks used `ngrok-skip-browser-warning` and therefore failed to exercise visitor delivery.
Cached app HTML plus warning responses is a plausible explanation for visible pages with missing
images; direct device-side cache state was not observable.

Replacement: Cloudflare Quick Tunnel, installed from Homebrew core, forwarding the same public
static server. Command: `cloudflared tunnel --url http://127.0.0.1:57892 --no-autoupdate`.
Current temporary URL: https://keno-new-possibilities-pvc.trycloudflare.com/

Verification: request every current image using an iPhone Safari user agent, no cookies and no
bypass headers; require HTTP 200, an image content type, and exact bytes matching the local file.
Also check rendering in the browser. An HTTP 200 alone is insufficient. The URL is temporary,
with no uptime guarantee; stop the tunnel to revoke it. A new tunnel run produces a new URL.
