import { ApiClientError } from "@personal-os/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  captureFinanceOnboardingAccess,
  confirmFinanceOnboardingRead,
  denyFinanceOnboardingAccess,
  isFinanceOnboardingAccessCurrent,
} from "./onboarding-access";

function fixture() {
  const cache = new QueryClient();
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["finance-onboarding"], { source: "private" });
  return cache;
}
describe("Finance onboarding denial barrier", () => {
  it.each([
    401, 403,
  ])("clears private snapshots on authoritative %s and fences older responses", (status) => {
    const cache = fixture();
    const old = captureFinanceOnboardingAccess(cache);
    expect(
      denyFinanceOnboardingAccess(
        cache,
        old,
        new ApiClientError({ status, code: "forbidden", message: "Denied" }),
      ),
    ).toBe(true);
    expect(cache.getQueryData(["finance-onboarding"])).toBeUndefined();
    expect(isFinanceOnboardingAccessCurrent(cache, old)).toBe(false);
    expect(confirmFinanceOnboardingRead(cache, old)).toBe(false);
    const fresh = captureFinanceOnboardingAccess(cache);
    expect(fresh.denied).toBe(true);
    expect(confirmFinanceOnboardingRead(cache, fresh)).toBe(true);
    expect(captureFinanceOnboardingAccess(cache).denied).toBe(false);
    expect(confirmFinanceOnboardingRead(cache, old)).toBe(false);
  });
  it("retains a valid snapshot for transient failures without creating denial", () => {
    const cache = fixture();
    const current = captureFinanceOnboardingAccess(cache);
    expect(
      denyFinanceOnboardingAccess(
        cache,
        current,
        new ApiClientError({ status: 503, code: "unavailable", message: "Offline" }),
      ),
    ).toBe(false);
    expect(cache.getQueryData(["finance-onboarding"])).toEqual({ source: "private" });
    expect(isFinanceOnboardingAccessCurrent(cache, current)).toBe(true);
  });
  it("ignores denials from a previous account epoch", () => {
    const cache = fixture();
    const old = captureFinanceOnboardingAccess(cache);
    cache.setQueryData(["me"], { id: "other" });
    expect(
      denyFinanceOnboardingAccess(
        cache,
        old,
        new ApiClientError({ status: 403, code: "forbidden", message: "Denied" }),
      ),
    ).toBe(false);
    expect(captureFinanceOnboardingAccess(cache).denied).toBe(false);
  });
});
