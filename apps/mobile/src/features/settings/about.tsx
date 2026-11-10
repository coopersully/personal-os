import Constants from "expo-constants";
import { Text, View } from "react-native";
import { useTheme } from "../../theme";
import { FormBody, Section, styles } from "../tasks/ui";
export function AboutSettingsScreen() {
  const t = useTheme();
  const config = Constants.expoConfig;
  return (
    <FormBody>
      <Section title="nohmi">
        {[
          ["Version", Constants.nativeAppVersion ?? config?.version ?? "Unavailable"],
          ["Build", Constants.nativeBuildVersion ?? config?.ios?.buildNumber ?? "Development"],
        ].map(([label, value]) => (
          <View key={label} style={styles.settingRow}>
            <Text style={{ color: t.ink, flex: 1, fontSize: 17 }}>{label}</Text>
            <Text selectable style={{ color: t.secondary, fontSize: 17 }}>
              {value}
            </Text>
          </View>
        ))}
      </Section>
    </FormBody>
  );
}
