import {
  BankIcon,
  BanknoteIcon,
  DollarIcon,
  LayersIcon,
  PaymentCardIcon,
  TrendChartIcon,
  WalletIcon,
} from "@/components/icons";
import type { AccountType } from "./account-type";

const accountTypeIcons = {
  credit_card: PaymentCardIcon,
  debit_card: PaymentCardIcon,
  bank: BankIcon,
  investment: TrendChartIcon,
  loan: DollarIcon,
  credit_line: WalletIcon,
  cash: BanknoteIcon,
  debt: WalletIcon,
  other: LayersIcon,
};

export function financeAccountTypeIcon(type: AccountType) {
  return accountTypeIcons[type];
}
