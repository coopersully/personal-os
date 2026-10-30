import {
  type FinanceInstitutionBranding,
  financeInstitutionBrandingSchema,
} from "@personal-os/domain";

type Cache = {
  institutionId: string | null;
  institutionBranding: FinanceInstitutionBranding | null;
  brandingNextRefreshAt: Date | null;
};
/** Optional decoration cannot turn a healthy account synchronization into a failure. */
export async function refreshInstitutionBranding(
  cache: Cache,
  institutionId: string | null,
  now: Date,
  fetch: (id: string) => Promise<FinanceInstitutionBranding>,
): Promise<(Cache & { brandingFailureCode: string | null }) | null> {
  const sameInstitution = cache.institutionId === institutionId;
  if (sameInstitution && cache.brandingNextRefreshAt && cache.brandingNextRefreshAt > now)
    return null;
  if (!institutionId)
    return {
      institutionId: null,
      institutionBranding: null,
      brandingNextRefreshAt: new Date(now.getTime() + 7 * 86_400_000),
      brandingFailureCode: null,
    };
  try {
    const branding = financeInstitutionBrandingSchema.parse(await fetch(institutionId));
    if (branding.institutionId !== institutionId) throw new Error("Mismatched institution");
    return {
      institutionId,
      institutionBranding: branding,
      brandingNextRefreshAt: new Date(now.getTime() + 7 * 86_400_000),
      brandingFailureCode: null,
    };
  } catch {
    return {
      institutionId,
      institutionBranding: sameInstitution ? cache.institutionBranding : null,
      brandingNextRefreshAt: new Date(now.getTime() + 3_600_000),
      brandingFailureCode: "institution_branding_unavailable",
    };
  }
}
