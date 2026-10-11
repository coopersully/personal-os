import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { LatestAppearanceQueue } from "./appearance-preview";
import {
  beginPetAppearance,
  type DesktopStatus,
  previewPetAppearance,
  savePetAppearance,
} from "./bridge";

type Value = { color: string; scale: number; revision: number };
export function usePetAppearance(
  scope: string | undefined,
  onSaved: (status: DesktopStatus, revision: number) => void,
) {
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const runtime = useRef<ReturnType<typeof create> | null>(null);
  function create() {
    let disposed = false;
    let session: ReturnType<typeof beginPetAppearance> | undefined;
    const getSession = () => {
      session ??= beginPetAppearance()
        .then((value) => {
          if (`${value.serverUrl}|${value.accountId ?? ""}` !== scope)
            throw new Error("Your account changed. Reopen pet settings.");
          return value;
        })
        .catch((error) => {
          // Keep the queued latest edit, but never reuse a rejected native session.
          session = undefined;
          throw error;
        });
      return session;
    };
    let latest: Value | undefined;
    let submittedRevision = 0;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const preview = new LatestAppearanceQueue<Value>(
      async (value) => previewPetAppearance({ ...(await getSession()), ...value }),
      () => {
        toast.error("Couldn’t preview pet appearance.", { id: "pet-appearance-preview" });
      },
    );
    const persist = new LatestAppearanceQueue<Value>(
      async (value) => {
        const status = await savePetAppearance({ ...(await getSession()), ...value });
        if (!disposed) saved.current(status, value.revision);
      },
      () => {
        if (disposed) {
          toast.error("Couldn’t save pet appearance. Reopen pet settings to retry.", {
            id: "pet-appearance-save",
          });
          return;
        }
        toast.error("Couldn’t save pet appearance.", {
          id: "pet-appearance-save",
          action: {
            label: "Retry",
            onClick: () => {
              if (latest) persist.submit(latest);
            },
          },
        });
      },
    );
    const commit = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (latest && latest.revision > submittedRevision) {
        submittedRevision = latest.revision;
        persist.submit(latest);
      }
    };
    return {
      change(value: Value) {
        latest = value;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (latest) preview.submit(latest);
        });
        if (timer) clearTimeout(timer);
        timer = setTimeout(commit, 250);
      },
      commit,
      dispose() {
        disposed = true;
        if (frame !== undefined) cancelAnimationFrame(frame);
        commit();
        preview.dispose();
        void persist.flush().finally(() => persist.dispose());
      },
    };
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes must dispose the previous edit session.
  useEffect(() => {
    const clear = () => {
      runtime.current?.dispose();
      runtime.current = null;
    };
    return clear;
  }, [scope]);
  return {
    change(value: Value) {
      runtime.current ??= create();
      runtime.current.change(value);
    },
    commit() {
      runtime.current?.commit();
    },
  };
}
