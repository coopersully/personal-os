import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, Text, TextInput } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { spacing, useTheme } from "../../theme";
import { useFinance } from "./data";
import { appliedTransaction } from "./mutations";
import { FinanceRow } from "./ui";

export function TransactionNotes({ item }: { item: FinanceTransaction }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const [draft, setDraft] = useState<{
    notes: string;
    revision: string;
    baseNotes: string | null;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  // A category-only change can advance the transaction without changing the note's base.
  // Keep the typed draft, and never silently rebase over somebody else's note edit.
  useEffect(() => {
    setDraft((current) =>
      current && current.baseNotes === item.notes && current.revision !== item.updatedAt
        ? { ...current, revision: item.updatedAt }
        : current,
    );
  }, [item.notes, item.updatedAt]);
  async function save() {
    if (!owner || !draft || busy.current || submitted) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Saving note…");
    try {
      const result = await api.updateFinanceTransaction(item.id, {
        notes: draft.notes.trim() || null,
        expectedTransactionUpdatedAt: draft.revision,
      });
      if (active.current !== owner) {
        toast.dismiss(id);
        return;
      }
      const saved = appliedTransaction<FinanceTransaction>(result);
      if (saved) {
        client.setQueryData(["finances", owner, "transaction", item.id], { data: saved });
        setDraft(null);
        toast.success("Note updated", { id });
        void client.invalidateQueries({ queryKey: ["finances", owner] });
      } else {
        setSubmitted(true);
        toast.info("Submitted for review. The note has not changed.", { id });
      }
    } catch {
      if (active.current === owner) {
        void client.invalidateQueries({ queryKey: ["finances", owner, "transaction", item.id] });
        toast.error(
          "Couldn’t confirm the save. Your note is still here; check the transaction before retrying.",
          { id },
        );
      } else toast.dismiss(id);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }
  // Nothing to lose: the note is already submitted or matches what is saved.
  const unchanged = submitted || (draft ? (draft.notes.trim() || null) === item.notes : true);
  return (
    <>
      <FinanceRow
        centered
        title="Notes"
        value={draft ? "Editing" : item.notes ? "Added" : "Add a note"}
        icon="edit"
        onPress={
          draft
            ? undefined
            : () =>
                setDraft({
                  notes: item.notes ?? "",
                  revision: item.updatedAt,
                  baseNotes: item.notes,
                })
        }
      />
      {draft ? (
        <SettingsAccentProvider workspace="finances">
          <TextInput
            accessibilityLabel="Transaction note"
            multiline
            maxLength={4000}
            value={draft.notes}
            onChangeText={(notes) => setDraft({ ...draft, notes })}
            editable={!pending && !submitted}
            placeholder="Birthday gift for Maya."
            placeholderTextColor={t.secondary}
            style={{
              color: t.ink,
              fontSize: 17,
              minHeight: 88,
              padding: 0,
              textAlignVertical: "top",
            }}
          />
          <Actions inset={false}>
            <Action
              label={unchanged ? "Close" : "Cancel"}
              disabled={pending}
              onPress={() => {
                const close = () => {
                  setDraft(null);
                  setSubmitted(false);
                };
                if (!unchanged)
                  Alert.alert("Discard note changes?", "Your unsaved note will be lost.", [
                    { text: "Keep editing", style: "cancel" },
                    { text: "Discard", style: "destructive", onPress: close },
                  ]);
                else close();
              }}
            />
            <Action
              label="Save"
              accessibilityLabel="Save note"
              disabled={pending || submitted || (draft.notes.trim() || null) === item.notes}
              onPress={() => void save()}
            />
          </Actions>
        </SettingsAccentProvider>
      ) : item.notes ? (
        <Text
          style={{ color: t.secondary, fontSize: 15, lineHeight: 21, paddingBottom: spacing.md }}
        >
          {item.notes}
        </Text>
      ) : null}
    </>
  );
}
