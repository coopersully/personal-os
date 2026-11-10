import type { MailDraft } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";

export function visibleDrafts(drafts: MailDraft[], accountId: string, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return drafts.filter(
    (draft) =>
      draft.sendStatus !== "sent" &&
      (!accountId || draft.accountId === accountId) &&
      (!query ||
        `${draft.subject} ${draft.body} ${draft.to.map((person) => person.address).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}
/** Local drafts are distinct from provider-synced Drafts. Bodies are never persisted. */
export function MailDrafts({ accountId }: { accountId: string }) {
  const t = useTheme();
  const { session, state } = useAuth();
  const { mailSearch = "" } = useLocalSearchParams<{ mailSearch?: string }>();
  const query = useQuery({
    queryKey: ["mail", state.user?.id, "drafts"],
    queryFn: () => session.api().listMailDrafts(),
    gcTime: 0,
  });
  const drafts = visibleDrafts(query.data ?? [], accountId, mailSearch);
  return (
    <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      {!!drafts.length && (
        <Text
          accessibilityRole="header"
          style={{ color: t.secondary, fontSize: 13, fontWeight: "600" }}
        >
          Saved in nohmi
        </Text>
      )}
      {query.isPending && <ActivityIndicator accessibilityLabel="Loading saved drafts" />}
      {query.isError && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void query.refetch()}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: t.information }}>Reload saved drafts</Text>
        </Pressable>
      )}
      {drafts.map((draft) => (
        <RecordRow
          key={draft.id}
          title={draft.subject || "Untitled draft"}
          subtitle={
            draft.to.map((person) => person.name || person.address).join(", ") ||
            "No recipients yet"
          }
          value={
            draft.sendStatus === "reconcile"
              ? "Needs review"
              : draft.sendStatus === "sending"
                ? "Sending"
                : undefined
          }
          valueTone={draft.sendStatus === "reconcile" ? "attention" : undefined}
          leading={<Icon name="edit" color={t.secondary} />}
          onPress={() => router.push({ pathname: "/mail-compose", params: { id: draft.id } })}
        />
      ))}
      {!!drafts.length && (
        <Text
          accessibilityRole="header"
          style={{ color: t.secondary, fontSize: 13, fontWeight: "600", marginTop: spacing.md }}
        >
          In your mailbox
        </Text>
      )}
    </View>
  );
}
