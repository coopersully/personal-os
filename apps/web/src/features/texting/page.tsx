import { textingConsentVersion } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useContext, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@/components/icons";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from "@/components/responsive-dialog";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/settings-field.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { Switch } from "../../components/ui/switch.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { SettingsSection } from "../settings/settings-layout";

export function TextingSettings({
  profile = false,
  inline = false,
}: {
  profile?: boolean;
  inline?: boolean;
}) {
  const settingsPage = useContext(SettingsControlsContext);
  const focusPhone = useCallback(
    (node: HTMLInputElement | null) => {
      if (inline) node?.focus();
    },
    [inline],
  );
  const focusCode = useCallback((node: HTMLInputElement | null) => node?.focus(), []);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryFn: api.getTextingConnection,
    queryKey: ["texting-connection"],
  });
  const [country, setCountry] = useState<"US" | "CA">("US");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const start = useFeedbackMutation({
    feedback: { action: "send a verification code", safeToRetry: false, form: true },
    mutationFn: () =>
      api.startTextingVerification({
        consentAccepted: true,
        consentVersion: textingConsentVersion,
        country,
        phoneNumber,
      }),
    onSuccess: (challenge) => setChallengeId(challenge.id),
  });
  const verify = useFeedbackMutation({
    feedback: { action: "verify this phone number", safeToRetry: false, form: true },
    mutationFn: () => {
      if (!challengeId) throw new Error("Request a verification code first.");
      return api.checkTextingVerification(challengeId, { code });
    },
    onSuccess: async () => {
      setEditing(false);
      setConsentAccepted(false);
      setChallengeId(null);
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["texting-connection"] });
    },
  });
  const disconnect = useFeedbackMutation({
    feedback: { action: "disconnect this phone number", safeToRetry: false, form: false },
    mutationFn: api.disconnectTexting,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["texting-connection"] }),
  });
  const current = connection.data;

  if (settingsPage && !profile && !inline) {
    return (
      <SettingsSection layout="rows" title="Phone">
        <TextingSettings profile inline />
        {current?.id && current.state !== "disconnected" ? (
          <FieldGroup>
            <FieldDescription>
              {current.state === "active"
                ? "Connected"
                : current.state === "opted_out"
                  ? "Texts are stopped. Reply START to restore delivery."
                  : "Connection needs attention"}
              {current.senderPhoneNumber ? ` · Messages from ${current.senderPhoneNumber}` : ""}
            </FieldDescription>
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel>Connection</FieldLabel>
              <Button
                type="button"
                variant="secondary"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect number
              </Button>
            </Field>
          </FieldGroup>
        ) : null}
      </SettingsSection>
    );
  }
  const Container = inline ? "div" : Card;
  const Content = inline ? "div" : CardContent;
  if (inline) {
    return (
      <>
        <div className="settings-inline-row px-4 py-0">
          <Field orientation="horizontal" className="min-h-10 justify-between">
            <FieldLabel>Phone</FieldLabel>
            <Button
              type="button"
              variant="ghost"
              aria-label="Edit Phone"
              className="font-normal text-muted-foreground"
              disabled={!connection.isSuccess}
              onClick={() => {
                setConsentAccepted(false);
                setCountry(current?.country ?? "US");
                setPhoneNumber("");
                setChallengeId(null);
                setCode("");
                setEditing(true);
              }}
            >
              {connection.isPending
                ? "Loading…"
                : connection.isError
                  ? "Unavailable"
                  : (current?.state !== "disconnected" && current?.maskedPhoneNumber) || "Not set"}
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </Field>
          <QueryFeedback query={connection} title="Couldn’t load your texting connection." />
        </div>
        <Dialog
          open={editing}
          onOpenChange={(open) => {
            if (!start.isPending && !verify.isPending) setEditing(open);
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{challengeId ? "Verify your phone" : "Phone settings"}</DialogTitle>
              <DialogDescription>
                {challengeId
                  ? "Step 2 of 2 · Enter the code sent to your phone."
                  : "Step 1 of 2 · Add your number and texting preference."}
              </DialogDescription>
            </DialogHeader>
            {!challengeId ? (
              <FeedbackForm
                feedback={start.feedback}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (consentAccepted && !challengeId) start.mutate();
                }}
              >
                <FieldGroup>
                  <Field orientation="horizontal" className="justify-between">
                    <FieldLabel htmlFor="texting-phone">Phone</FieldLabel>
                    <Input
                      ref={focusPhone}
                      id="texting-phone"
                      name="phoneNumber"
                      type="tel"
                      autoComplete="tel"
                      className="w-48 max-w-[60%]"
                      placeholder="(555) 555-0123"
                      value={phoneNumber}
                      required
                      disabled={start.isPending || !!challengeId}
                      onChange={(event) => setPhoneNumber(event.target.value)}
                    />
                  </Field>
                  <Field orientation="horizontal" className="justify-between">
                    <FieldLabel htmlFor="texting-country">Country</FieldLabel>
                    <NativeSelect
                      id="texting-country"
                      showIndicator={false}
                      className="profile-flat-select"
                      value={country}
                      disabled={start.isPending || !!challengeId}
                      onChange={(event) => setCountry(event.target.value as "US" | "CA")}
                    >
                      <NativeSelectOption value="US">United States</NativeSelectOption>
                      <NativeSelectOption value="CA">Canada</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field orientation="horizontal" className="justify-between">
                    <FieldLabel htmlFor="texting-consent">Allow agent text messages</FieldLabel>
                    <Switch
                      id="texting-consent"
                      aria-describedby="profile-phone-consent"
                      checked={consentAccepted}
                      disabled={start.isPending || !!challengeId}
                      onCheckedChange={(checked) => setConsentAccepted(checked === true)}
                    />
                  </Field>
                  <FieldDescription id="profile-phone-consent">
                    I agree to receive verification codes and conversational agent texts, reminders,
                    workspace updates, and questions from nohmi at this number. Message frequency
                    varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for
                    help. Consent is optional and is not a condition of purchase or using nohmi.{" "}
                    <a href="/privacy/" target="_blank" rel="noreferrer">
                      Privacy policy
                    </a>
                    {" · "}
                    <a href="/terms/" target="_blank" rel="noreferrer">
                      Terms
                    </a>
                    {" · "}
                    <a href="/sms/" target="_blank" rel="noreferrer">
                      SMS terms
                    </a>{" "}
                    (opens in a new tab).
                  </FieldDescription>
                  {current?.providerReady === false ? (
                    <FieldDescription>
                      Texting is not available on this nohmi deployment yet.
                    </FieldDescription>
                  ) : null}
                  <Field orientation="horizontal" className="justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={start.isPending}
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        !phoneNumber.trim() ||
                        !consentAccepted ||
                        start.isPending ||
                        !!challengeId ||
                        current?.providerReady === false
                      }
                    >
                      Send verification code
                    </Button>
                  </Field>
                </FieldGroup>
              </FeedbackForm>
            ) : (
              <FeedbackForm
                feedback={verify.feedback}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (challengeId) verify.mutate();
                }}
              >
                <FieldGroup>
                  <Field orientation="horizontal" className="justify-between">
                    <FieldLabel htmlFor="texting-code">Verification code</FieldLabel>
                    <Input
                      ref={focusCode}
                      id="texting-code"
                      name="code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      className="w-32"
                      placeholder="123456"
                      minLength={4}
                      required
                      disabled={!challengeId || verify.isPending}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </Field>
                  <Field orientation="horizontal" className="justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={start.isPending || verify.isPending}
                      onClick={() => {
                        setChallengeId(null);
                        setCode("");
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={!challengeId || code.length < 4 || verify.isPending}
                    >
                      Verify and connect
                    </Button>
                  </Field>
                </FieldGroup>
              </FeedbackForm>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <Container>
      {!inline ? (
        <CardHeader>
          <CardTitle aria-level={2} role="heading">
            {profile ? "Phone number" : "Agent texting"}
          </CardTitle>
          <CardDescription>
            {profile
              ? "Your verified number for agent text messages."
              : "Let authorized agents text you through nohmi’s shared number."}
          </CardDescription>
        </CardHeader>
      ) : null}
      <Content className={inline ? "flex flex-col gap-4 px-4 py-2" : "flex flex-col gap-5"}>
        <QueryFeedback query={connection} title="Couldn’t load your texting connection." />
        <MutationFeedback feedback={disconnect.feedback} />
        {profile && !inline ? (
          <Button asChild variant="ghost" className="self-start">
            <Link to="/settings?page=texting">Go to Agent Texting</Link>
          </Button>
        ) : null}
        {editing && !inline ? (
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            disabled={start.isPending || verify.isPending}
            onClick={() => {
              setEditing(false);
              setChallengeId(null);
              setCode("");
            }}
          >
            Cancel number change
          </Button>
        ) : null}

        {profile && !editing && !(current?.id && current.state !== "disconnected") ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {connection.isPending
                ? "Checking your phone number…"
                : connection.isError
                  ? "Phone status unavailable"
                  : "No verified phone number"}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={!connection.isSuccess}
              onClick={() => {
                setConsentAccepted(false);
                setEditing(true);
              }}
            >
              Add phone number
            </Button>
          </div>
        ) : current?.id && current.state !== "disconnected" && !editing ? (
          <FieldGroup>
            <p>
              <strong>{current.maskedPhoneNumber}</strong> ·{" "}
              {current.state === "active"
                ? "Ready"
                : current.state === "opted_out"
                  ? "Blocked by Twilio opt-out"
                  : current.state}
            </p>
            <p className="text-sm text-muted-foreground">
              {current.country === "US"
                ? "United States"
                : current.country === "CA"
                  ? "Canada"
                  : "Country unavailable"}
            </p>
            <FieldDescription>
              Messages come from {current.senderPhoneNumber ?? "nohmi’s shared number"}. Reply STOP
              to block texts. Only a later START reply can restore delivery after a Twilio opt-out.
            </FieldDescription>
            <Field orientation="horizontal">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                  setConsentAccepted(false);
                  setCountry(current.country ?? "US");
                  setPhoneNumber("");
                }}
              >
                Change number
              </Button>
              <Button
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
                type="button"
                variant="outline"
              >
                Disconnect number
              </Button>
            </Field>
          </FieldGroup>
        ) : challengeId ? (
          <FeedbackForm
            feedback={verify.feedback}
            onSubmit={(event) => {
              event.preventDefault();
              verify.mutate();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="texting-code">Verification code</FieldLabel>
                <Input
                  autoComplete="one-time-code"
                  id="texting-code"
                  name="code"
                  required
                  minLength={4}
                  inputMode="numeric"
                  onChange={(event) => setCode(event.target.value)}
                  value={code}
                />
              </Field>
              <Field orientation="horizontal">
                <Button disabled={verify.isPending} type="submit">
                  Verify and connect
                </Button>
              </Field>
            </FieldGroup>
          </FeedbackForm>
        ) : (
          <FeedbackForm
            feedback={start.feedback}
            onSubmit={(event) => {
              event.preventDefault();
              if (consentAccepted) start.mutate();
            }}
          >
            <FieldGroup>
              <FieldGroup
                className={inline ? "flex flex-col-reverse gap-4" : "grid gap-4 sm:grid-cols-2"}
              >
                <Field>
                  <FieldLabel htmlFor="texting-country">Country</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    id="texting-country"
                    disabled={start.isPending}
                    onChange={(event) => setCountry(event.target.value as "US" | "CA")}
                    value={country}
                  >
                    <NativeSelectOption value="US">United States</NativeSelectOption>
                    <NativeSelectOption value="CA">Canada</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field
                  orientation={inline ? "horizontal" : "vertical"}
                  className={inline ? "min-h-10 justify-between" : undefined}
                >
                  <FieldLabel htmlFor="texting-phone">
                    {inline ? "Phone" : "Mobile number"}
                  </FieldLabel>
                  <Input
                    ref={focusPhone}
                    className={inline ? "max-w-[65%] text-right" : undefined}
                    autoComplete="tel"
                    id="texting-phone"
                    disabled={start.isPending}
                    name="phoneNumber"
                    required
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="(555) 555-0123"
                    type="tel"
                    value={phoneNumber}
                  />
                </Field>
              </FieldGroup>
              <Field orientation="horizontal">
                <Switch
                  aria-describedby="texting-consent-description"
                  checked={consentAccepted}
                  id="texting-consent"
                  disabled={start.isPending}
                  onCheckedChange={(value) => setConsentAccepted(value === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="texting-consent">Allow agent text messages</FieldLabel>
                  <FieldDescription id="texting-consent-description">
                    I agree to receive verification codes and conversational agent texts, reminders,
                    workspace updates, and questions from nohmi at the number I provide. Message
                    frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or
                    HELP for help. Consent is optional and is not a condition of purchase or of
                    using nohmi.
                  </FieldDescription>
                  <FieldDescription>
                    <a href="/privacy/" target="_blank" rel="noreferrer">
                      Privacy policy
                    </a>
                    {" · "}
                    <a href="/terms/" target="_blank" rel="noreferrer">
                      Terms of use
                    </a>
                    {" · "}
                    <a href="/sms/" target="_blank" rel="noreferrer">
                      SMS terms
                    </a>
                    {" (opens in a new tab)."}
                  </FieldDescription>
                </FieldContent>
              </Field>
              {current?.providerReady === false ? (
                <Alert role="status">
                  <AlertDescription>
                    Texting is not available on this nohmi deployment yet.
                  </AlertDescription>
                </Alert>
              ) : null}
              {!consentAccepted ? (
                <p id="consent-required">Allow agent text messages before requesting a code.</p>
              ) : null}
              <Field orientation="horizontal">
                <Button
                  aria-describedby={!consentAccepted ? "consent-required" : undefined}
                  disabled={!consentAccepted || start.isPending || current?.providerReady === false}
                  type="submit"
                >
                  Send verification code
                </Button>
              </Field>
            </FieldGroup>
          </FeedbackForm>
        )}
        {inline && editing ? (
          <Button
            type="button"
            variant="secondary"
            className="self-end"
            disabled={start.isPending || verify.isPending}
            onClick={() => {
              setEditing(false);
              setChallengeId(null);
              setCode("");
            }}
          >
            Cancel number change
          </Button>
        ) : null}
      </Content>
    </Container>
  );
}
