import { inboxScope } from "../../../features/mail/logic";
import { MailThreadList } from "../../../features/mail/thread-list";
export default function Page() {
  return <MailThreadList scope={inboxScope} />;
}
