import { router, usePathname } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";
import { workspacePages } from "./workspace-pages";

export const workspaceOrder = ["index", "tasks", "mail", "finances", "calendar"] as const;
const ownerOf = (path: string) =>
  path.startsWith("/finance-") ? "finances" : path.split("/")[1] || "index";
const pageIndex = (path: string) =>
  workspacePages[ownerOf(path) as keyof typeof workspacePages]?.findIndex(
    (page) => page.name === (path.split("/")[2] || "index"),
  ) ?? 0;
// Shared-axis motion: accelerate away, then gently decelerate into the destination.
const arrivalCurve = Easing.bezier(0.2, 0.8, 0.2, 1);
const animate = (
  value: Animated.Value,
  toValue: number,
  duration: number,
  done?: () => void,
  easing = arrivalCurve,
) => {
  Animated.timing(value, {
    toValue,
    duration,
    easing,
    useNativeDriver: Platform.OS !== "web",
  }).start(({ finished }) => {
    if (finished) done?.();
  });
};
const MotionContext = createContext<{
  switchWorkspace: (id: string) => void;
  workspaceProgress: Animated.Value;
  pageProgress: Animated.Value;
} | null>(null);

/** Progress drives content inside fixed clipping regions, never the navigator frame. */
export function WorkspaceMotion({ children }: PropsWithChildren) {
  const path = usePathname();
  const workspaceProgress = useRef(new Animated.Value(0)).current;
  const pageProgress = useRef(new Animated.Value(0)).current;
  const previous = useRef(path);
  const pending = useRef<{ target: string; direction: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      listener.remove();
      workspaceProgress.stopAnimation();
      pageProgress.stopAnimation();
    };
  }, [workspaceProgress, pageProgress]);
  useEffect(() => {
    if (!reduceMotion) return;
    const target = pending.current?.target;
    workspaceProgress.stopAnimation();
    pageProgress.stopAnimation();
    workspaceProgress.setValue(0);
    pageProgress.setValue(0);
    pending.current = null;
    if (target) router.navigate(target === "index" ? "/" : `/${target}`);
  }, [reduceMotion, workspaceProgress, pageProgress]);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = path;
    const isWorkspace = (candidate: string) =>
      (workspaceOrder as readonly string[]).includes(ownerOf(candidate));
    // Native stack screens own their transitions. Do not animate detached workspace regions.
    if (!isWorkspace(path) || !isWorkspace(from)) {
      workspaceProgress.stopAnimation();
      pageProgress.stopAnimation();
      workspaceProgress.setValue(0);
      pageProgress.setValue(0);
      pending.current = null;
      return;
    }
    if (from === path || reduceMotion) return;
    if (ownerOf(from) !== ownerOf(path)) {
      pageProgress.stopAnimation();
      pageProgress.setValue(0);
      const direction =
        pending.current?.target === ownerOf(path)
          ? pending.current.direction
          : (workspaceOrder as readonly string[]).indexOf(ownerOf(path)) >=
              (workspaceOrder as readonly string[]).indexOf(ownerOf(from))
            ? 1
            : -1;
      workspaceProgress.stopAnimation();
      workspaceProgress.setValue(direction);
      animate(workspaceProgress, 0, 120, () => {
        pending.current = null;
      });
    } else {
      pageProgress.stopAnimation();
      pageProgress.setValue(pageIndex(path) >= pageIndex(from) ? 1 : -1);
      animate(pageProgress, 0, 160);
    }
  }, [path, reduceMotion, workspaceProgress, pageProgress]);
  const switchWorkspace = (id: string) => {
    const current = ownerOf(path);
    if (id === current) return;
    const navigate = () => router.navigate(id === "index" ? "/" : `/${id}`);
    if (reduceMotion) {
      navigate();
      return;
    }
    const direction =
      (workspaceOrder as readonly string[]).indexOf(id) >=
      (workspaceOrder as readonly string[]).indexOf(current)
        ? 1
        : -1;
    pending.current = { target: id, direction };
    pageProgress.stopAnimation();
    pageProgress.setValue(0);
    workspaceProgress.stopAnimation();
    navigate();
  };
  return (
    <MotionContext.Provider value={{ switchWorkspace, workspaceProgress, pageProgress }}>
      {children}
    </MotionContext.Provider>
  );
}
export function useWorkspaceMotion() {
  return useContext(MotionContext);
}
export function regionMotion(progress: Animated.Value, distance: number, axis: "x" | "y" = "y") {
  const offset = progress.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-distance, 0, distance],
  });
  return {
    transform: [axis === "y" ? { translateY: offset } : { translateX: offset }],
  };
}
