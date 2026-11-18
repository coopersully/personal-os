import { type KnowledgeTagIndex, normalizeKnowledgeTag } from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { useCallback, useState } from "react";
import { toast } from "sonner-native";
import { Field, Section } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import {
  detailsOf,
  type Feedback,
  type MemoryAccess,
  type MemoryApi,
  readMemory,
  statusOf,
  useMemoryCommands,
  useMemoryResource,
} from "./authority";
import { MemoryBody, MemoryChoice, MemoryNote, MemoryReadState } from "./controls";

type Props = {
  api: MemoryApi;
  access: MemoryAccess;
  retain: (id: string, feedback: Feedback) => void;
  /** Reloads every memory view after a merge or undo, since both retag records. */
  changed: () => void;
};

/** Renaming is a merge into the new name; undo restores the old tag on the records it had. */
export function MemoryTags({ api, access, retain, changed }: Props) {
  const load = useCallback(
    (signal: AbortSignal) => readMemory(access, signal, () => api.listKnowledgeTags()),
    [access, api],
  );
  const index = useMemoryResource(load);
  const commands = useMemoryCommands(access.capture, access.recover);
  const [from, setFrom] = useState("");
  const [into, setInto] = useState("");
  const tags = index.value?.tags ?? [];
  const source = tags.some((tag) => tag.name === from) ? from : (tags[0]?.name ?? "");
  const target = normalizeKnowledgeTag(into);

  function merge() {
    if (!source) return;
    if (!target || target === source) {
      toast.error("Enter a different tag name to merge into.");
      return;
    }
    void commands.run({
      loading: "Merging tags…",
      failure: "Couldn’t confirm the merge. Check the tags before trying again.",
      request: () =>
        api.mergeKnowledgeTags({ from: source, into: target, mutationKey: randomUUID() }),
      complete: (result) => {
        changed();
        return { message: `#${result.from} is now filed under #${result.into}.` };
      },
      retain,
    });
  }

  function unmerge(
    alias: KnowledgeTagIndex["aliases"][number],
    aliases: KnowledgeTagIndex["aliases"],
  ) {
    void commands.run({
      loading: "Undoing merge…",
      failure: "Couldn’t confirm the undo. Check the tags before trying again.",
      request: () =>
        api.unmergeKnowledgeTags({ mergeId: alias.mergeId, mutationKey: randomUUID() }),
      complete: (result) => {
        changed();
        return { message: `#${result.from} is its own tag again.` };
      },
      rejected: (error) => {
        if (statusOf(error) !== 409) return;
        const blocking = detailsOf(error).blockingMergeIds;
        const later = aliases.find(
          (entry) => Array.isArray(blocking) && blocking.includes(entry.mergeId),
        );
        return later
          ? `Undo the merge of #${later.alias} into #${later.name} first.`
          : "Undo the later merge of this tag first.";
      },
      retain,
    });
  }

  return (
    <MemoryBody onRefresh={index.refresh}>
      <MemoryReadState
        {...index}
        label="tags"
        retry={() => void index.reload().catch(() => toast.error("Couldn’t load tags."))}
        busy={commands.busy}
      />
      {index.value && (
        <>
          <Section title="Tags">
            {tags.length ? (
              tags.map((tag) => (
                <MemoryNote key={tag.name}>
                  {`#${tag.name} · ${tag.count === 1 ? "1 memory" : `${tag.count} memories`}`}
                </MemoryNote>
              ))
            ) : (
              <MemoryNote>No tags yet.</MemoryNote>
            )}
          </Section>
          {tags.length > 0 && (
            <Section title="Rename or merge">
              <MemoryChoice
                label="Tag"
                value={source}
                choices={tags.map((tag) => tag.name)}
                labels={Object.fromEntries(tags.map((tag) => [tag.name, `#${tag.name}`]))}
                onChange={setFrom}
                disabled={commands.busy}
              />
              <Field
                label="Merge into"
                value={into}
                onChange={setInto}
                placeholder="family"
                disabled={commands.busy}
              />
              <SettingsActionRow
                label="Merge tags"
                icon="categoryTags"
                onPress={merge}
                disabled={commands.busy || !into.trim()}
              />
            </Section>
          )}
          {index.value.aliases.length > 0 && (
            <Section title="Merged tags">
              {index.value.aliases.map((alias) => (
                <SettingsActionRow
                  key={alias.mergeId}
                  label={`Undo merge of #${alias.alias} into #${alias.name}`}
                  icon="history"
                  onPress={() => unmerge(alias, index.value?.aliases ?? [])}
                  disabled={commands.busy}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </MemoryBody>
  );
}
