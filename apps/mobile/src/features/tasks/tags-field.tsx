import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Icon } from "../../components/icons";
import { spacing, useTheme } from "../../theme";
import { Action } from "./ui";

/** Tags are individual draft values, never comma-delimited text. */
export function TagsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = draft.trim();
    if (!tag || value.length >= 20) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft("");
    setAdding(false);
  };
  return (
    <View style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text style={{ color: t.secondary, fontSize: 13 }}>Tags</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {value.map((tag) => (
          <Pressable
            key={tag}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag}`}
            onPress={() => onChange(value.filter((item) => item !== tag))}
            style={{
              minHeight: 44,
              maxWidth: "100%",
              borderRadius: 22,
              paddingHorizontal: 16,
              backgroundColor: t.canvas,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={{ color: t.ink, fontSize: 16, flexShrink: 1 }}>{tag}</Text>
            <Text accessible={false} style={{ color: t.secondary, fontSize: 20 }}>
              ×
            </Text>
          </Pressable>
        ))}
        {value.length < 20 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add tag"
            onPress={() => setAdding(true)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: t.canvas,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="add" color={t.ink} />
          </Pressable>
        )}
      </View>
      {adding && (
        <View style={{ gap: 8 }}>
          <TextInput
            autoFocus
            accessibilityLabel="New tag"
            placeholder="errands"
            placeholderTextColor={t.secondary}
            value={draft}
            onChangeText={setDraft}
            maxLength={60}
            onSubmitEditing={add}
            returnKeyType="done"
            style={{ minHeight: 44, color: t.ink, fontSize: 17 }}
          />
          <View style={{ flexDirection: "row" }}>
            <Action label="Add" disabled={!draft.trim()} onPress={add} />
            <Action
              label="Cancel"
              onPress={() => {
                setDraft("");
                setAdding(false);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}
