import type { CalendarAccount } from "@personal-os/api-client";
import { connectICloudInputSchema } from "@personal-os/domain";
import { useEffect, useState } from "react";
import { AppState, Linking, Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { SheetHeader } from "../../components/sheet-header";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { SearchableChoice } from "../tasks/searchable-choice";
import { Action, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
export async function openAuthorization(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("The authorization address is invalid.");
  await Linking.openURL(url);
}
export function ConnectionsSettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Connections key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function Connections() {
  const t = useTheme();
  const action = useSettingsAction();
  const accounts = useSettingsResource("connectors", (api) => api.listConnectors());
  const x = useSettingsResource("x-account", (api) => api.getXBookmarkAccount());
  const folders = useSettingsResource("x-folders", (api) => api.listXBookmarkFolders(), !!x.data);
  const [icloud, setIcloud] = useState(false);
  const [reconnectIcloud, setReconnectIcloud] = useState<CalendarAccount | null>(null);
  const [mail, setMail] = useState(true);
  const [calendar, setCalendar] = useState(true);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void accounts.refetch();
        void x.refetch();
        if (x.data) void folders.refetch();
      }
    });
    return () => listener.remove();
  }, [accounts.refetch, x.refetch, folders.refetch, x.data]);
  const google = (account?: CalendarAccount) =>
    confirm(
      "Continue in browser?",
      "Finish Google authorization in your browser, then return to nohmi and refresh. Opening the browser does not confirm a connection.",
      () =>
        void action.run(async (api) => {
          const services = account
            ? [
                ...(account.mailEnabled ? ["mail" as const] : []),
                ...(account.calendarEnabled ? ["calendar" as const] : []),
              ]
            : [...(mail ? ["mail" as const] : []), ...(calendar ? ["calendar" as const] : [])];
          const url = await api.getGoogleAuthorizationUrl({
            ...(account ? { accountId: account.id } : {}),
            returnTo: "/settings?section=connections",
            services,
          });
          await openAuthorization(url);
        }, "Browser opened. Finish authorization, then return to nohmi."),
    );
  return (
    <FormBody>
      <Section title="Accounts">
        {!accounts.data && (
          <State loading={accounts.isPending} retry={() => void accounts.refetch()} />
        )}
        {accounts.data?.length === 0 && <State empty="No connected accounts." />}
        {accounts.data?.map((account) => (
          <View key={account.id} style={{ padding: 16, gap: 8 }}>
            <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>{account.label}</Text>
            <Text style={{ color: t.secondary }}>{account.email ?? account.provider}</Text>
            <Text style={{ color: account.health.state === "ready" ? t.secondary : t.warning }}>
              {account.health.state.replaceAll("_", " ")}
              {account.health.message ? ` · ${account.health.message}` : ""}
            </Text>
            <Text style={{ color: t.secondary }}>
              {[account.mailEnabled ? "Mail" : null, account.calendarEnabled ? "Calendar" : null]
                .filter(Boolean)
                .join(" · ") || "No enabled services"}
            </Text>
            <Text style={{ color: t.secondary }}>
              Last synced{" "}
              {account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString() : "Never"}
            </Text>
            {Object.entries(account.capabilities ?? {}).map(([service, capability]) => (
              <Text
                key={service}
                style={{ color: capability.health.state === "ready" ? t.secondary : t.warning }}
              >
                {service}: {capability.health.state.replaceAll("_", " ")}
              </Text>
            ))}
            <Action
              label="Sync now"
              disabled={action.pending || account.syncStatus === "syncing"}
              onPress={() =>
                void action.run(
                  async (api) => {
                    const result = await api.syncConnector(account.id);
                    await accounts.refetch();
                    return result;
                  },
                  (result) =>
                    result.pending
                      ? "Sync requested. Check account status for completion."
                      : `Sync confirmed: ${result.changed} changes.`,
                )
              }
            />
            {account.provider === "google" && (
              <Action
                label="Reconnect in browser"
                disabled={action.pending}
                onPress={() => google(account)}
              />
            )}
            {account.provider === "icloud" && (
              <Action
                label="Update iCloud credentials"
                disabled={action.pending}
                onPress={() => {
                  setReconnectIcloud(account);
                  setIcloud(true);
                }}
              />
            )}
            <Action
              label="Disconnect account"
              destructive
              disabled={action.pending}
              onPress={() =>
                confirm(
                  `Disconnect ${account.label}?`,
                  "This removes the account connection. Its mail and calendar will stop syncing.",
                  () =>
                    void action.run(async (api) => {
                      await api.deleteConnector(account.id);
                      await accounts.refetch();
                    }, "Account disconnected"),
                  true,
                )
              }
            />
          </View>
        ))}
        <Action
          label="Refresh connections"
          disabled={accounts.isFetching || action.pending}
          onPress={() =>
            void action.run(async () => {
              const results = await Promise.all([accounts.refetch(), x.refetch()]);
              for (const result of results) if (result.error) throw result.error;
            }, "Connection status refreshed")
          }
        />
      </Section>
      <Section title="Add account">
        <ToggleRow label="Mail" value={mail} onChange={setMail} />
        <ToggleRow label="Calendar" value={calendar} onChange={setCalendar} />
        <Action
          label="Connect Google in browser"
          disabled={action.pending || (!mail && !calendar)}
          onPress={() => google()}
        />
        <Action
          label="Connect iCloud"
          disabled={action.pending}
          onPress={() => {
            setReconnectIcloud(null);
            setIcloud(true);
          }}
        />
      </Section>
      <Section title="X bookmarks">
        {x.isPending ? (
          <State loading />
        ) : x.isError ? (
          <State retry={() => void x.refetch()} />
        ) : x.data ? (
          <>
            <Text style={{ padding: 16, color: t.ink, fontSize: 17 }}>
              @{x.data.username} · {x.data.syncStatus}
            </Text>
            {x.data.syncError && (
              <Text style={{ padding: 16, color: t.warning }}>{x.data.syncError}</Text>
            )}
            <SearchableChoice
              label="Bookmark folder"
              value={x.data.selectedFolderId ?? ""}
              options={[
                ...(x.data.selectedFolderId &&
                !(folders.data ?? []).some(
                  (folder) => folder.remoteFolderId === x.data?.selectedFolderId,
                )
                  ? [
                      {
                        value: x.data.selectedFolderId,
                        label: x.data.selectedFolderName ?? "Unavailable folder",
                      },
                    ]
                  : []),
                ...(folders.data ?? []).map((folder) => ({
                  value: folder.remoteFolderId,
                  label: folder.name,
                })),
              ]}
              disabled={action.pending || folders.isError || folders.isPending}
              onChange={(value) =>
                void action.run(async (api) => {
                  await api.selectXBookmarkFolder(value);
                  await x.refetch();
                }, "Bookmark folder selected")
              }
            />
            {folders.isError && (
              <Action label="Retry loading folders" onPress={() => void folders.refetch()} />
            )}
            <Action
              label="Sync bookmarks"
              disabled={
                action.pending || x.data.syncStatus === "syncing" || !x.data.selectedFolderId
              }
              onPress={() =>
                void action.run(
                  async (api) => {
                    const changed = await api.syncXBookmarks();
                    await x.refetch();
                    return changed;
                  },
                  (changed) => `Bookmark sync confirmed: ${changed} changes.`,
                )
              }
            />
            <Action
              label="Disconnect X"
              destructive
              disabled={action.pending}
              onPress={() =>
                confirm(
                  "Disconnect X?",
                  "Bookmark syncing will stop.",
                  () =>
                    void action.run(async (api) => {
                      await api.deleteXBookmarkAccount();
                      await x.refetch();
                    }, "X disconnected"),
                  true,
                )
              }
            />
          </>
        ) : (
          <Text style={{ padding: 16, color: t.secondary }}>No X account connected.</Text>
        )}
        <Action
          label={x.data ? "Reconnect X in browser" : "Connect X in browser"}
          disabled={action.pending}
          onPress={() =>
            confirm(
              "Continue in browser?",
              "Finish X authorization in the browser, then return to nohmi to refresh the connection.",
              () =>
                void action.run(
                  async (api) => openAuthorization(await api.getXBookmarkAuthorizationUrl()),
                  "Browser opened. Return to nohmi to check the connection.",
                ),
            )
          }
        />
      </Section>
      {icloud && (
        <ICloudForm
          mail={reconnectIcloud?.mailEnabled ?? mail}
          calendar={reconnectIcloud?.calendarEnabled ?? calendar}
          initialEmail={reconnectIcloud?.email ?? ""}
          onClose={() => setIcloud(false)}
          onConnected={() => {
            setIcloud(false);
            void accounts.refetch();
          }}
        />
      )}
    </FormBody>
  );
}
function ICloudForm({
  mail,
  calendar,
  initialEmail,
  onClose,
  onConnected,
}: {
  mail: boolean;
  calendar: boolean;
  initialEmail: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const t = useTheme();
  const action = useSettingsAction();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [useMail, setUseMail] = useState(mail);
  const [useCalendar, setUseCalendar] = useState(calendar);
  const close = () => {
    if (action.pending) return;
    if (email || password)
      confirm("Discard iCloud setup?", "Your unsaved credentials will be cleared.", () => {
        setPassword("");
        onClose();
      });
    else onClose();
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={false}
      onRequestClose={close}
    >
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: t.canvas }}>
        <SheetHeader
          title="Connect iCloud"
          label={email || password ? "Cancel" : "Close"}
          onClose={close}
        />
        <FormBody>
          <Section>
            <Field
              label="Apple Account"
              placeholder="alex@icloud.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              editable={!action.pending}
            />
            <Field
              label="App-specific password"
              placeholder="abcd-efgh-ijkl-mnop"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              editable={!action.pending}
            />
            <ToggleRow
              label="Mail"
              value={useMail}
              onChange={setUseMail}
              disabled={action.pending}
            />
            <ToggleRow
              label="Calendar"
              value={useCalendar}
              onChange={setUseCalendar}
              disabled={action.pending}
            />
            <Action
              label="Connect account"
              disabled={action.pending || !email || !password || (!useMail && !useCalendar)}
              onPress={() => {
                const parsed = connectICloudInputSchema.safeParse({
                  email,
                  appSpecificPassword: password,
                  mail: useMail,
                  calendar: useCalendar,
                });
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Check your iCloud credentials.");
                  return;
                }
                void action
                  .run((api) => api.connectICloud(parsed.data), "iCloud connection confirmed")
                  .then((result) => {
                    if (result.ok) {
                      setPassword("");
                      onConnected();
                    }
                  });
              }}
            />
          </Section>
          <Text style={{ color: t.secondary }}>
            Use an app-specific password created in your Apple Account. Your password stays only in
            this form until submitted.
          </Text>
        </FormBody>
      </SafeAreaView>
    </Modal>
  );
}
