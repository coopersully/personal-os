import { createInvitationInputSchema } from "@personal-os/domain";
import { useState } from "react";
import { Text, View } from "react-native";
import { toast } from "sonner-native";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, confirm, Field, FormBody, Section, State, styles } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
export function SecuritySettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Security key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function Security() {
  const { state, session } = useAuth();
  const t = useTheme();
  const action = useSettingsAction();
  const sessions = useSettingsResource("sessions", (api) => api.listSessions());
  const invitations = useSettingsResource(
    "invitations",
    (api) => api.listInvitations(),
    state.user?.canManageInvitations === true,
  );
  const [email, setEmail] = useState("");
  const [expiry, setExpiry] = useState("14");
  const [code, setCode] = useState<string | null>(null);
  return (
    <FormBody>
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
      <Section title="Signed-in devices">
        {sessions.data?.map((device) => (
          <View key={device.id} style={{ padding: 16, gap: 4 }}>
            <Text style={{ color: t.ink, fontSize: 17 }}>
              {device.userAgent || "Unknown device"}
            </Text>
            <Text style={{ color: t.secondary }}>
              {device.ipAddress ?? "IP address unavailable"}
            </Text>
            <Text style={{ color: t.secondary }}>
              Created {new Date(device.createdAt).toLocaleString()}
            </Text>
            <Text style={{ color: t.secondary }}>
              Last active {new Date(device.lastSeenAt).toLocaleString()}
            </Text>
            <Text style={{ color: t.secondary }}>
              Expires {new Date(device.expiresAt).toLocaleString()}
            </Text>
            <Action
              label="Revoke session"
              destructive
              disabled={action.pending}
              onPress={() =>
                confirm(
                  "Revoke session?",
                  `${device.userAgent || "This device"} will need to sign in again. This may be your current session.`,
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
        ))}
        {!sessions.data && (
          <State loading={sessions.isPending} retry={() => void sessions.refetch()} />
        )}
        {sessions.data?.length === 0 && <State empty="No active sessions returned." />}
      </Section>
      {state.user?.canManageInvitations === true && (
        <>
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
          <Section title="Invitations">
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
        </>
      )}
    </FormBody>
  );
}
