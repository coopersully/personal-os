import { refreshInstitutionBranding } from "./institution-branding.js";

const now = new Date("2026-10-29T12:00:00Z");
const branding = {
  institutionId: "ins_1",
  logo: null,
  primaryColor: "#004466",
  url: "https://bank.example",
};
const cached = {
  institutionId: "ins_1",
  institutionBranding: branding,
  brandingNextRefreshAt: new Date(now.getTime() + 60_000),
};
it("uses the durable cache until due", async () => {
  const fetch = vi.fn();
  expect(await refreshInstitutionBranding(cached, "ins_1", now, fetch)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("caches branding and missing artwork for seven days", async () => {
  const fetch = vi.fn().mockResolvedValue(branding);
  expect(
    await refreshInstitutionBranding(
      { ...cached, brandingNextRefreshAt: null },
      "ins_1",
      now,
      fetch,
    ),
  ).toEqual({
    institutionId: "ins_1",
    institutionBranding: branding,
    brandingNextRefreshAt: new Date(now.getTime() + 7 * 86_400_000),
    brandingFailureCode: null,
  });
  expect(fetch).toHaveBeenCalledWith("ins_1");
});
it("keeps last good branding and retries a failure in one hour without raw errors", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("secret-provider-canary"));
  const result = await refreshInstitutionBranding(
    { ...cached, brandingNextRefreshAt: null },
    "ins_1",
    now,
    fetch,
  );
  expect(result).toMatchObject({
    institutionBranding: branding,
    brandingFailureCode: "institution_branding_unavailable",
    brandingNextRefreshAt: new Date(now.getTime() + 3_600_000),
  });
  expect(JSON.stringify(result)).not.toContain("canary");
});
it("never shows the old institution's branding after identity changes", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("unavailable"));
  expect(await refreshInstitutionBranding(cached, "ins_2", now, fetch)).toMatchObject({
    institutionId: "ins_2",
    institutionBranding: null,
  });
});
it("does not fetch or invent an institution when no identity is available", async () => {
  const fetch = vi.fn();
  expect(await refreshInstitutionBranding(cached, null, now, fetch)).toMatchObject({
    institutionId: null,
    institutionBranding: null,
  });
  expect(fetch).not.toHaveBeenCalled();
});
