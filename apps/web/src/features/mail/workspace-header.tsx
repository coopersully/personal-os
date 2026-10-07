import type { ReactNode } from "react";
export function MailAppBarControls({ sync, search }: { sync: ReactNode; search: ReactNode }) {
  return (
    <div className="mail-app-bar__controls">
      {search}
      {sync}
    </div>
  );
}
