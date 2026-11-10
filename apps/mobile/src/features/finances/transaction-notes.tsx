import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { Icon } from "../../components/icons";
import { useTheme, workspaceColor } from "../../theme";
import { useFinance } from "./data";
import { appliedTransaction } from "./mutations";
import { FinanceRow } from "./ui";

export function TransactionNotes({ item }: { item: FinanceTransaction }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const [draft, setDraft] = useState<{ notes: string; revision: string } | null>(null);
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
      if (active.current === owner)
        toast.error(
          "Couldn’t confirm the save. Your note is still here; check the transaction before retrying.",
          { id },
        );
      else toast.dismiss(id);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }
  return (
    <>
      <FinanceRow
        centered
        title="Notes"
        value={draft ? "Editing" : item.notes ? "Added" : "Add a note"}
        icon="edit"
        onPress={
          draft ? undefined : () => setDraft({ notes: item.notes ?? "", revision: item.updatedAt })
        }
      />
      {draft ? (
        <View style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel="Transaction note"
            multiline
            maxLength={4000}
            value={draft.notes}
            onChangeText={(notes) => setDraft({ ...draft, notes })}
            editable={!pending && !submitted}
            placeholder="Birthday gift for Maya."
            placeholderTextColor={t.secondary}
            style={{ color: t.ink, fontSize: 16, minHeight: 88, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={() => {
                const close = () => {
                  setDraft(null);
                  setSubmitted(false);
                };
                if (!submitted && (draft.notes.trim() || null) !== item.notes)
                  Alert.alert("Discard note changes?", "Your unsaved note will be lost.", [
                    { text: "Keep editing", style: "cancel" },
                    { text: "Discard", style: "destructive", onPress: close },
                  ]);
                else close();
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: t.ink }}>
                {submitted || (draft.notes.trim() || null) === item.notes ? "Close" : "Cancel"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save note"
              disabled={pending || submitted || (draft.notes.trim() || null) === item.notes}
              onPress={() => void save()}
              style={{
                minHeight: 44,
                minWidth: 44,
                justifyContent: "center",
                alignItems: "center",
                opacity:
                  pending || submitted || (draft.notes.trim() || null) === item.notes ? 0.5 : 1,
              }}
            >
              <Icon name="save" color={workspaceColor(t, "finances")} />
            </Pressable>
          </View>
        </View>
      ) : item.notes ? (
        <Text style={{ color: t.secondary, fontSize: 15, paddingBottom: 12 }}>{item.notes}</Text>
      ) : null}
    </>
  );
}
