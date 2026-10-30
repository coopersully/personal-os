import type { FinanceAccount } from "@personal-os/domain";
import { BrandMark } from "@/components/brand-marks";

/** One logo treatment across cards, tables, settings and account repair. */
export function InstitutionLogo({
  institution,
  branding,
  decorative = false,
}: {
  institution: string;
  branding?: FinanceAccount["institutionBranding"];
  decorative?: boolean;
}) {
  return (
    <span className="institution-logo">
      <BrandMark
        brand={institution}
        imageUrl={branding?.logo ?? null}
        decorative={decorative}
        label={`${institution} logo`}
        className="institution-logo__image size-full"
      />
    </span>
  );
}
