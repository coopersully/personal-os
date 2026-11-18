import { financeInstitutionBrandingSchema } from "@personal-os/domain";
import type { CSSProperties } from "react";
import { financeAccountType } from "./account-type";
import { financeAccountTypeIcon } from "./account-type-icon";
import type { FinancialCardIdentity } from "./financial-account-card";
import { InstitutionLogo } from "./institution-logo";

/** Institution artwork stays primary; the corner glyph identifies the product. */
export function AccountPreview({ account }: { account: FinancialCardIdentity }) {
  const type = financeAccountType(account);
  const TypeIcon = financeAccountTypeIcon(type);
  const color = financeInstitutionBrandingSchema.shape.primaryColor.safeParse(
    account.institutionBranding?.primaryColor,
  );
  const style =
    color.success && color.data
      ? ({ "--account-preview-color": color.data } as CSSProperties)
      : undefined;
  return (
    <span className="account-preview" style={style} data-account-type={type} aria-hidden="true">
      <InstitutionLogo
        institution={account.institution}
        branding={account.institutionBranding}
        decorative
      />
      <span className="account-preview__type">
        <TypeIcon className="size-3" aria-hidden="true" />
      </span>
    </span>
  );
}
