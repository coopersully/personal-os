import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isDesktop, resetDesktopConnection } from "./bridge.js";
import { resetDesktopSession } from "./session.js";
export function useDesktopActions(capture: (kind: "task" | "reminder" | "event") => void) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const reportFailure = () => {
      if (!disposed) toast.error("Desktop quick actions could not connect. Reopen nohmi to retry.");
    };
    const receive = async () => {
      if (disposed) return;
      const payload = await invoke<{
        action: string;
        path?: string;
        kind?: "task" | "reminder" | "event";
        message?: string;
      } | null>("desktop_take_action");
      if (disposed || !payload) return;
      if (payload.action === "open" && payload.path) navigate(payload.path);
      if (payload.action === "capture" && payload.kind) capture(payload.kind);
      if (payload.action === "error") toast.error(payload.message ?? "The desktop action failed.");
    };
    const register = async () => {
      const registrations = await Promise.allSettled([
        listen("desktop-action", () => {
          void receive().catch(reportFailure);
        }),
        listen("desktop-session-invalidated", () => {
          if (disposed) return;
          void resetDesktopSession(cache);
        }),
        listen("desktop-material-changed", () => {
          if (!disposed) void cache.invalidateQueries();
        }),
        listen<{ serverChanged: boolean }>("desktop-settings-changed", ({ payload }) => {
          if (disposed) return;
          if (payload.serverChanged) {
            resetDesktopConnection();
            void resetDesktopSession(cache);
          } else {
            void cache.invalidateQueries({ queryKey: ["desktop-settings"] });
          }
        }),
      ]);
      const handlers = registrations.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = registrations.some((result) => result.status === "rejected");
      if (disposed || failed) {
        handlers.forEach((stop) => {
          stop();
        });
        if (failed) {
          reportFailure();
          disposed = true;
        }
      } else {
        cleanup.push(...handlers);
        await receive();
      }
    };
    void register().catch(reportFailure);
    return () => {
      disposed = true;
      cleanup.forEach((stop) => {
        stop();
      });
    };
  }, [cache, capture, navigate]);
}
