import { ApiClientError } from "@personal-os/api-client";
import type { TextingVerificationChallenge } from "@personal-os/domain";
import {
  checkTextingVerificationInputSchema,
  startTextingVerificationInputSchema,
  textingConsentVersion,
} from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Linking, Text } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
export function TextingSettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Texting key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function Texting() {
  const t = useTheme();
  const action = useSettingsAction();
  const connection = useSettingsResource("texting", (api) => api.getTextingConnection());
  const [country, setCountry] = useState<"US" | "CA">("US");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState<TextingVerificationChallenge | null>(null);
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        setNow(Date.now());
        void connection.refetch();
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      listener.remove();
      clearInterval(timer);
    };
  }, [connection.refetch]);
  const expired = challenge ? new Date(challenge.expiresAt).getTime() <= now : false;
  const connected = connection.data?.state === "active";
  const cancel = () =>
    confirm(
      "Cancel phone setup?",
      "This clears the code from this form. A code already requested may still arrive.",
      () => {
        setChallenge(null);
        setCode("");
        setConsent(false);
        setEditing(false);
      },
    );
  const open = (path: string) =>
    void action.run(
      () => Linking.openURL(`https://nohmi.coopersully.me/${path}/`),
      "Opened in browser",
    );
  return (
    <FormBody>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          ...editorDismissOptions({
            label: phone || code || consent || challenge || editing ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () =>
              phone || code || consent || challenge || editing
                ? confirm(
                    "Leave phone setup?",
                    "The code already requested may still arrive. Your unsaved phone setup will be cleared.",
                    () => router.back(),
                  )
                : router.back(),
          }),
        }}
      />
      <Section title="Texting">
        {connection.data ? (
          <>
            <Text style={{ padding: 16, color: t.ink, fontSize: 17 }}>
              {connection.data.maskedPhoneNumber ?? "No phone connected"}
            </Text>
            <Text
              style={{
                paddingHorizontal: 16,
                paddingBottom: 16,
                color: connection.data.state === "active" ? t.secondary : t.warning,
              }}
            >
              {connection.data.state?.replaceAll("_", " ") ?? "Not connected"}
              {!connection.data.providerReady
                ? " · Texting is unavailable on this deployment."
                : ""}
            </Text>
            {connection.data.senderPhoneNumber && (
              <Text selectable style={{ padding: 16, color: t.secondary }}>
                nohmi number: {connection.data.senderPhoneNumber}
              </Text>
            )}
            {connected && !editing && (
              <Action
                label="Change phone number"
                disabled={action.pending}
                onPress={() => setEditing(true)}
              />
            )}
            {connection.data.id && (
              <Action
                label="Disconnect texting"
                destructive
                disabled={action.pending}
                onPress={() =>
                  confirm(
                    "Disconnect texting?",
                    "nohmi will stop sending texts to this number. Reconnecting requires verification and consent.",
                    () =>
                      void action.run(async (api) => {
                        await api.disconnectTexting();
                        setChallenge(null);
                        setCode("");
                        setConsent(false);
                        await connection.refetch();
                      }, "Texting disconnected"),
                    true,
                  )
                }
              />
            )}
          </>
        ) : (
          <State loading={connection.isPending} retry={() => void connection.refetch()} />
        )}
      </Section>
      {connection.data && (!connected || editing) && (
        <Section title={challenge ? "Verify phone" : "Connect phone"}>
          {challenge ? (
            <>
              <Text style={{ padding: 16, color: t.secondary }}>
                Code requested for {challenge.maskedPhoneNumber}.{" "}
                {expired
                  ? "This code has expired."
                  : `Expires ${new Date(challenge.expiresAt).toLocaleTimeString()}.`}
              </Text>
              <Field
                label="Verification code"
                placeholder="123456"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                editable={!action.pending && !expired}
              />
              <Action
                label="Verify and connect"
                disabled={action.pending || expired || !/^\d{4,10}$/.test(code)}
                onPress={() => {
                  const parsed = checkTextingVerificationInputSchema.safeParse({ code });
                  if (!parsed.success) {
                    toast.error("Enter the verification code.");
                    return;
                  }
                  void action
                    .run(
                      (api) => api.checkTextingVerification(challenge.id, parsed.data),
                      (result) =>
                        result.state === "active"
                          ? "Phone connection confirmed"
                          : "Phone verification checked. Review the current state.",
                    )
                    .then((result) => {
                      if (result.ok) {
                        if (result.value.state === "active") {
                          setChallenge(null);
                          setCode("");
                          setConsent(false);
                          setEditing(false);
                        }
                        void connection.refetch();
                      }
                    });
                }}
              />
              <Action
                label="Start again"
                disabled={action.pending}
                onPress={() => {
                  setChallenge(null);
                  setCode("");
                }}
              />
            </>
          ) : (
            <>
              <Choice
                label="Country"
                value={country}
                options={[
                  { value: "US", label: "United States" },
                  { value: "CA", label: "Canada" },
                ]}
                onChange={(value) => setCountry(value as "US" | "CA")}
                disabled={action.pending}
              />
              <Field
                label="Mobile number"
                placeholder="(555) 555-0123"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                editable={!action.pending}
              />
              <ToggleRow
                label="Allow agent text messages"
                value={consent}
                disabled={action.pending}
                onChange={setConsent}
              />
              <Text style={{ padding: 16, color: t.secondary }}>
                I agree to receive verification codes and conversational agent texts, reminders,
                workspace updates, and questions from nohmi at the number I provide. Message
                frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or
                HELP for help. Consent is optional and is not a condition of purchase or of using
                nohmi.
              </Text>
              <Action label="Privacy policy" onPress={() => open("privacy")} />
              <Action label="Terms of use" onPress={() => open("terms")} />
              <Action label="SMS terms" onPress={() => open("sms")} />
              <Action
                label="Send verification code"
                disabled={
                  action.pending || !consent || !phone.trim() || !connection.data.providerReady
                }
                onPress={() => {
                  const parsed = startTextingVerificationInputSchema.safeParse({
                    country,
                    phoneNumber: phone,
                    consentAccepted: consent,
                    consentVersion: textingConsentVersion,
                  });
                  if (!parsed.success) {
                    toast.error(parsed.error.issues[0]?.message ?? "Check your phone and consent.");
                    return;
                  }
                  void action
                    .run(
                      async (api) => {
                        const result = await api.startTextingVerification(parsed.data);
                        if (result.status !== "pending" && result.status !== "approved")
                          throw new ApiClientError({
                            status: 422,
                            code: "verification_not_pending",
                            message: `Verification ${result.status}. Start again to request another code.`,
                          });
                        return result;
                      },
                      (result) =>
                        result.status === "pending"
                          ? "Verification code requested"
                          : "Verification approved. Checking the connection.",
                    )
                    .then((result) => {
                      if (result.ok) {
                        setChallenge(result.value);
                        setCode("");
                        setNow(Date.now());
                        if (result.value.status === "approved") void connection.refetch();
                      }
                    });
                }}
              />
            </>
          )}
          <Action label="Cancel phone setup" disabled={action.pending} onPress={cancel} />
        </Section>
      )}
    </FormBody>
  );
}
