import {
  type DomainProfile,
  type MailProfilePreferences,
  mailProfilePreferencesSchema,
} from "@personal-os/domain";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function MailProfilePreferenceFields({
  preferences,
  onChange,
  disabled,
}: {
  preferences: DomainProfile["preferences"];
  onChange: (preferences: DomainProfile["preferences"]) => void;
  disabled: boolean;
}) {
  // Defaults cover older profiles; keep all unrelated profile preferences in each edit.
  const values = {
    ...mailProfilePreferencesSchema.parse({}),
    ...preferences,
  } as MailProfilePreferences;
  const change = (
    patch: Partial<
      Pick<
        MailProfilePreferences,
        "inboxStyle" | "importantEmailHandling" | "noiseDisposition" | "noiseRetentionDays"
      >
    >,
  ) => onChange({ ...preferences, ...patch });
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="mail-inbox-style">Inbox style</FieldLabel>
        <NativeSelect
          id="mail-inbox-style"
          name="preferences.inboxStyle"
          disabled={disabled}
          value={values.inboxStyle}
          onChange={(event) =>
            change({ inboxStyle: event.target.value as MailProfilePreferences["inboxStyle"] })
          }
        >
          <NativeSelectOption value="signal_only">Signal only</NativeSelectOption>
          <NativeSelectOption value="balanced">Balanced</NativeSelectOption>
          <NativeSelectOption value="conservative">Conservative</NativeSelectOption>
          <NativeSelectOption value="custom">Custom</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="mail-important-email-handling">Important email handling</FieldLabel>
        <NativeSelect
          id="mail-important-email-handling"
          name="preferences.importantEmailHandling"
          disabled={disabled}
          value={values.importantEmailHandling}
          onChange={(event) =>
            change({
              importantEmailHandling: event.target
                .value as MailProfilePreferences["importantEmailHandling"],
            })
          }
        >
          <NativeSelectOption value="inbox_only">Keep in inbox</NativeSelectOption>
          <NativeSelectOption value="inbox_and_attention">
            Keep in inbox and flag for attention
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="mail-noise-disposition">Low-priority email handling</FieldLabel>
        <NativeSelect
          id="mail-noise-disposition"
          name="preferences.noiseDisposition"
          disabled={disabled}
          value={values.noiseDisposition}
          onChange={(event) => {
            const noiseDisposition = event.target
              .value as MailProfilePreferences["noiseDisposition"];
            change({
              noiseDisposition,
              noiseRetentionDays:
                noiseDisposition === "review_only" ? null : (values.noiseRetentionDays ?? 30),
            });
          }}
        >
          <NativeSelectOption value="review_only">Review only</NativeSelectOption>
          <NativeSelectOption value="archive_after_days">
            Archive after a waiting period
          </NativeSelectOption>
          <NativeSelectOption value="trash_after_days">
            Move to trash after a waiting period
          </NativeSelectOption>
        </NativeSelect>
        <FieldDescription>
          These preferences guide Mail setup. Archiving and trashing still require approved rules.
        </FieldDescription>
      </Field>
      {values.noiseDisposition !== "review_only" ? (
        <Field>
          <FieldLabel htmlFor="mail-noise-retention-days">
            Low-priority email waiting period (days)
          </FieldLabel>
          <Input
            id="mail-noise-retention-days"
            name="preferences.noiseRetentionDays"
            type="number"
            required
            min={1}
            max={365}
            step={1}
            disabled={disabled}
            value={values.noiseRetentionDays ?? ""}
            onChange={(event) =>
              change({
                noiseRetentionDays: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </Field>
      ) : null}
    </FieldGroup>
  );
}
