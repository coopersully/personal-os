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
    "This memory and any memory derived from it move to Trash. You can restore them for 30 days; after that they're deleted for good.";
  const kept = linked.length
    ? `\n\nMemories this one links to stay where they are:\n${linked.map((title) => `• ${title}`).join("\n")}`
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
    // Purging a memory also purges what was derived from it, even memories the person trashed
    // on their own earlier, which sit in Trash groups of their own.
    `This erases it and every memory trashed with it right away, along with any memories derived from it that you moved to Trash separately. This can't be undone.\n\n${trashLimits}`,
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
  groupId,
  disabled,
  open,
  restore,
  deleteNow,
}: {
  record: KnowledgeRecord;
  trashedAt: string;
  /** The trash group's root: the memory the person trashed. */
  groupId: string;
  disabled: boolean;
  open: (id: string) => void;
  restore: () => void;
  deleteNow: () => void;
}) {
  // The end of the restore period: the purge runs after it, not exactly then.
  const purgeAt = new Date(Date.parse(trashedAt) + knowledgeTrashRetentionMs).toISOString();
  const root = groupId === record.id;
  return (
    <Section title="Trash">
      <MemoryNote>
        {`Moved to Trash ${memoryDate(trashedAt)}. You can restore it until ${memoryDate(purgeAt)}; after that it’s deleted for good.`}
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
