import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { Icon } from "../../components/icons";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { categoryIcon } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, recordAmount } from "./presentation";
import { ReadState } from "./ui";

/** Keep the delivery key on uncertain retries; only a server receipt clears the draft. */
export function ConversationComposer() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const { transactionId } = useLocalSearchParams<{ transactionId?: string }>();
  const attachment = useFinanceRead(
    ["transaction", transactionId],
    (api) => {
      if (!transactionId) throw new Error("No transaction selected");
      return api.getFinanceTransaction(transactionId);
    },
    !!transactionId,
  );
  const attached = attachment.data?.data;
  const attachmentBlocked =
    !!transactionId && (!attached || attachment.isError || attached.id !== transactionId);
  const removeAttachment = () => router.setParams({ transactionId: undefined });
  const readiness = useFinanceRead(["conversation-readiness"], (api) =>
    api.getFinanceConversationReadiness(),
  );
  const t = useTheme();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ text: string; key: string; transactionId?: string } | null>(null);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const send = async () => {
    if (
      !owner ||
      !text.trim() ||
      busy.current ||
      !readiness.data?.canSend ||
      readiness.isError ||
      attachmentBlocked
    )
      return;
    if (
      !attempt.current ||
      attempt.current.text !== text.trim() ||
      attempt.current.transactionId !== transactionId
    )
      attempt.current = { text: text.trim(), key: randomUUID(), transactionId };
    const current = attempt.current;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Sending message…");
    try {
      await api.sendFinanceConversationMessage({
        text: current.text,
        idempotencyKey: current.key,
        caseId: null,
        recordRefs: current.transactionId
          ? [{ kind: "transaction", id: current.transactionId }]
          : [],
      });
      if (active.current !== owner) {
        toast.dismiss(id);
        return;
      }
      setText("");
      if (current.transactionId) removeAttachment();
      attempt.current = null;
      toast.success("Message sent", { id });
      void client.invalidateQueries({ queryKey: ["finances", owner, "conversation"] });
    } catch {
      if (active.current === owner)
        toast.error("Couldn’t confirm delivery. Your draft is saved here; try sending again.", {
          id,
        });
      else toast.dismiss(id);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  };
  return (
    <ReadState query={readiness}>
      <View style={{ gap: spacing.sm }}>
        {readiness.data && !readiness.data.canSend && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect your Finance assistant"
            accessibilityHint={financeLabel(readiness.data.reason)}
            onPress={() => router.navigate("/settings")}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}
          >
            <Icon name="settings" color={t.secondary} size={18} />
            <Text style={{ flex: 1, color: t.secondary, fontSize: 14 }}>
              Connect your Finance assistant
            </Text>
            <Icon name="chevron" color={t.secondary} size={16} />
          </Pressable>
        )}
        {!!transactionId && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingLeft: 12,
              backgroundColor: t.surface,
              borderRadius: radius.panel,
            }}
          >
            <Icon
              name={categoryIcon(attached?.category ?? "Uncategorized")}
              color={t.secondary}
              size={20}
            />
            <Text numberOfLines={2} style={{ flex: 1, color: t.ink, fontSize: 14 }}>
              {attached && !attachmentBlocked
                ? `${attached.merchant} · ${recordAmount(attached.amount, attached.currencyCode)}`
                : attachment.isPending
                  ? "Loading transaction…"
                  : "Transaction unavailable"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove transaction attachment"
              disabled={pending}
              onPress={removeAttachment}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="cancel" color={t.secondary} size={18} />
            </Pressable>
          </View>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            backgroundColor: t.surface,
            borderRadius: radius.panel,
            paddingRight: 4,
          }}
        >
          <TextInput
            accessibilityLabel="Message nohmi"
            placeholder="How much did I spend on groceries this month?"
            multiline
            maxLength={10000}
            value={text}
            editable={!pending}
            onChangeText={setText}
            placeholderTextColor={t.secondary}
            style={{
              color: t.ink,

              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              fontSize: 16,
              textAlignVertical: "top",
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={
              pending ||
              !text.trim() ||
              !readiness.data?.canSend ||
              readiness.isError ||
              attachmentBlocked
            }
            onPress={() => void send()}
            style={{
              alignSelf: "flex-end",
              width: 44,
              height: 44,
              alignItems: "center",
              marginBottom: 2,
              justifyContent: "center",
              borderRadius: 22,
              opacity:
                pending ||
                !text.trim() ||
                !readiness.data?.canSend ||
                readiness.isError ||
                attachmentBlocked
                  ? 0.5
                  : 1,
            }}
          >
            {pending ? (
              <ActivityIndicator color={workspaceColor(t, "finances")} />
            ) : (
              <Icon name="send" filled size={32} color={workspaceColor(t, "finances")} />
            )}
          </Pressable>
        </View>
      </View>
    </ReadState>
  );
}
