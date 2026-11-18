import { Text } from "react-native";
import { useTheme } from "../theme";
import { Screen } from "./screen";

/** Navigation-only shell. Domain content will be implemented in a later pass. */
export function WorkspacePage({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Screen chrome>
      <Text
        accessibilityRole="header"
        style={{ color: theme.ink, fontSize: 28, fontWeight: "600", marginTop: 8 }}
      >
        {title}
      </Text>
    </Screen>
  );
}
