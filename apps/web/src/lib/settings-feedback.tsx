import { createContext, useContext, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { ReadRecoveryContext } from "./read-recovery";

/** Settings keep correction hints inline and announce failures through Sonner. */
export const SettingsFeedbackContext = createContext(false);

export function useSettingsError(error: unknown, message: string, retry?: () => unknown) {
  const enabled = useContext(SettingsFeedbackContext);
  useErrorToast(error, message, retry, enabled);
  return enabled;
}

/** Read failures use a stable toast rather than changing the surrounding layout. */
export function useErrorToast(
  error: unknown,
  message: string,
  retry?: () => unknown,
  enabled = true,
) {
  const handledByRecovery = useContext(ReadRecoveryContext)(error);
  const announce = enabled && !handledByRecovery;
  const id = useId();
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const previous = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previous.current) toast.dismiss(id);
      previous.current = null;
    },
    [id],
  );
  useEffect(() => {
    if (!announce) {
      if (previous.current) toast.dismiss(id);
      previous.current = null;
      return;
    }
    const key = error
      ? `${message}:${error instanceof Error ? error.message : String(error)}`
      : null;
    if (announce && key && key !== previous.current)
      toast.error(message, {
        id,
        duration: Number.POSITIVE_INFINITY,
        ...(retryRef.current
          ? {
              action: {
                label: "Try again",
                onClick: () => {
                  void retryRef.current?.();
                },
              },
            }
          : {}),
      });
    if (!key && previous.current) toast.dismiss(id);
    previous.current = key;
  }, [announce, error, id, message]);
}
