import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";

export function TextingSettings({ profile = false }: { profile?: boolean }) {
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
    mutationFn: () => api.startTextingVerification({ consentAccepted: true, country, phoneNumber }),
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

  return (
    <Card>
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
      <CardContent className="flex flex-col gap-5">
        <QueryFeedback query={connection} title="Couldn’t load your texting connection." />
        <MutationFeedback feedback={disconnect.feedback} />
        {profile ? (
          <Button asChild variant="ghost" className="self-start">
            <Link to="/settings?section=texting">Go to Agent Texting</Link>
          </Button>
        ) : null}
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            className="self-start"
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
              onClick={() => setEditing(true)}
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
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="texting-country">Country</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    id="texting-country"
                    onChange={(event) => setCountry(event.target.value as "US" | "CA")}
                    value={country}
                  >
                    <NativeSelectOption value="US">United States</NativeSelectOption>
                    <NativeSelectOption value="CA">Canada</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="texting-phone">Mobile number</FieldLabel>
                  <Input
                    autoComplete="tel"
                    id="texting-phone"
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
                <Checkbox
                  aria-describedby="texting-consent-description"
                  checked={consentAccepted}
                  id="texting-consent"
                  onCheckedChange={(value) => setConsentAccepted(value === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="texting-consent">Allow agent text messages</FieldLabel>
                  <FieldDescription id="texting-consent-description">
                    I agree to receive conversational texts from nohmi and understand message/data
                    rates may apply. Consent is recorded with my account; I can reply STOP at any
                    time.
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
      </CardContent>
    </Card>
  );
}
