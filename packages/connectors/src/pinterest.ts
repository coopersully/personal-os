import { type PinterestPin, pinterestBoardUrlSchema } from "@personal-os/domain";

export class PinterestBoardError extends Error {
  constructor(
    public readonly code: "invalid_request" | "not_found" | "service_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PinterestBoardError";
  }
}

const MAX_BOARD_BYTES = 4 * 1024 * 1024;
const BOARD_TIMEOUT_MS = 10_000;

/** Public board HTML is provider material: callers never receive an arbitrary fetch capability. */
export async function fetchPinterestBoardPins(
  rawUrl: string,
  requestFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<PinterestPin[]> {
  const parsed = pinterestBoardUrlSchema.safeParse(rawUrl);
  if (!parsed.success) {
    throw new PinterestBoardError(
      "invalid_request",
      "Provide the URL of a public Pinterest board.",
    );
  }
  const url = new URL(parsed.data);
  // Normalize regional/apex URLs before fetching. Do not follow provider open redirects.
  url.hostname = "www.pinterest.com";
  url.search = "";
  url.hash = "";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new PinterestBoardError(
          "service_unavailable",
          "Pinterest took too long to load the public board. Retry.",
        ),
      );
    }, BOARD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await requestFetch(url.toString(), {
          headers: { "user-agent": "nohmi wallpaper/1.0" },
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new PinterestBoardError(
            "service_unavailable",
            "Pinterest could not load that public board right now.",
          );
        }
        if (Number(response.headers.get("content-length")) > MAX_BOARD_BYTES) {
          await response.body?.cancel();
          throw new PinterestBoardError(
            "service_unavailable",
            "The Pinterest board response exceeded the 4 MiB limit.",
          );
        }
        const reader = response.body?.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        let size = 0;
        let page = "";
        if (reader) {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > MAX_BOARD_BYTES) {
                throw new PinterestBoardError(
                  "service_unavailable",
                  "The Pinterest board response exceeded the 4 MiB limit.",
                );
              }
              page += decoder.decode(chunk.value, { stream: true });
            }
            page += decoder.decode();
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
            activeReader = undefined;
          }
        }
        // Pinterest can return a successful discovery/login page for a missing board.
        // Accept only the board resource and its feed, never unrelated page images.
        const script = page.match(
          /<script[^>]*id=["']__PWS_INITIAL_PROPS__["'][^>]*>([\s\S]*?)<\/script>/i,
        )?.[1];
        let resources: Record<string, Record<string, { data?: unknown }>> = {};
        try {
          resources = script ? (JSON.parse(script).initialReduxState?.resources ?? {}) : {};
        } catch {
          /* Unrecognized provider responses fail closed below. */
        }
        const board = Object.values(resources.BoardResource ?? {})
          .map((entry) => entry.data)
          .find((data): data is { id: string; url: string } => {
            if (
              !data ||
              typeof data !== "object" ||
              !("id" in data) ||
              !("url" in data) ||
              typeof data.id !== "string" ||
              typeof data.url !== "string"
            )
              return false;
            try {
              const resourceUrl = new URL(data.url, url.origin);
              return (
                resourceUrl.origin === url.origin &&
                resourceUrl.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")
              );
            } catch {
              return false;
            }
          });
        const images = new Set<string>();
        for (const [key, entry] of Object.entries(resources.BoardFeedResource ?? {})) {
          if (!board || !Array.isArray(entry.data)) continue;
          let options: unknown;
          try {
            options = JSON.parse(key);
          } catch {
            continue;
          }
          if (
            !Array.isArray(options) ||
            !options.some(
              (pair) => Array.isArray(pair) && pair[0] === "board_id" && pair[1] === board.id,
            )
          )
            continue;
          for (const pin of entry.data) {
            if (pin?.type !== "pin") continue;
            const image =
              pin.images?.["736x"]?.url ??
              pin.images?.orig?.url ??
              pin.images?.["474x"]?.url ??
              pin.images?.["236x"]?.url;
            if (typeof image !== "string" || image.length > 2048) continue;
            if (
              !/^https:\/\/i\.pinimg\.com\/(?:\d+x|originals)\/[^"\\\s?]+?\.(?:avif|jpe?g|png|webp)$/i.test(
                image,
              )
            )
              continue;
            images.add(image.replace(/\/\d+x\//, "/736x/"));
            if (images.size >= 100) break;
          }
          if (images.size >= 100) break;
        }
        if (!images.size) {
          throw new PinterestBoardError(
            "not_found",
            "Pinterest could not resolve that public board and its images. Check that the board exists and is public.",
          );
        }
        return [...images].map((imageUrl) => ({ id: imageUrl, imageUrl, title: null }));
      })(),
    ]);
  } catch (error) {
    if (error instanceof PinterestBoardError) throw error;
    throw new PinterestBoardError(
      "service_unavailable",
      "Pinterest could not load that public board right now.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    void activeReader?.cancel().catch(() => undefined);
  }
}
