import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@/components/icons";
import { SettingsRecord, SettingsRecordAction } from "@/components/settings-record";
import { ItemGroup } from "@/components/ui/item";
import { SettingsSection } from "./settings-layout";

/** Secondary destinations retain one canonical editor and a predictable parent. */
export function RelatedSettings({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; description: string; section: string; workspace?: string }>;
}) {
  return (
    <SettingsSection title={title}>
      <ItemGroup>
        {items.map((item) => (
          <SettingsRecord
            key={item.section}
            title={item.label}
            description={item.description}
            actions={
              <SettingsRecordAction asChild label={`Open ${item.label}`}>
                <Link
                  to={`/settings?${new URLSearchParams({ section: item.section, ...(item.workspace ? { workspace: item.workspace } : {}) })}`}
                >
                  <ChevronRightIcon />
                </Link>
              </SettingsRecordAction>
            }
          />
        ))}
      </ItemGroup>
    </SettingsSection>
  );
}
