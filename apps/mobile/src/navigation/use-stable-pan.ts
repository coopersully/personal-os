import { useRef } from "react";
import { PanResponder, type PanResponderCallbacks } from "react-native";

/** Keep one responder for the entire gesture while reading current render callbacks. */
export function useStablePan(callbacks: PanResponderCallbacks) {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) {
    responder.current = PanResponder.create({
      onStartShouldSetPanResponderCapture: (e, g) =>
        latest.current.onStartShouldSetPanResponderCapture?.(e, g) ?? false,
      onMoveShouldSetPanResponderCapture: (e, g) =>
        latest.current.onMoveShouldSetPanResponderCapture?.(e, g) ?? false,
      onPanResponderGrant: (e, g) => latest.current.onPanResponderGrant?.(e, g),
      onPanResponderMove: (e, g) => latest.current.onPanResponderMove?.(e, g),
      onPanResponderRelease: (e, g) => latest.current.onPanResponderRelease?.(e, g),
      onPanResponderTerminate: (e, g) => latest.current.onPanResponderTerminate?.(e, g),
      onPanResponderTerminationRequest: () => false,
    });
  }
  return responder.current;
}
