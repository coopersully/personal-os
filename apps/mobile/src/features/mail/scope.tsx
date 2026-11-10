import { createContext, type PropsWithChildren, useContext, useState } from "react";
export const mailFolders = [
  { role: "inbox", label: "Inbox", icon: "inbox" },
  { role: "sent", label: "Sent", icon: "send" },
  { role: "drafts", label: "Drafts", icon: "edit" },
  { role: "archive", label: "Archive", icon: "archive" },
  { role: "trash", label: "Trash", icon: "trash" },
] as const;
export type MailFolder = (typeof mailFolders)[number]["role"];
const MailScope = createContext({
  accountId: "",
  accountLabel: "All accounts",
  setAccountId: (_id: string, _label?: string) => {},
});
export function MailScopeProvider({ children }: PropsWithChildren) {
  const [scope, setScope] = useState({ accountId: "", accountLabel: "All accounts" });
  const setAccountId = (accountId: string, accountLabel = "All accounts") =>
    setScope({ accountId, accountLabel });
  return <MailScope.Provider value={{ ...scope, setAccountId }}>{children}</MailScope.Provider>;
}
export const useMailScope = () => useContext(MailScope);
