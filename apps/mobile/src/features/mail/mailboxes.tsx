import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Action, Section, SectionItem, SectionNote } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { confirmMailRead, retryMailRead, useMailAccounts, useMailRevalidation } from "./data";
import { inboxScope, type MailScope, mailboxIcon, mailboxLabel, sortMailboxes } from "./logic";
import { MailThreadList } from "./thread-list";

/**
 * Every connected account's mailboxes. Choosing one shows its conversations in place, and a
 * search typed over the list shows matches from every inbox.
 */
export function MailboxesScreen() {
  const t = useTheme();
  const accounts = useMailAccounts();
  useMailRevalidation();
  const [scope, setScope] = useState<MailScope | null>(null);
  const { mailSearch = "" } = useLocalSearchParams<{ mailSearch?: string }>();
  // A search belongs to the list it was typed over, so it never follows a mailbox switch.
  const show = (next: MailScope | null) => {
    router.setParams({ mailSearch: "" });
    setScope(next);
  };
  // With no mailbox open, a search has no list of its own, so it runs across all inboxes.
  const shown = scope ?? (mailSearch.trim() ? inboxScope : null);
  if (shown)
    return (
      <MailThreadList
        key={shown.kind === "inbox" ? "inbox" : shown.mailboxId}
        scope={shown}
        onBack={() => show(null)}
      />
    );
  const accent = workspaceColor(t, "mail");
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
            <SettingsAccentProvider workspace="mail">
              <Action
                label="Try again"
                onPress={() => void retryMailRead(() => accounts.refetch())}
              />
            </SettingsAccentProvider>
          </View>
        ) : !accounts.data.length ? (
          <Text style={{ color: t.secondary, fontSize: 15 }}>
            Connect a mailbox in Settings to see your messages.
          </Text>
        ) : (
          <View>
            <Section>
              <SectionItem>
                <RecordRow
                  centered
                  title="All inboxes"
                  leading={<Icon name="inbox" color={accent} />}
                  onPress={() => show(inboxScope)}
                />
              </SectionItem>
            </Section>
            {accounts.data.map((account) => (
              <Section
                key={account.accountId}
                title={
                  account.email && account.email !== account.label
                    ? `${account.label} · ${account.email}`
                    : account.label
                }
              >
                {account.mailboxes.length ? (
                  sortMailboxes(account.mailboxes).map((mailbox) => (
                    <SectionItem key={mailbox.id}>
                      {/* Labelled here so the unread count is read with the name, not as a hint. */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          mailbox.unreadCount
                            ? `${mailboxLabel(mailbox)}, ${mailbox.unreadCount} unread`
                            : mailboxLabel(mailbox)
                        }
                        accessibilityHint="Shows this mailbox's conversations."
                        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
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
                    </SectionItem>
                  ))
                ) : (
                  <SectionNote>No mailboxes have synced for this account yet.</SectionNote>
                )}
              </Section>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
