import type { FinanceAccount } from "@personal-os/domain";
import { AccountPreview } from "./account-preview";
import { financeAccountTypeLabel } from "./account-type";

type BankAccountProfile = Pick<
  FinanceAccount,
  | "name"
  | "institution"
  | "kind"
  | "provider"
  | "providerSubtype"
  | "accountMask"
  | "institutionBranding"
> &
  Partial<Pick<FinanceAccount, "providerType">>;

/** Compact shared account identity; full cards use FinancialAccountCard. */
export function BankAccount({
  account,
  showType = true,
}: {
  account: BankAccountProfile;
  showType?: boolean;
}) {
  const type = financeAccountTypeLabel(account);
  const subtype = account.providerSubtype?.replaceAll("_", " ");
  return (
    <span className="account-profile">
      <AccountPreview account={account} />
      <span className="account-profile__copy">
        <span className="account-profile__name">{account.name}</span>
        <span className="account-profile__details">
          {account.institution}
          {showType ? ` · ${type}` : ""}
          {account.accountMask ? ` · •••• ${account.accountMask}` : ""}
          {showType && subtype && subtype.toLowerCase() !== type.toLowerCase()
            ? ` · ${subtype}`
            : ""}
          {account.provider === "manual" ? " · Manually tracked" : ""}
        </span>
      </span>
    </span>
  );
}
