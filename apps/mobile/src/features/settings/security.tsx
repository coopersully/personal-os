import type { Session } from "@personal-os/api-client";
import { createInvitationInputSchema } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { toast } from "sonner-native";
import { formRow } from "../../components/forms/form-row";
import { SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { Icon } from "../../components/icons";
import { SettingDetail, SettingLabel } from "../../components/settings-row-content";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, confirm, Field, FormBody, Section, State, styles } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import {
  SettingsActionRow,
  SettingsDetailRow,
  SettingsIdentity,
  SettingsRow,
} from "./settings-row";
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
/**
 * The session API returns no device name or platform, only the raw user agent. A name is
 * therefore only what that string supports: a browser and operating system, the nohmi app's
 * own networking signature, or another client's product name. Anything else stays unknown.
 */
export function sessionDeviceName(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  if (/^nohmi\/\S+ CFNetwork\//.test(userAgent)) return "nohmi app";
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
  const product = /^([A-Za-z][\w.-]*)\/\d/.exec(userAgent)?.[1];
  return (
    [browser, device].filter(Boolean).join(" on ") ||
    (product && product !== "Mozilla" ? product : "Unknown device")
  );
}
/** Recency in words, so a row never carries a full timestamp. Exact times are on the device page. */
export function sessionLastActive(lastSeenAt: string, now = Date.now()) {
  const seen = new Date(lastSeenAt);
  const minutes = Math.floor((now - seen.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "Last active time unavailable";
  if (minutes < 5) return "Active now";
  if (minutes < 60) return `Active ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  // Calendar days in the device's timezone: 30 hours ago can be the day before yesterday.
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(seen)) / 86_400_000);
  // A 25-hour fall-back day can hold 24 elapsed hours on one date, so hours also cover day 0.
  if (hours < 24 || days < 1) return `Active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (days === 1) return "Active yesterday";
  if (days < 7) return `Active ${days} days ago`;
  return `Last active ${seen.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
type Device = Session & { name: string; summary: string };
/** Only the server's `isCurrent` marks this device; the app then knows what it is running on. */
function describeDevice(session: Session): Device {
  const client = sessionDeviceName(session.userAgent);
  if (session.isCurrent !== true)
    return { ...session, name: client, summary: sessionLastActive(session.lastSeenAt) };
  return {
    ...session,
    name: Platform.OS === "ios" ? (Platform.isPad ? "This iPad" : "This iPhone") : "This device",
    summary: client === "Unknown device" ? "Active now" : `${client} · Active now`,
  };
}
/** Timestamps are compared as instants; an unreadable one sorts last. */
const seenAt = (session: Session) => {
  const time = Date.parse(session.lastSeenAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};
/** This device first, then the most recently active. */
function orderDevices(sessions: Session[]) {
  return sessions
    .map(describeDevice)
    .sort(
      (a, b) =>
        Number(b.isCurrent === true) - Number(a.isCurrent === true) || seenAt(b) - seenAt(a),
    );
}
const exactTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/**
 * The name keeps the row's full width and the summary sits under it, so neither wraps early.
 * At accessibility text sizes each line may take a second line rather than lose its end.
 */
function DeviceRow({ device }: { device: Device }) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const lines = fontScale >= 1.3 ? 2 : 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${device.summary.replace(" · ", ", ")}`}
      onPress={() =>
        router.push({ pathname: "/settings/security/device", params: { id: device.id } })
      }
      style={({ pressed }) => ({ ...formRow, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
        <SettingLabel numberOfLines={lines} style={{ flex: 0 }}>
          {device.name}
        </SettingLabel>
        <SettingDetail numberOfLines={lines}>{device.summary}</SettingDetail>
      </View>
      <Icon name="chevron" color={t.secondary} size={16} />
    </Pressable>
  );
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
  const devices = sessions.data ? orderDevices(sessions.data) : undefined;
  const current = devices?.find((device) => device.isCurrent === true);
  const others = devices?.filter((device) => device !== current);
  const device = devices?.find((item) => item.id === deviceId);
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
      {page === "root" && current && (
        <Section title="This device">
          <DeviceRow device={current} />
        </Section>
      )}
      {page === "root" && others && others.length + (current ? 1 : 0) > 0 && (
        <Section title={current ? "Other devices" : "Signed-in devices"}>
          {others.map((item) => (
            <DeviceRow key={item.id} device={item} />
          ))}
          {others.length === 0 && <SectionNote>No other devices are signed in.</SectionNote>}
        </Section>
      )}
      {(page === "root" || page === "device") && (!devices || devices.length === 0) && (
        <Section title={page === "root" ? "Signed-in devices" : undefined}>
          {devices ? (
            <State empty="No active sessions returned." />
          ) : (
            <State loading={sessions.isPending} retry={() => void sessions.refetch()} />
          )}
        </Section>
      )}
      {page === "device" && devices && devices.length > 0 && !device && (
        <Section>
          <State empty="This session is no longer active." />
        </Section>
      )}
      {page === "device" && device && (
        <>
          <Section>
            <SettingsIdentity name={device.name} detail={device.summary} leading={null} />
          </Section>
          <Section title="Session">
            <SettingsDetailRow label="Signed in" value={exactTime(device.createdAt)} />
            <SettingsDetailRow label="Last active" value={exactTime(device.lastSeenAt)} />
            <SettingsDetailRow label="Expires" value={exactTime(device.expiresAt)} />
            <SettingsDetailRow
              label="IP address"
              value={device.ipAddress ?? "IP address unavailable"}
            />
          </Section>
          <Section title="Device details">
            <SectionNote ink selectable>
              {device.userAgent || "Unknown device"}
            </SectionNote>
          </Section>
          <Section>
            <SettingsActionRow
              label="Revoke session"
              destructive
              disabled={action.pending}
              onPress={() =>
                confirm(
                  `Revoke ${device.name}?`,
                  device.isCurrent === true
                    ? "This is your current session. You will need to sign in again on this device."
                    : `${device.name} will need to sign in again. This may be your current session.`,
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
          </Section>
        </>
      )}
      {page === "root" && (
        <>
          <Section title="Account">
            <SettingsActionRow
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
            {state.user?.canManageInvitations === true && (
              <SettingsRow
                label="Invitations"
                icon="people"
                onPress={() => router.push("/settings/security/invitations")}
              />
            )}
          </Section>
          <Section>
            <SettingsActionRow
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
        </>
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
