import { ApiClientError } from "@personal-os/api-client";
import { type MailThreadSummary, mailThreadSummarySchema } from "@personal-os/domain";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { MailReader } from "../mail/reader";
import { pendingLink, subscribeToLinks, takeLink } from "./pending";

const feedback = "open-link";

/**
 * Opens the queued nohmi link above whatever is on screen. It is mounted only for a signed-in
 * user, so a link that arrived earlier waits for sign-in. Outcomes are reported by Sonner alone.
 */
export function LinkOpener() {
  const { session } = useAuth();
  const ready = !!useRootNavigationState()?.key;
  const link = useSyncExternalStore(subscribeToLinks, pendingLink, pendingLink);
  const [conversation, setConversation] = useState<MailThreadSummary | null>(null);
  // Counts opens so a slower, superseded or abandoned read cannot show its conversation.
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
      toast.dismiss(feedback);
    },
    [],
  );
  useEffect(() => {
    if (!ready || !link) return;
    takeLink();
    request.current += 1;
    const mine = request.current;
    setConversation(null);
    if (link.kind === "screen") {
      toast.dismiss(feedback);
      router.push(link.href);
    } else if (link.kind === "unsupported") {
      toast.error("This link can’t be opened in nohmi.", { id: feedback });
    } else {
      toast.loading("Opening conversation…", { id: feedback });
      session
        .api()
        .getMailThread(link.id)
        .then((thread) => {
          const summary = mailThreadSummarySchema.parse(thread);
          if (mine !== request.current) return;
          toast.dismiss(feedback);
          setConversation(summary);
        })
        .catch((error: unknown) => {
          if (mine !== request.current) return;
          toast.error(
            error instanceof ApiClientError && error.status === 404
              ? "This conversation is no longer available."
              : "Couldn’t open this conversation. Check your connection and try again.",
            { id: feedback },
          );
        });
    }
  }, [ready, link, session]);
  return conversation ? (
    <MailReader
      thread={conversation}
      close={() => {
        request.current += 1;
        setConversation(null);
      }}
    />
  ) : null;
}
