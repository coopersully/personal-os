import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { useAuth } from "../auth/context";
import { MailDrafts } from "./drafts";
import { MailInbox } from "./inbox";
import { type MailFolder, mailFolders, useMailScope } from "./scope";

export function MailboxesScreen() {
  const t = useTheme();
  const { session, state } = useAuth();
  const { accountId, setAccountId } = useMailScope();
  const [expanded, setExpanded] = useState(false);
  const [folder, setFolder] = useState<MailFolder | null>(null);
  const setup = useQuery({
    queryKey: ["mail", state.user?.id, "accounts"],
    queryFn: () => session.api().getMailSetupContext(),
  });
  const accounts = setup.data?.accounts ?? [];
  const current = accounts.find((account) => account.accountId === accountId);
  const back = () => {
    setFolder(null);
    router.setParams({ mailSearch: "" });
  };
  if (folder)
    return (
      <MailInbox
        key={`${accountId}:${folder}`}
        folder={folder}
        onBack={back}
        extra={folder === "drafts" ? <MailDrafts accountId={accountId} /> : undefined}
      />
    );
  return (
    <Screen chrome>
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100 }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>
          Mailboxes
        </Text>
        {setup.isPending ? (
          <ActivityIndicator accessibilityLabel="Loading accounts" />
        ) : setup.isError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void setup.refetch()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: t.information }}>Reload accounts</Text>
          </Pressable>
        ) : (
          <>
            <View
              style={{
                backgroundColor: t.surface,
                borderRadius: radius.panel,
                paddingHorizontal: spacing.lg,
              }}
            >
              <RecordRow
                centered
                title="Account"
                subtitle={current?.email ?? undefined}
                value={current?.label ?? (accountId ? "Account unavailable" : "All accounts")}
                valueTone={accountId && !current ? "attention" : undefined}
                leading={<Icon name="profile" color={t.secondary} />}
                onPress={() => setExpanded(!expanded)}
              />
              {expanded &&
                [{ accountId: "", label: "All accounts", email: null }, ...accounts].map(
                  (account) => (
                    <Pressable
                      key={account.accountId}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: accountId === account.accountId }}
                      accessibilityLabel={
                        account.email ? `${account.label}, ${account.email}` : account.label
                      }
                      onPress={() => {
                        setAccountId(account.accountId, account.label);
                        setExpanded(false);
                        router.setParams({ mailSearch: "" });
                      }}
                      style={{
                        minHeight: 56,
                        paddingVertical: spacing.md,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.md,
                        borderTopWidth: 0.5,
                        borderTopColor: t.line,
                      }}
                    >
                      <Icon name={account.accountId ? "profile" : "mail"} color={t.secondary} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ color: t.ink, fontSize: 17 }}>{account.label}</Text>
                        {account.email && (
                          <Text style={{ color: t.secondary, fontSize: 13 }}>{account.email}</Text>
                        )}
                      </View>
                      {accountId === account.accountId && (
                        <Icon name="save" color={workspaceColor(t, "mail")} />
                      )}
                    </Pressable>
                  ),
                )}
            </View>
            <View
              style={{
                backgroundColor: t.surface,
                borderRadius: radius.panel,
                paddingHorizontal: spacing.lg,
              }}
            >
              {mailFolders.map((item, index) => (
                <View
                  key={item.role}
                  style={index ? { borderTopWidth: 0.5, borderTopColor: t.line } : undefined}
                >
                  <RecordRow
                    centered
                    title={item.label}
                    leading={<Icon name={item.icon} color={workspaceColor(t, "mail")} />}
                    onPress={() => {
                      router.setParams({ mailSearch: "" });
                      setFolder(item.role);
                    }}
                  />
                </View>
              ))}
            </View>
            {!accounts.length && (
              <Text style={{ color: t.secondary, fontSize: 15 }}>
                Connect a mailbox in Settings to see your messages.
              </Text>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
