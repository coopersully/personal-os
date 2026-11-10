import { ApiClientError } from "@personal-os/api-client";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import { toast } from "sonner-native";
import { mobileAppOrigin, useAuth } from "../auth/context";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "../finances/ui";

/** Only authenticated server-generated web destinations may leave the app. */
export function financeNotificationWebUrl(value: string) {
  const url = new URL(value);
  const local =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !local) ||
    url.origin !== mobileAppOrigin ||
    url.username ||
    url.password ||
    !["/finances/review", "/finances/activity"].includes(url.pathname) ||
    url.hash
  )
    throw new Error("This Finance destination is unavailable.");
  return url.href;
}
export function FinanceNotificationScreen() {
  const { state, session } = useAuth();
  const params = useLocalSearchParams<{ eventId?: string; installationId?: string }>();
  return state.user ? (
    <NotificationDetail
      key={`${state.user.id}:${session.epoch()}:${params.eventId}:${params.installationId}`}
      eventId={params.eventId}
      installationId={params.installationId}
    />
  ) : null;
}
function NotificationDetail({
  eventId,
  installationId,
}: {
  eventId?: string;
  installationId?: string;
}) {
  const { state, session } = useAuth();
  const epoch = session.epoch();
  const live = useRef(true);
  const pending = useRef(false);
  const queryKey = [
    "finances",
    state.user?.id,
    "notification-detail",
    epoch,
    eventId,
    installationId,
  ];
  const query = useQuery({
    queryKey,
    meta: { scopedReadFeedback: true },
    staleTime: 0,
    retry: false,
    enabled: !!eventId && !!installationId,
    queryFn: () => {
      if (!eventId || !installationId) throw new Error("This Finance update is unavailable.");
      return session.api().getNativePushEvent(eventId, installationId);
    },
  });
  useEffect(() => {
    live.current = true;
    const app = AppState.addEventListener("change", (next) => {
      if (next === "active" && eventId && installationId) void query.refetch();
    });
    return () => {
      live.current = false;
      app.remove();
    };
  }, [eventId, installationId, query.refetch]);
  const available = !!eventId && !!installationId;
  const unavailable =
    !available ||
    (query.error instanceof ApiClientError && [403, 404].includes(query.error.status));
  const detail = !query.isError ? query.data?.detail : undefined;
  async function openWeb(url: string) {
    if (pending.current) return;
    pending.current = true;
    const id = toast.loading("Opening Finance in your browser…");
    try {
      // Revalidate before the handoff; an open screen can outlive a resolved source.
      const fresh = await query.refetch();
      if (!live.current || session.epoch() !== epoch) {
        toast.dismiss(id);
        return;
      }
      if (fresh.isError || fresh.data?.detail?.webUrl !== url) throw new Error("Unavailable");
      await Linking.openURL(financeNotificationWebUrl(url));
      if (live.current && session.epoch() === epoch)
        toast.success("Finance opened in your browser.", { id });
      else toast.dismiss(id);
    } catch {
      if (live.current && session.epoch() === epoch)
        toast.error("Couldn’t open this Finance update. Refresh it and try again.", { id });
      else toast.dismiss(id);
    } finally {
      pending.current = false;
    }
  }
  return (
    <FinanceScreen title="Finance update">
      {unavailable ? (
        <Card>
          <Copy secondary>
            This update is no longer available. It may have been resolved or replaced.
          </Copy>
        </Card>
      ) : (
        <ReadState query={{ ...query, feedbackKey: JSON.stringify(queryKey) }}>
          {detail ? (
            <Card>
              <Copy>{detail.title}</Copy>
              <Copy>{detail.summary}</Copy>
              <FinanceRow
                title="Status"
                value={detail.status.replaceAll("_", " ")}
                icon="attention"
              />
              <FinanceRow
                title="Open in web"
                subtitle="Review this update in your browser. You may need to sign in."
                icon="finances"
                onPress={() => void openWeb(detail.webUrl)}
              />
            </Card>
          ) : (
            <Card>
              <Copy secondary>This update has no available detail.</Copy>
            </Card>
          )}
        </ReadState>
      )}
      <Card rows>
        <FinanceRow
          title="Continue in Finance chat"
          subtitle="Ask a question or discuss the next step"
          icon="reply"
          onPress={() =>
            router.push({
              pathname: "/(workspaces)/finances/assistant",
              params: { view: "Conversation" },
            })
          }
        />
      </Card>
    </FinanceScreen>
  );
}
