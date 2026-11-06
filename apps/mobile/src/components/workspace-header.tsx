import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { toast } from "sonner-native";
import { useAuth } from "../features/auth/context";
import { sampleItems } from "../features/briefing/sample";
import { useTaskSearch } from "../features/tasks/data";
import { useStablePan } from "../navigation/use-stable-pan";
import { regionMotion, useWorkspaceMotion, workspaceOrder } from "../navigation/workspace-motion";
import { useTheme, workspaceColor, workspaces } from "../theme";
import { GlassSurface } from "./glass-surface";
import { Icon } from "./icons";
import { WorkspacePicker } from "./workspace-picker";

const menuWorkspaces = workspaceOrder.flatMap((id) =>
  workspaces.filter((workspace) => workspace.id === id),
);
type Workspace = (typeof workspaces)[number];

/** Shared workspace chrome. Search is intentionally restricted to the preview fixtures. */
export function WorkspaceHeader() {
  const t = useTheme();
  const { state: auth, session } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const id = toast.loading("Signing out…");
    try {
      await session.logout();
      toast.dismiss(id);
    } catch {
      toast.error("Couldn’t sign out. Check your connection and try again.", { id });
    } finally {
      setSigningOut(false);
    }
  };
  const motion = useWorkspaceMotion();
  const path = usePathname();
  const current =
    workspaces.find(
      (workspace) => path === `/${workspace.id}` || path.startsWith(`/${workspace.id}/`),
    ) ?? workspaces[0];
  const isSettings = path === "/settings" || path.startsWith("/settings/");
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const taskSearch = useTaskSearch();
  const menu = useRef<ComponentRef<typeof View>>(null);
  const geometry = useRef({ x: 0, y: 0, width: 0, rows: [] as { y: number; height: number }[] });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const candidate = useRef<Workspace | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    clearTimer();
    setOpen(false);
    setAccountOpen(false);
    setHovered(null);
    candidate.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // Screen instances remain mounted in native tabs; dismiss transient state when leaving one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes dismiss transient header UI.
  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
    setQuery("");
    taskSearch.setSearch("");
    setHovered(null);
  }, [path]);
  const color = (workspace: Workspace) => workspaceColor(t, workspace.id);
  const choose = (workspace: Workspace) => {
    close();
    setQuery("");
    Keyboard.dismiss();
    if (isSettings || workspace.id !== current.id) {
      // Haptics are enhancement-only: unavailable hardware must never block navigation.
      if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => {});
      motion?.switchWorkspace(workspace.id);
    }
  };
  const pickAt = (x: number, y: number) => {
    const rect = geometry.current;
    const index =
      x >= rect.x && x <= rect.x + rect.width
        ? rect.rows.findIndex((row) => y >= rect.y + row.y && y < rect.y + row.y + row.height)
        : -1;
    const next = index >= 0 ? menuWorkspaces[index] : null;
    if (next && next.id !== candidate.current?.id && Platform.OS !== "web") {
      void Haptics.selectionAsync().catch(() => {});
    }
    candidate.current = next;
    setHovered(candidate.current?.id ?? null);
  };
  const pan = useStablePan({
    onStartShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => {
      setAccountOpen(false);
      holding.current = false;
      candidate.current = null;
      timer.current = setTimeout(() => {
        holding.current = true;
        if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => {});
        setOpen(true);
        setQuery("");
        Keyboard.dismiss();
      }, 220);
    },
    onPanResponderMove: (_event, gesture) => {
      if (holding.current) pickAt(gesture.moveX, gesture.moveY);
      else if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 14) {
        clearTimer();
        holding.current = true;
        setOpen(true);
        setQuery("");
        Keyboard.dismiss();
      }
    },
    onPanResponderRelease: (event, gesture) => {
      clearTimer();
      if (holding.current) {
        pickAt(gesture.moveX || event.nativeEvent.pageX, gesture.moveY || event.nativeEvent.pageY);
        const selected = candidate.current;
        if (selected) choose(selected);
        else close();
      } else {
        Keyboard.dismiss();
        setQuery("");
        setOpen((value) => !value);
      }
      holding.current = false;
    },
    onPanResponderTerminate: () => {
      holding.current = false;
      close();
    },
    onPanResponderTerminationRequest: () => false,
  });
  const menuPan = useStablePan({
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (event) => pickAt(event.nativeEvent.pageX, event.nativeEvent.pageY),
    onPanResponderMove: (_event, gesture) => pickAt(gesture.moveX, gesture.moveY),
    onPanResponderRelease: (event, gesture) => {
      pickAt(gesture.moveX || event.nativeEvent.pageX, gesture.moveY || event.nativeEvent.pageY);
      if (candidate.current) choose(candidate.current);
      else close();
    },
    onPanResponderTerminate: close,
  });
  const results =
    !isSettings && current.id !== "tasks" && query.trim()
      ? sampleItems.filter(
          (item) =>
            (current.id === "index" || item.workspace === current.id) &&
            `${item.title} ${item.summary} ${item.description}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
      : [];
  return (
    <View style={styles.layer}>
      {(open || accountOpen || (current.id !== "tasks" && !!query.trim())) && (
        <Pressable
          accessibilityLabel="Dismiss navigation menu or search"
          onPress={() => {
            close();
            setQuery("");
            Keyboard.dismiss();
          }}
          style={styles.dismiss}
        />
      )}
      <View style={styles.bar}>
        {/* Keep glass outside the menu ancestry so iOS cannot lift the whole search bar. */}
        <GlassSurface pointerEvents="none" style={StyleSheet.absoluteFill} />
        <Animated.View
          style={[styles.barContents, motion && regionMotion(motion.workspaceProgress, 10)]}
        >
          <View {...pan.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch workspace, ${isSettings ? "settings" : current.label}`}
              accessibilityHint="Tap for workspaces, or hold and slide to a workspace."
              accessibilityState={{ expanded: open }}
              onPress={() => {
                setAccountOpen(false);
                setOpen((value) => !value);
                setQuery("");
              }}
              onAccessibilityTap={() => {
                setAccountOpen(false);
                setOpen((value) => !value);
              }}
              style={styles.workspaceButton}
            >
              <Icon
                name={isSettings ? "settings" : current.icon}
                size={23}
                filled
                color={isSettings ? t.secondary : color(current)}
              />
            </Pressable>
          </View>
          <TextInput
            value={current.id === "tasks" ? taskSearch.search : query}
            onChangeText={(value) => {
              close();
              if (current.id === "tasks") taskSearch.setSearch(value);
              else setQuery(value);
            }}
            onFocus={() => close()}
            accessibilityLabel={`Search ${isSettings ? "settings" : current.label}${current.id === "tasks" ? "" : " sample data"}`}
            placeholder={`Search ${isSettings ? "settings" : current.label}`}
            placeholderTextColor={t.secondary}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.input, { color: t.ink }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account menu"
            accessibilityState={{ expanded: accountOpen }}
            onPress={() => {
              close();
              setQuery("");
              Keyboard.dismiss();
              setAccountOpen(!accountOpen);
            }}
            style={styles.accountButton}
          >
            <View style={[styles.avatar, { backgroundColor: t.canvas }]}>
              <Icon name="profile" color={t.secondary} size={17} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
      {open && (
        <View
          {...menuPan.panHandlers}
          ref={menu}
          onLayout={() =>
            menu.current?.measureInWindow((x, y, width) => {
              geometry.current = { ...geometry.current, x, y, width };
            })
          }
          style={styles.menu}
        >
          {Platform.OS === "ios" && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <WorkspacePicker
                selected={hovered ?? (isSettings ? null : current.id)}
                options={menuWorkspaces}
              />
            </View>
          )}
          <View style={Platform.OS === "ios" ? { padding: 6 } : undefined}>
            {Platform.OS !== "ios" && (
              <GlassSurface
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.material]}
              />
            )}
            <View style={Platform.OS === "ios" ? undefined : { padding: 6 }}>
              {menuWorkspaces.map((workspace, index) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${workspace.label}`}
                  accessibilityState={{ selected: !isSettings && current.id === workspace.id }}
                  onLayout={(event) => {
                    geometry.current.rows[index] = {
                      ...event.nativeEvent.layout,
                      y: event.nativeEvent.layout.y + (Platform.OS === "ios" ? 6 : 0),
                    };
                  }}
                  onPress={() => choose(workspace)}
                  onHoverIn={() => setHovered(workspace.id)}
                  onHoverOut={() => setHovered(null)}
                  style={({ pressed }) => [
                    styles.option,
                    Platform.OS === "ios" && { height: 52 },
                    Platform.OS !== "ios" &&
                      (pressed ||
                        hovered === workspace.id ||
                        (!isSettings && current.id === workspace.id)) && {
                        backgroundColor: t.dark ? "#ffffff14" : "#00000008",
                      },
                  ]}
                >
                  {Platform.OS !== "ios" && (
                    <>
                      <View style={[styles.mark, { backgroundColor: `${color(workspace)}18` }]}>
                        <Icon
                          name={workspace.icon}
                          filled={
                            hovered === workspace.id || (!isSettings && current.id === workspace.id)
                          }
                          color={
                            hovered === workspace.id || (!isSettings && current.id === workspace.id)
                              ? color(workspace)
                              : t.secondary
                          }
                          size={21}
                        />
                      </View>
                      <Text style={[styles.label, { color: t.ink }]}>{workspace.label}</Text>
                      {workspace.id === current.id && (
                        <Icon name="check" size={17} color={t.secondary} />
                      )}
                    </>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}
      {accountOpen && (
        <View style={[styles.menu, { left: undefined, right: 0, width: 276 }]}>
          <GlassSurface glassEffectStyle="regular" style={styles.material}>
            <View
              style={{
                padding: 14,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: t.line,
                marginBottom: 4,
              }}
            >
              <Text style={[styles.label, { color: t.ink }]}>{auth.user?.displayName}</Text>
              <Text style={{ color: t.secondary, fontSize: 12, marginTop: 4 }}>
                {auth.user?.email}
              </Text>
            </View>
            {(
              [
                { label: "settings", icon: "settings", path: "/settings" },
                { label: "workspace settings", icon: "grid", path: "/settings/workspaces" },
                { label: "agent settings", icon: "target", path: "/settings/agents" },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => {
                  close();
                  router.navigate(item.path);
                }}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: t.surface }]}
              >
                <Icon name={item.icon} color={t.secondary} size={21} />
                <Text style={[styles.label, { color: t.ink }]}>{item.label}</Text>
              </Pressable>
            ))}
            <View
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: t.line,
                marginTop: 4,
              }}
            >
              <Pressable
                disabled={signingOut}
                onPress={() => void logout()}
                accessibilityRole="button"
                accessibilityLabel="log out"
                accessibilityState={{ disabled: signingOut }}
                style={styles.option}
              >
                <Icon name="disconnected" color={t.secondary} size={21} />
                <Text style={[styles.label, { color: t.secondary }]}>log out</Text>
              </Pressable>
            </View>
          </GlassSurface>
        </View>
      )}
      {current.id !== "tasks" && !!query.trim() && (
        <View style={[styles.results, { backgroundColor: t.canvas, borderColor: t.line }]}>
          <Text style={[styles.caption, { color: t.secondary }]}>
            sample results · {isSettings ? "settings" : current.label}
          </Text>
          {results.length ? (
            results.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => {
                  setQuery("");
                  Keyboard.dismiss();
                  router.push(`/detail/${item.id}`);
                }}
                style={styles.result}
              >
                <Icon name={item.icon} color={t[item.workspace]} />
                <Text style={[styles.resultText, { color: t.ink }]}>{item.title}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={[styles.caption, { color: t.secondary }]}>
              No sample matches. Try another search.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  layer: {
    zIndex: 10,
    marginHorizontal: 20,
    marginBottom: 18,
    marginTop: 6,
    maxWidth: 580,
    width: "auto",
  },
  bar: {
    overflow: "hidden",
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
  },
  barContents: { flex: 1, flexDirection: "row", alignItems: "center" },
  workspaceButton: {
    width: 50,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  input: { flex: 1, minWidth: 0, fontSize: 16, height: 50, paddingVertical: 0 },
  accountButton: {
    width: 48,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 3,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  dismiss: { position: "absolute", top: -100, left: -40, right: -40, height: 1800 },
  menu: {
    position: "absolute",
    top: 60,
    left: 0,
    width: 256,
    maxWidth: "100%",
    borderRadius: 24,
    boxShadow: "0px 12px 30px rgba(0,0,0,0.14)",
  },
  material: { borderRadius: 24, overflow: "hidden", padding: 6 },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
  },
  mark: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 17, fontWeight: "500", flex: 1 },
  results: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  caption: { fontSize: 13, padding: 8 },
  result: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, minHeight: 48 },
  resultText: { flex: 1, fontSize: 16 },
});
