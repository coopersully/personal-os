import { type KnowledgeRecord, knowledgeTrashRetentionMs } from "@personal-os/domain";
import { Alert } from "react-native";
import { Section } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import { MemoryNote } from "./controls";
import { memoryDate } from "./presentation";

/** What Trash and delete now cannot reach; both confirmations say so. */
export const trashLimits =
  "Older backups may still contain this until they're deleted. Agents that already read it may remember it.";

/** The Trash confirmation names the linked memories it leaves behind, so they can go too. */
export function trashMessage(linked: readonly string[]) {
  const derived =
    "This memory and any memory derived from it move to Trash. You can restore them for 30 days; then they're deleted for good.";
  const kept = linked.length
    ? `\n\nLinked memories stay where they are:\n${linked.map((title) => `• ${title}`).join("\n")}`
    : "";
  return `${derived}${kept}\n\n${trashLimits}`;
}

export function confirmTrash(title: string, linked: readonly string[], trash: () => void) {
  Alert.alert(`Move “${title}” to Trash?`, trashMessage(linked), [
    { text: "Cancel", style: "cancel" },
    { text: "Move to Trash", style: "destructive", onPress: trash },
  ]);
}

export function confirmDeleteNow(title: string, remove: () => void) {
  Alert.alert(
    `Delete “${title}” now?`,
    `This erases it, and every memory trashed with it, right away. This can't be undone.\n\n${trashLimits}`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete now", style: "destructive", onPress: remove },
    ],
  );
}

/**
 * A trashed memory's state and its Trash actions. Restore and delete now act on the whole
 * group, so only the memory the person trashed (the group's root) offers them.
 */
export function TrashedMemory({
  record,
  trashedAt,
  disabled,
  open,
  restore,
  deleteNow,
}: {
  record: KnowledgeRecord;
  trashedAt: string;
  disabled: boolean;
  open: (id: string) => void;
  restore: () => void;
  deleteNow: () => void;
}) {
  const purgeAt = new Date(Date.parse(trashedAt) + knowledgeTrashRetentionMs).toISOString();
  const groupId = record.trashGroupId;
  const root = groupId === null || groupId === record.id;
  return (
    <Section title="Trash">
      <MemoryNote>
        {`Moved to Trash ${memoryDate(trashedAt)}. It will be deleted for good ${memoryDate(purgeAt)}.`}
      </MemoryNote>
      {root ? (
        <>
          <SettingsActionRow label="Restore" icon="history" onPress={restore} disabled={disabled} />
          <SettingsActionRow
            label="Delete now"
            icon="trash"
            destructive
            onPress={deleteNow}
            disabled={disabled || record.trashVersion === undefined}
          />
        </>
      ) : (
        <>
          <MemoryNote>
            This memory moved to Trash with the memory it came from. Restore or delete that one.
          </MemoryNote>
          <SettingsActionRow
            label="Open the memory it moved with"
            onPress={() => open(groupId)}
            disabled={disabled}
          />
        </>
      )}
    </Section>
  );
}
