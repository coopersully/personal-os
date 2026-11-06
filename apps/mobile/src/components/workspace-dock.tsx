import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useStablePan } from "../navigation/use-stable-pan";
import { regionMotion, useWorkspaceMotion } from "../navigation/workspace-motion";
import { workspacePages } from "../navigation/workspace-pages";
import { useTheme, workspaceColor } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon } from "./icons";

/** Persistent material boundary; only the controls inside it move. */
export function WorkspaceDock() {
  const theme = useTheme();
  const path = usePathname();
  const owner = path.split("/")[1] as keyof typeof workspacePages;
  const pages = workspacePages[owner];
  const page = path.split("/")[2] || "index";
  const selected = owner === "settings" && page === "agents" ? "app" : page;
  const motion = useWorkspaceMotion();
  const row = useRef<ComponentRef<typeof View>>(null);
  const bounds = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const candidate = useRef<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const pick = (x: number, y: number) => {
    const rect = bounds.current;
    const index =
      rect.width > 0 &&
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y - 20 &&
      y <= rect.y + rect.height + 20
        ? Math.min(
            (pages?.length ?? 1) - 1,
            Math.floor(((x - rect.x) / rect.width) * (pages?.length ?? 1)),
          )
        : -1;
    const next = pages?.[index]?.name ?? null;
    if (next && candidate.current !== next && Platform.OS !== "web")
      void Haptics.selectionAsync().catch(() => {});
    candidate.current = next;
    setDragged(next);
  };
  const pan = useStablePan({
    onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 5,
    onPanResponderGrant: (_, gesture) => pick(gesture.moveX, gesture.moveY),
    onPanResponderMove: (_, gesture) => pick(gesture.moveX, gesture.moveY),
    onPanResponderRelease: (_, gesture) => {
      pick(gesture.moveX, gesture.moveY);
      const target = candidate.current;
      setDragged(null);
      candidate.current = null;
      if (target && target !== selected)
        router.navigate(target === "index" ? `/${owner}` : `/${owner}/${target}`);
    },
    onPanResponderTerminate: () => {
      candidate.current = null;
      setDragged(null);
    },
  });
  const active = dragged ?? selected;
  return (
    <View style={styles.slot}>
      {pages && (
        <GlassSurface style={styles.glass}>
          <Animated.View
            ref={row}
            {...pan.panHandlers}
            onLayout={() =>
              row.current?.measureInWindow((x, y, width, height) => {
                bounds.current = { x, y, width, height };
              })
            }
            accessibilityRole="tablist"
            style={[styles.items, motion && regionMotion(motion.workspaceProgress, 12)]}
          >
            {pages.map((page) => (
              <Pressable
                key={page.name}
                accessibilityRole="tab"
                accessibilityLabel={page.label}
                accessibilityState={{ selected: selected === page.name }}
                aria-selected={selected === page.name}
                onPress={() =>
                  router.navigate(page.name === "index" ? `/${owner}` : `/${owner}/${page.name}`)
                }
                style={[
                  styles.item,
                  active === page.name && {
                    backgroundColor: theme.dark ? "#ffffff12" : "#00000009",
                  },
                ]}
              >
                <Icon
                  name={page.icon}
                  size={25}
                  filled={active === page.name}
                  color={active === page.name ? workspaceColor(theme, owner) : theme.secondary}
                />
              </Pressable>
            ))}
          </Animated.View>
        </GlassSurface>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  slot: { height: 64, marginHorizontal: 20, paddingTop: 4 },
  glass: { height: 58, borderRadius: 29, overflow: "hidden", padding: 4 },
  items: { flex: 1, flexDirection: "row", gap: 4 },
  item: {
    flex: 1,
    minHeight: 48,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
});
