import { ApiClientError } from "@personal-os/api-client";
import { type Query, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ErrorPage } from "./error-page";
import { Button } from "./ui/button";

export const ReadFailureContext = createContext(false);
// Keep the application's single Sonner host in the native top layer during recovery.
export const RecoveryToastTargetContext = createContext<(target: HTMLElement | null) => void>(
  () => {},
);

/** Essential reads own one screen-level recovery surface, never layout chrome. */
export function ReadFailureBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const setToastTarget = useContext(RecoveryToastTargetContext);
  const { pathname } = useLocation();
  const cache = client.getQueryCache();
  const subscribe = useCallback((notify: () => void) => cache.subscribe(notify), [cache]);
  const isToday = pathname.replace(/\/$/, "") === "/today";
  const essentialFailure = useCallback(
    (query: Query) => {
      const key = query.queryKey[0];
      if (key !== "me" && !(isToday && ["daily-brief", "today-commitments"].includes(String(key))))
        return false;
      if (query.state.status === "error") return true;
      const data = query.state.data as { unavailableSources?: string[] } | undefined;
      return (
        key === "today-commitments" &&
        !!data?.unavailableSources?.includes("tasks") &&
        !!data.unavailableSources.includes("reminders")
      );
    },
    [isToday],
  );
  const snapshot = useCallback(
    () => cache.findAll({ type: "active" }).some(essentialFailure),
    [cache, essentialFailure],
  );
  const failed = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const connect = () => setOnline(true);
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect);
    window.addEventListener("offline", disconnect);
    return () => {
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", disconnect);
    };
  }, []);
  const [recovering, setRecovering] = useState(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const blocked = !online || failed || recovering;
  useEffect(() => {
    if (blocked) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // The native top layer also blocks existing portalled menus/dialogs.
      if (surface.current?.showModal) surface.current.showModal();
      else surface.current?.setAttribute("open", "");
      retryButton.current?.focus();
    } else if (previousFocus.current?.isConnected) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [blocked]);
  useEffect(() => {
    setToastTarget(blocked ? surface.current : null);
    return () => setToastTarget(null);
  }, [blocked, setToastTarget]);
  const error = cache.findAll({ type: "active" }).find(essentialFailure)?.state.error;
  const kind =
    online && error instanceof ApiClientError
      ? error.status === 403
        ? "403"
        : error.status === 503
          ? "503"
          : "500"
      : "offline";
  const retry = () => {
    if (recovering) return;
    if (!online) {
      toast.error("You’re offline. Reconnect, then try again.");
      return;
    }
    setRecovering(true);
    // Wait for every active source before releasing the blocking surface.
    const requests = cache.findAll({ type: "active" }).filter((query) => query.isActive());
    const refresh = Promise.allSettled(
      requests.map((query) =>
        client.refetchQueries(
          { queryKey: query.queryKey, exact: true, type: "active" },
          { throwOnError: true },
        ),
      ),
    )
      .then((results) => {
        if (results.some((result) => result.status === "rejected") || snapshot())
          throw new Error("Read unavailable");
      })
      .finally(() => setRecovering(false));
    toast.promise(refresh, {
      loading: "Reconnecting…",
      success: "Connected. Your information is refreshed.",
      error: "Couldn’t reconnect. Check your connection and try again.",
    });
  };
  return (
    <ReadFailureContext.Provider value={blocked}>
      {/* Keep observers and drafts mounted so recovery cannot bounce between screens. */}
      <div hidden={blocked} inert={blocked}>
        {children}
      </div>
      {blocked ? (
        <dialog
          ref={surface}
          aria-label="Connection recovery"
          aria-modal="true"
          className="read-failure-screen"
          onCancel={(event) => event.preventDefault()}
        >
          <ErrorPage
            kind={kind}
            description={
              kind === "403"
                ? undefined
                : "We couldn’t refresh the information needed for this screen. Check your connection and try again."
            }
            actions={
              <Button ref={retryButton} disabled={recovering} onClick={retry}>
                Try again
              </Button>
            }
          />
        </dialog>
      ) : null}
    </ReadFailureContext.Provider>
  );
}
