import {
  calendarProfilePreferencesSchema,
  type DomainProfile,
  mailProfilePreferencesSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QueryFeedback } from "@/components/async-state";
import { FeedbackForm } from "@/components/feedback-form";
import { MutationFeedback } from "@/components/mutation-feedback";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { api } from "../../api.js";
import { CalendarProfilePreferenceFields } from "../calendar/profile-preference-fields";
import { MailProfilePreferenceFields } from "../mail/profile-preference-fields";
import { SettingsSection } from "./settings-layout";

export function WorkspaceGuidance({ domain }: { domain: "calendar" | "mail" | "tasks" }) {
  const query = useQuery({
    queryKey: ["domain-profile", domain],
    queryFn: () => api.getDomainProfile(domain),
  });
  return (
    <SettingsSection
      title="Preferences & guidance"
      description="Describe how this workspace should support you."
    >
      <QueryFeedback query={query} title="Couldn’t load workspace guidance." />
      {query.isPending ? (
        <p>Loading guidance…</p>
      ) : query.data ? (
        <GuidanceForm key={domain} profile={query.data} />
      ) : query.isSuccess ? (
        <p className="text-sm text-muted-foreground">
          No guidance has been configured yet. Use the setup section below to establish your
          preferences.
        </p>
      ) : null}
    </SettingsSection>
  );
}

function GuidanceForm({ profile }: { profile: DomainProfile }) {
  const cache = useQueryClient();
  // Retain the edited snapshot and its version through refreshes; server conflicts preserve the draft.
  const [baseline, setBaseline] = useState(profile);
  const [preferences, setPreferences] = useState(profile.preferences);
  const [objective, setObjective] = useState(profile.objective);
  const [instructions, setInstructions] = useState(profile.instructions.join("\n"));
  const save = useFeedbackMutation({
    feedback: { action: "save workspace guidance", safeToRetry: false, form: true },
    mutationFn: () =>
      api.upsertDomainProfile({
        domain: baseline.domain,
        expectedVersion: baseline.version,
        objective: objective.trim(),
        instructions: instructions
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        categories: baseline.categories,
        preferences:
          baseline.domain === "mail"
            ? mailProfilePreferencesSchema.parse(preferences)
            : baseline.domain === "calendar"
              ? validateCalendarPreferences(preferences, baseline.status)
              : preferences,
        sourceContexts: baseline.sourceContexts,
        status: baseline.status,
        summary: baseline.summary,
      }),
    onSuccess: async (next) => {
      setBaseline(next);
      setPreferences(next.preferences);
      setObjective(next.objective);
      setInstructions(next.instructions.join("\n"));
      cache.setQueryData(["domain-profile", next.domain], next);
      await cache.invalidateQueries({ queryKey: ["assistant-setup-status"] });
      if (next.domain === "calendar")
        await cache.invalidateQueries({ queryKey: ["calendar-status"] });
      await cache.invalidateQueries({ queryKey: ["ilo-setup-plan", next.domain] });
    },
  });
  const reload = useFeedbackMutation({
    feedback: { action: "reload workspace guidance", safeToRetry: true, form: false },
    mutationFn: () => api.getDomainProfile(profile.domain),
    onSuccess: (latest) => {
      if (!latest) return;
      setBaseline(latest);
      setPreferences(latest.preferences);
      setObjective(latest.objective);
      setInstructions(latest.instructions.join("\n"));
      cache.setQueryData(["domain-profile", profile.domain], latest);
      save.reset();
    },
  });
  const dirty =
    objective !== baseline.objective ||
    instructions !== baseline.instructions.join("\n") ||
    JSON.stringify(preferences) !== JSON.stringify(baseline.preferences);
  return (
    <FeedbackForm
      feedback={save.feedback}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      {profile.domain === "mail" ? (
        <MailProfilePreferenceFields
          preferences={preferences}
          onChange={setPreferences}
          disabled={save.isPending}
        />
      ) : null}
      {profile.domain === "calendar" ? (
        <CalendarProfilePreferenceFields
          draft={baseline.status === "draft"}
          sourceIds={baseline.sourceContexts.map((source) => source.sourceId)}
          preferences={preferences}
          onChange={setPreferences}
          disabled={save.isPending}
        />
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${profile.domain}-objective`}>Objective</FieldLabel>
        <Input
          id={`${profile.domain}-objective`}
          name="objective"
          required
          maxLength={1000}
          disabled={save.isPending}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${profile.domain}-instructions`}>Guidance</FieldLabel>
        <Textarea
          id={`${profile.domain}-instructions`}
          name="instructions"
          disabled={save.isPending}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <FieldDescription>
          One instruction per line. Guidance does not grant permissions or activate rules.
        </FieldDescription>
      </Field>
      {save.isError ? (
        <>
          <MutationFeedback feedback={reload.feedback} />
          <Button
            type="button"
            variant="secondary"
            disabled={reload.isPending}
            onClick={() => reload.mutate()}
          >
            Discard draft and reload
          </Button>
        </>
      ) : null}
      <Button type="submit" disabled={!dirty || save.isPending}>
        {save.isPending ? "Saving…" : "Save guidance"}
      </Button>
    </FeedbackForm>
  );
}

function validateCalendarPreferences(
  preferences: DomainProfile["preferences"],
  status: DomainProfile["status"],
) {
  // Drafts can be incomplete; validation must not fill missing authority or strip hidden fields.
  (status === "draft"
    ? calendarProfilePreferencesSchema.partial()
    : calendarProfilePreferencesSchema
  ).parse(preferences);
  return preferences;
}
