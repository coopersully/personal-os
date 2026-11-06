import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";
import { radius, spacing, useTheme } from "../theme";
import { Icon } from "./icons";

/** One active default-channel host, including above native record editor sheets. */
export function AppToaster({ editor = false }: { editor?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const inEditor = pathname === "/task-editor" || pathname === "/task-container";
  if (editor !== inEditor) return null;
  const background = t.dark ? "#fafafa" : "#202024";
  const foreground = t.dark ? "#202024" : "#fafafa";
  return (
    <Toaster
      fullWindowOverlay={!editor}
      theme={t.dark ? "light" : "dark"}
      position="top-center"
      offset={insets.top + spacing.md}
      enableStacking
      visibleToasts={3}
      gap={spacing.sm}
      duration={5000}
      closeButton
      autoWiggleOnUpdate="never"
      icons={{
        success: <Icon name="save" size={22} color={foreground} />,
        error: <Icon name="cancel" size={22} color={t.dark ? "#ba2944" : "#ff8190"} />,
        warning: <Icon name="attention" size={22} color={foreground} />,
        info: <Icon name="attention" size={22} color={foreground} />,
      }}
      toastOptions={{
        style: {
          backgroundColor: background,
          borderRadius: radius.panel,
          borderWidth: 1,
          borderColor: t.dark ? "#dad8d3" : "#626268",
          padding: spacing.lg,
          shadowColor: "#000000",
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        titleStyle: { color: foreground, fontSize: 15, fontWeight: "600" },
        descriptionStyle: { color: foreground, fontSize: 14 },
        actionButtonStyle: {
          minHeight: 44,
          paddingHorizontal: spacing.md,
          backgroundColor: foreground,
          borderRadius: radius.control,
        },
        actionButtonTextStyle: { color: background, fontWeight: "600" },
      }}
    />
  );
}
