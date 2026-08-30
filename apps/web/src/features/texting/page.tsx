import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";

export function TextingSettings() {
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
  const start = useMutation({
    mutationFn: () => api.startTextingVerification({ consentAccepted: true, country, phoneNumber }),
    onSuccess: (challenge) => setChallengeId(challenge.id),
  });
  const verify = useMutation({
    mutationFn: () => {
      if (!challengeId) throw new Error("Request a verification code first.");
      return api.checkTextingVerification(challengeId, { code });
    },
    onSuccess: async () => {
      setChallengeId(null);
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["texting-connection"] });
    },
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectTexting,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["texting-connection"] }),
  });
  const current = connection.data;
  const error = connection.error ?? start.error ?? verify.error ?? disconnect.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={1} role="heading">
          Agent texting
        </CardTitle>
        <CardDescription>
          Let authorized agents communicate with you through ilo&apos;s shared Twilio number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
        {current?.id && current.state !== "disconnected" ? (
          <div className="settings-form">
            <p>
              <strong>{current.maskedPhoneNumber}</strong> ·{" "}
              {current.state === "active"
                ? "Ready"
                : current.state === "opted_out"
                  ? "Blocked by Twilio opt-out"
                  : current.state}
            </p>
            <p>
              Messages come from {current.senderPhoneNumber ?? "ilo's shared number"}. Reply STOP to
              block texts. Only a later START reply can restore delivery after a Twilio opt-out.
            </p>
            <Button
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
              type="button"
              variant="outline"
            >
              Disconnect number
            </Button>
          </div>
        ) : challengeId ? (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              verify.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="texting-code">Verification code</FieldLabel>
              <Input
                autoComplete="one-time-code"
                id="texting-code"
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                value={code}
              />
            </Field>
            <Button disabled={verify.isPending || code.length < 4} type="submit">
              Verify and connect
            </Button>
          </form>
        ) : (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (consentAccepted) start.mutate();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="texting-country">Country</FieldLabel>
                <select
                  id="texting-country"
                  onChange={(event) => setCountry(event.target.value as "US" | "CA")}
                  value={country}
                >
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="texting-phone">Mobile number</FieldLabel>
                <Input
                  autoComplete="tel"
                  id="texting-phone"
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="(555) 555-0123"
                  type="tel"
                  value={phoneNumber}
                />
              </Field>
            </FieldGroup>
            <label className="flex items-start gap-2" htmlFor="texting-consent">
              <Checkbox
                checked={consentAccepted}
                id="texting-consent"
                onCheckedChange={(value) => setConsentAccepted(value === true)}
              />
              <span>
                I agree to receive conversational texts from ilo and understand message/data rates
                may apply. Consent is recorded with my account; I can reply STOP at any time.
              </span>
            </label>
            <Button
              disabled={
                !consentAccepted ||
                !phoneNumber ||
                start.isPending ||
                current?.providerReady === false
              }
              type="submit"
            >
              Send verification code
            </Button>
            {current?.providerReady === false ? (
              <p>Texting is not configured on this ilo deployment.</p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
