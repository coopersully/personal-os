import { WorkspaceTabs } from "../../../components/workspace-tabs";
import { MailScopeProvider } from "../../../features/mail/scope";
export default function Layout() {
  return (
    <MailScopeProvider>
      <WorkspaceTabs workspace="mail" />
    </MailScopeProvider>
  );
}
