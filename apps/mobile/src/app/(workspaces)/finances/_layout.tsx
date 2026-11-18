import { WorkspaceTabs } from "../../../components/workspace-tabs";
import { useAssistantBadge } from "../../../features/finances/conversation-unread";
export default function Layout() {
  const unread = useAssistantBadge();
  return <WorkspaceTabs workspace="finances" badges={unread ? { assistant: unread } : undefined} />;
}
