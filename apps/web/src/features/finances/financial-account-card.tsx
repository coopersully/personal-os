import { type FinanceAccount, financeInstitutionBrandingSchema } from "@personal-os/domain";
import type { CSSProperties, ReactNode } from "react";
import { PaymentCardIcon } from "@/components/icons";
import { financeAccountBalance, financeAccountTypeLabel } from "./account-type";
import { InstitutionLogo } from "./institution-logo";

/** Pick the higher-contrast text, including for unusually light institution palettes. */
export function institutionCardStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !financeInstitutionBrandingSchema.shape.primaryColor.safeParse(color).success)
    return;
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  return { backgroundColor: color, color: luminance > 0.179 ? "#000000" : "#ffffff" };
}

export type FinancialCardIdentity = Pick<
  FinanceAccount,
  "name" | "institution" | "kind" | "providerSubtype"
> &
  Partial<Pick<FinanceAccount, "providerType" | "accountMask" | "institutionBranding">>;

type FinancialAccountCardProps =
  | { account: FinanceAccount; compact?: false; actions?: ReactNode }
  | { account: FinancialCardIdentity; compact: true; actions?: never };

/** Bank-branded account representation; never claims to reproduce the physical card. */
export function FinancialAccountCard(props: FinancialAccountCardProps) {
  const { account } = props;
  if (props.compact)
    return (
      <span
        className="financial-account-card financial-account-card--compact"
        style={institutionCardStyle(account.institutionBranding?.primaryColor)}
        data-slot="financial-account-card"
        aria-hidden="true"
      >
        <InstitutionLogo
          institution={account.institution}
          branding={account.institutionBranding}
          decorative
        />
        <PaymentCardIcon
          className="financial-account-card__compact-type size-3"
          aria-hidden="true"
        />
      </span>
    );
  return (
    <div className="financial-account-card-frame">
      <div
        className="financial-account-card"
        style={institutionCardStyle(account.institutionBranding?.primaryColor)}
        data-slot="financial-account-card"
      >
        <div className="financial-account-card__header">
          <div className="financial-account-card__issuer">
            <InstitutionLogo
              institution={account.institution}
              branding={account.institutionBranding}
              decorative
            />
            <span>{account.institution}</span>
          </div>
          {props.actions}
        </div>
        <div className="financial-account-card__identity">
          <span className="financial-account-card__chip" aria-hidden="true" />
          <span className="financial-account-card__name">{account.name}</span>
          <span className="financial-account-card__type">{financeAccountTypeLabel(account)}</span>
        </div>
        <div className="financial-account-card__bottom">
          <span className="financial-account-card__mask">
            {account.accountMask ? `•••• ${account.accountMask}` : null}
          </span>
          <span className="financial-account-card__balance">
            <span>{account.kind === "debt" ? "Amount owed" : "Current balance"}</span>
            <strong>{financeAccountBalance(props.account)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
