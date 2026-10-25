import type { ReactNode } from "react";
export function MailAppBarControls({
  sync,
  search,
  accounts,
}: {
  sync: ReactNode;
  search: ReactNode;
  accounts: ReactNode;
}) {
  return (
    <div className="mail-app-bar__controls">
      {search}
      {accounts}
      {sync}
    </div>
  );
}
