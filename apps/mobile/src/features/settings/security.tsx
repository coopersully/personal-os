import { createInvitationInputSchema } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { toast } from "sonner-native";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { Icon } from "../../components/icons";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, confirm, Field, FormBody, Section, State, styles } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { SettingsDetailRow, SettingsIdentity, SettingsRow } from "./settings-row";
export function SecuritySettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Security key={`${state.user.id}:${session.epoch()}`} /> : null;
}
export function SecurityDeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, session } = useAuth();
  return state.user ? (
    <Security key={`${state.user.id}:${session.epoch()}:${id}`} page="device" deviceId={id} />
  ) : null;
}
export function SecurityInvitationsScreen() {
  const { state, session } = useAuth();
  return state.user ? (
    <Security key={`${state.user.id}:${session.epoch()}`} page="invitations" />
  ) : null;
}
export function SecurityInvitationCreateScreen() {
  const { state, session } = useAuth();
  return state.user ? <Security key={`${state.user.id}:${session.epoch()}`} page="create" /> : null;
}
export function sessionDeviceName(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const device = /iPad/.test(userAgent)
    ? "iPad"
    : /iPhone/.test(userAgent)
      ? "iPhone"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return [browser, device].filter(Boolean).join(" on ") || "Signed-in device";
}
function Security({
  page = "root",
  deviceId,
}: {
  page?: "root" | "device" | "invitations" | "create";
  deviceId?: string;
}) {
  const { state, session } = useAuth();
  const t = useTheme();
  const action = useSettingsAction();
  const sessions = useSettingsResource(
    "sessions",
    (api) => api.listSessions(),
    page === "root" || page === "device",
  );
  const invitations = useSettingsResource(
    "invitations",
    (api) => api.listInvitations(),
    state.user?.canManageInvitations === true && (page === "invitations" || page === "create"),
  );
  const [email, setEmail] = useState("");
  const [expiry, setExpiry] = useState("14");
  const [code, setCode] = useState<string | null>(null);
  useDirtyDismiss(page === "create" && (!!email || expiry !== "14" || !!code), action.pending);
  return (
    <FormBody>
      <Stack.Screen
        options={{
          title:
            page === "device"
              ? "Device"
              : page === "invitations"
                ? "Invitations"
                : page === "create"
                  ? "Create invitation"
                  : "Security",
        }}
      />
      {page === "root" && (
        <Section title="Account">
          <Action
            label="Send password reset email"
            disabled={action.pending}
            onPress={() =>
              confirm(
                "Reset password?",
                `Send a reset email to ${state.user?.email}?`,
                () =>
                  void action.run(
                    (api) => api.requestPasswordReset({ email: state.user?.email ?? "" }),
                    "Password reset email requested",
                  ),
              )
            }
          />
          <Action
            label="Sign out"
            destructive
            disabled={action.pending}
            onPress={() =>
              confirm(
                "Sign out?",
                "You’ll need to sign in again to use nohmi.",
                () => void action.run(() => session.logout()),
                true,
              )
            }
          />
        </Section>
      )}
      {(page === "root" || page === "device") && (
        <Section title="Signed-in devices">
          {sessions.data
            ?.filter((device) => page === "root" || device.id === deviceId)
            .map((device) =>
              page === "root" ? (
                <SettingsRow
                  key={device.id}
                  label={sessionDeviceName(device.userAgent)}
                  value={`${device.isCurrent === true ? "Current device · " : ""}Last active ${new Date(device.lastSeenAt).toLocaleDateString()}`}
                  icon="profile"
                  onPress={() =>
                    router.push({
                      pathname: "/settings/security/device",
                      params: { id: device.id },
                    })
                  }
                />
              ) : (
                <View key={device.id} style={{ padding: 16, gap: 4 }}>
                  <SettingsIdentity
                    name={sessionDeviceName(device.userAgent)}
                    leading={<Icon name="profile" size={24} color={t.secondary} />}
                  />
                  {device.isCurrent === true && (
                    <SettingsDetailRow label="Session" value="Current device" />
                  )}
                  <SettingsDetailRow
                    label="Device details"
                    value={device.userAgent || "Unknown device"}
                  />
                  <SettingsDetailRow
                    label="IP address"
                    value={device.ipAddress ?? "IP address unavailable"}
                  />
                  <SettingsDetailRow
                    label="Created"
                    value={new Date(device.createdAt).toLocaleString()}
                  />
                  <SettingsDetailRow
                    label="Last active"
                    value={new Date(device.lastSeenAt).toLocaleString()}
                  />
                  <SettingsDetailRow
                    label="Expires"
                    value={new Date(device.expiresAt).toLocaleString()}
                  />
                  <Action
                    label="Revoke session"
                    destructive
                    disabled={action.pending}
                    onPress={() =>
                      confirm(
                        `Revoke ${sessionDeviceName(device.userAgent)}?`,
                        device.isCurrent === true
                          ? "This is your current session. You will need to sign in again on this device."
                          : `${sessionDeviceName(device.userAgent)} will need to sign in again. This may be your current session.`,
                        () =>
                          void action.run(async (api) => {
                            await api.revokeSession(device.id);
                            await session.revalidate();
                            await sessions.refetch();
                          }, "Session revoked"),
                        true,
                      )
                    }
                  />
                </View>
              ),
            )}
          {!sessions.data && (
            <State loading={sessions.isPending} retry={() => void sessions.refetch()} />
          )}
          {sessions.data?.length === 0 && <State empty="No active sessions returned." />}
          {page === "device" &&
            sessions.data &&
            sessions.data.length > 0 &&
            !sessions.data.some((device) => device.id === deviceId) && (
              <State empty="This session is no longer active." />
            )}
        </Section>
      )}
      {page === "root" && state.user?.canManageInvitations === true && (
        <Section>
          <SettingsRow
            label="Invitations"
            icon="people"
            onPress={() => router.push("/settings/security/invitations")}
          />
        </Section>
      )}
      {state.user?.canManageInvitations === true &&
        (page === "invitations" || page === "create") && (
          <>
            {page === "create" && (
              <Section title="Create invitation">
                <Field
                  label="Recipient"
                  placeholder="alex@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Field
                  label="Expires after days"
                  value={expiry}
                  placeholder="14"
                  keyboardType="number-pad"
                  onChangeText={setExpiry}
                />
                <Action
                  label="Create invitation"
                  disabled={action.pending}
                  onPress={() => {
                    const parsed = createInvitationInputSchema.safeParse({
                      ...(email.trim() ? { email: email.trim() } : {}),
                      expiresInDays: /^\d+$/.test(expiry) ? Number(expiry) : Number.NaN,
                    });
                    if (!parsed.success) {
                      toast.error(parsed.error.issues[0]?.message ?? "Check invitation details.");
                      return;
                    }
                    void action.run(async (api) => {
                      const created = await api.createInvitation(parsed.data);
                      setCode(created.code);
                      await invitations.refetch();
                    }, "Invitation created");
                  }}
                />
                {code && (
                  <View style={styles.settingRow}>
                    <Text style={{ color: t.ink }}>Invitation code</Text>
                    <Text selectable style={{ color: t.ink, fontSize: 20 }}>
                      {code}
                    </Text>
                  </View>
                )}
              </Section>
            )}
            {page === "invitations" && (
              <Section title="Invitations">
                <SettingsRow
                  label="Create invitation"
                  icon="add"
                  onPress={() => router.push("/settings/security/create-invitation")}
                />
                {invitations.data?.map((invite) => (
                  <View key={invite.id} style={styles.settingRow}>
                    <Text style={{ color: t.ink, flex: 1 }}>{invite.email || "Any recipient"}</Text>
                    <Text style={{ color: t.secondary }}>
                      {invite.redeemedAt
                        ? "Redeemed"
                        : new Date(invite.expiresAt) < new Date()
                          ? "Expired"
                          : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                    </Text>
                  </View>
                ))}
                {!invitations.data && (
                  <State loading={invitations.isPending} retry={() => void invitations.refetch()} />
                )}
                {invitations.data?.length === 0 && <State empty="No invitations yet." />}
              </Section>
            )}
          </>
        )}
    </FormBody>
  );
}
