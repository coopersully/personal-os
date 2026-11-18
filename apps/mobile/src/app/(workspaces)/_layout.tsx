import { Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WorkspaceAddButton } from "../../components/workspace-add-button";
import { WorkspaceDock } from "../../components/workspace-dock";
import { WorkspaceHeader } from "../../components/workspace-header";
import {
  WorkspaceHeaderInset,
  WorkspaceHeroVisibility,
} from "../../components/workspace-header-inset";
import { TodaySkyProvider, useTodaySky } from "../../features/briefing/sky-context";
import { WorkspaceMotion } from "../../navigation/workspace-motion";
import { useTheme } from "../../theme";

export default function WorkspaceLayout() {
  const isToday = usePathname() === "/";
  const { skyPreview } = useGlobalSearchParams<{ skyPreview?: string }>();
  return (
    <TodaySkyProvider enabled={isToday} preview={skyPreview}>
      <WorkspaceFrame />
    </TodaySkyProvider>
  );
}
function WorkspaceFrame() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const report = useRef<(visible: boolean) => void>(() => {});
  return (
    <WorkspaceMotion>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.canvas,
          paddingBottom: Platform.OS === "ios" ? 0 : Math.max(insets.bottom, 8),
        }}
      >
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top,
            zIndex: 20,
          }}
        >
          <WorkspaceChrome report={report} />
        </View>
        <WorkspaceHeroVisibility.Provider value={report}>
          <WorkspaceHeaderInset.Provider value={insets.top + 76}>
            <WorkspacePages />
          </WorkspaceHeaderInset.Provider>
        </WorkspaceHeroVisibility.Provider>
        {Platform.OS !== "ios" && <WorkspaceDock />}
      </View>
    </WorkspaceMotion>
  );
}

function WorkspacePages() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, overflow: "hidden" }}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "none",
          contentStyle: { backgroundColor: theme.canvas },
        }}
      />
      <WorkspaceAddButton />
    </View>
  );
}

function WorkspaceChrome({ report }: { report: RefObject<(visible: boolean) => void> }) {
  const { sky } = useTodaySky();
  const theme = useTheme();
  const today = usePathname() === "/";
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    report.current = setVisible;
    return () => {
      report.current = () => {};
    };
  }, [report]);
  return <WorkspaceHeader chromeDark={today && visible ? sky.chromeDark : theme.dark} />;
}
