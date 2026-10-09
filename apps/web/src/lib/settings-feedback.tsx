import { createContext, useContext, useEffect, useId, useRef } from "react";
import { toast } from "sonner";

/** Settings keep correction hints inline and announce failures through Sonner. */
export const SettingsFeedbackContext = createContext(false);

export function useSettingsError(error: unknown, message: string, retry?: () => unknown) {
  const enabled = useContext(SettingsFeedbackContext);
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
    const key = error
      ? `${message}:${error instanceof Error ? error.message : String(error)}`
      : null;
    if (enabled && key && key !== previous.current)
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
  }, [enabled, error, id, message]);
  return enabled;
}
