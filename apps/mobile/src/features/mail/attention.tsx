import { useState } from "react";
import { Text, View } from "react-native";
import { Action } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { spacing, useTheme } from "../../theme";
import { useMailAttention } from "./data";
import { attentionThreadId, mailAttention } from "./logic";

/** How many items show before the rest are asked for, so the inbox stays within reach. */
const SHOWN = 3;

/**
 * What the steward flagged in Mail, above the inbox. It renders nothing when nothing is open,
 * and an item about a conversation opens that conversation through `onOpen`.
 */
export function MailAttention({ onOpen }: { onOpen: (threadId: string) => void }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const items = mailAttention(useMailAttention().data ?? [], new Date());
  if (!items.length) return null;
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 17, fontWeight: "700" }}>
        Needs you
      </Text>
      {(all ? items : items.slice(0, SHOWN)).map((item) => {
        const threadId = attentionThreadId(item);
        return (
          <RecordRow
            key={item.id}
            title={item.title}
            subtitle={item.summary}
            subtitleLines={3}
            value={
              item.importance === "critical"
                ? "Critical"
                : item.importance === "high"
                  ? "High"
                  : undefined
            }
            valueTone={item.importance === "critical" ? "incorrect" : "attention"}
            leading={<Icon name="mail" size={18} color={t.secondary} />}
            accessibilityHint={threadId ? "Opens the conversation" : undefined}
            onPress={threadId ? () => onOpen(threadId) : undefined}
          />
        );
      })}
      {!all && items.length > SHOWN && (
        <SettingsAccentProvider workspace="mail">
          <View style={{ flexDirection: "row", marginLeft: -spacing.md }}>
            <Action label={`Show all ${items.length}`} onPress={() => setAll(true)} />
          </View>
        </SettingsAccentProvider>
      )}
      <View style={{ height: 0.5, backgroundColor: t.line, marginTop: spacing.sm }} />
    </View>
  );
}
