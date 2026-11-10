import { TextInput, View } from "react-native";
import { Icon } from "../../components/icons";
import { useTheme } from "../../theme";
export function SettingsSearch({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        backgroundColor: t.surface,
        borderRadius: 12,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Icon name="search" color={t.secondary} />
      <TextInput
        accessibilityLabel="Search settings"
        placeholder="Search settings"
        placeholderTextColor={t.secondary}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{
          minHeight: 44,
          flex: 1,
          color: t.ink,

          fontSize: 17,
        }}
      />
    </View>
  );
}
