import type { QueryClient } from "@tanstack/react-query";

export function resetDesktopSession(cache: QueryClient) {
  // Retain mounted query observers so App sees the reset and returns to sign-in.
  // A document navigation can detach the packaged WKWebView during menu actions.
  cache.getMutationCache().clear();
  return cache.resetQueries();
}
