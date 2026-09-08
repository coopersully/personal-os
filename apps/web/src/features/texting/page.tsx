import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api.js";
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
          Let authorized agents text you through nohmi’s shared number.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        {current?.id && current.state !== "disconnected" ? (
          <FieldGroup>
            <p>
              <strong>{current.maskedPhoneNumber}</strong> ·{" "}
              {current.state === "active"
                ? "Ready"
                : current.state === "opted_out"
                  ? "Blocked by Twilio opt-out"
                  : current.state}
            </p>
            <FieldDescription>
              Messages come from {current.senderPhoneNumber ?? "nohmi’s shared number"}. Reply STOP
              to block texts. Only a later START reply can restore delivery after a Twilio opt-out.
            </FieldDescription>
            <Field orientation="horizontal">
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
          <form
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
                  inputMode="numeric"
                  onChange={(event) => setCode(event.target.value)}
                  value={code}
                />
              </Field>
              <Field orientation="horizontal">
                <Button disabled={verify.isPending || code.length < 4} type="submit">
                  Verify and connect
                </Button>
              </Field>
            </FieldGroup>
          </form>
        ) : (
          <form
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
              <Field orientation="horizontal">
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
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
