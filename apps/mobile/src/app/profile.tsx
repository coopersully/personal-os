import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Body, Button, Heading } from "../components/detail-content";
import { Icon } from "../components/icons";
import { Screen } from "../components/screen";
import { usePreview } from "../features/briefing/context";
import type { Scenario } from "../features/briefing/sample";
import { useTheme } from "../theme";

const options: { id: Scenario; title: string }[] = [
  { id: "attention", title: "needs attention" },
  { id: "quiet", title: "quiet day" },
  { id: "interrupted", title: "monitoring interrupted" },
];
export default function Profile() {
  const t = useTheme();
  const { scenario, setScenario } = usePreview();
  return (
    <Screen>
      <Heading>try your briefing</Heading>
      <Body>
        This build uses a sample day. Sign-in, your profile photo and live monitoring will arrive in
        a later build.
      </Body>
      <View accessibilityRole="radiogroup">
        {options.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: scenario === option.id }}
            onPress={() => setScenario(option.id)}
            style={[styles.option, { backgroundColor: t.surface }]}
          >
            <Text style={{ color: t.ink, fontSize: 16, flex: 1 }}>{option.title}</Text>
            {scenario === option.id && <Icon name="check" color={t.ink} />}
          </Pressable>
        ))}
      </View>
      <Body>
        The scenarios change only this preview. No accounts are read and no messages or tasks are
        changed.
      </Body>
      <Button onPress={() => router.back()}>back to briefing</Button>
    </Screen>
  );
}
const styles = StyleSheet.create({
  option: {
    minHeight: 56,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
});
