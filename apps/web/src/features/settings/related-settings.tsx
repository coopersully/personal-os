import {
  CloudIcon,
  type Icon,
  LockIcon,
  PlugIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserIcon,
} from "@/components/icons";
import { ProfileRow, ProfileSection } from "./profile-rows";

const icons: Record<string, Icon> = {
  setup: SparklesIcon,
  profile: UserIcon,
  security: LockIcon,
  connections: CloudIcon,
  "agent-connections": PlugIcon,
  "workspace-access": ShieldCheckIcon,
  sessions: LockIcon,
  invitations: UserIcon,
};
/** Navigation rows use arrows; chevrons are reserved for modal editors. */
export function RelatedSettings({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; description: string; section: string; workspace?: string }>;
}) {
  return (
    <ProfileSection title={title}>
      {items.map((item) => {
        const Icon = icons[item.section] ?? SettingsIcon;
        return (
          <ProfileRow
            key={item.section}
            label={item.label}
            ariaLabel={`Open ${item.label}`}
            icon={
              <span className="profile-destination-icon">
                <Icon weight="Filled" />
              </span>
            }
            to={`/settings?${new URLSearchParams({ section: item.section, ...(item.workspace ? { workspace: item.workspace } : {}) })}`}
          />
        );
      })}
    </ProfileSection>
  );
}
