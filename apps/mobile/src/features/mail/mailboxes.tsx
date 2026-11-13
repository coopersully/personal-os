import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { confirmMailRead, retryMailRead, useMailAccounts, useMailRevalidation } from "./data";
import { inboxScope, type MailScope, mailboxIcon, mailboxLabel, sortMailboxes } from "./logic";
import { MailThreadList } from "./thread-list";

/** Every connected account's mailboxes. Choosing one shows its conversations in place. */
export function MailboxesScreen() {
  const t = useTheme();
  const accounts = useMailAccounts();
  useMailRevalidation();
  const [scope, setScope] = useState<MailScope | null>(null);
  // A search belongs to the list it was typed over, so it never follows a mailbox switch.
  const show = (next: MailScope | null) => {
    router.setParams({ mailSearch: "" });
    setScope(next);
  };
  if (scope)
    return (
      <MailThreadList
        key={scope.kind === "inbox" ? "inbox" : scope.mailboxId}
        scope={scope}
        onBack={() => show(null)}
      />
    );
  const accent = workspaceColor(t, "mail");
  const panel = {
    backgroundColor: t.surface,
    borderRadius: radius.panel,
    paddingHorizontal: spacing.lg,
  };
  return (
    <Screen chrome onRefresh={() => confirmMailRead(accounts.refetch())}>
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>
          Mailboxes
        </Text>
        {accounts.isPending ? (
          <ActivityIndicator accessibilityLabel="Loading mailboxes" />
        ) : !accounts.data ? (
          <View style={{ gap: spacing.sm, alignItems: "center", paddingTop: spacing.xl }}>
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: "600" }}>
              Mailboxes aren’t available
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void retryMailRead(() => accounts.refetch())}
              style={{ minHeight: touchTarget, justifyContent: "center" }}
            >
              <Text style={{ color: t.information, fontSize: 17 }}>Try again</Text>
            </Pressable>
          </View>
        ) : !accounts.data.length ? (
          <Text style={{ color: t.secondary, fontSize: 15 }}>
            Connect a mailbox in Settings to see your messages.
          </Text>
        ) : (
          <>
            <View style={panel}>
              <RecordRow
                centered
                title="All inboxes"
                leading={<Icon name="inbox" color={accent} />}
                onPress={() => show(inboxScope)}
              />
            </View>
            {accounts.data.map((account) => (
              <View key={account.accountId} style={{ gap: spacing.sm }}>
                <Text
                  accessibilityRole="header"
                  style={{ color: t.secondary, fontSize: 13, paddingHorizontal: spacing.lg }}
                >
                  {account.email && account.email !== account.label
                    ? `${account.label} · ${account.email}`
                    : account.label}
                </Text>
                <View style={panel}>
                  {account.mailboxes.length ? (
                    sortMailboxes(account.mailboxes).map((mailbox, index) => (
                      <View
                        key={mailbox.id}
                        style={index ? { borderTopWidth: 0.5, borderTopColor: t.line } : undefined}
                      >
                        {/* Labelled here so the unread count is read with the name, not as a hint. */}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            mailbox.unreadCount
                              ? `${mailboxLabel(mailbox)}, ${mailbox.unreadCount} unread`
                              : mailboxLabel(mailbox)
                          }
                          accessibilityHint="Shows this mailbox's conversations."
                          style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                          onPress={() =>
                            show({
                              kind: "mailbox",
                              mailboxId: mailbox.id,
                              title: mailboxLabel(mailbox),
                              account: account.label,
                            })
                          }
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <RecordRow
                              centered
                              title={mailboxLabel(mailbox)}
                              value={mailbox.unreadCount ? String(mailbox.unreadCount) : undefined}
                              leading={<Icon name={mailboxIcon(mailbox.role)} color={accent} />}
                            />
                          </View>
                          <Icon name="chevron" size={16} color={t.secondary} />
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={{ color: t.secondary, fontSize: 15, paddingVertical: spacing.lg }}>
                      No mailboxes have synced for this account yet.
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}
