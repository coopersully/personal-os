import { unfinishedOptionalRitualSteps } from "@personal-os/domain";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DateInput } from "@/components/date-input";
import { Field, FieldGroup, FieldLabel } from "@/components/settings-field";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { SettingsSection } from "../settings/settings-layout";

export function RitualHistory() {
  const [kind, setKind] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filters = {
    ...(kind ? { kind } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
  const history = useInfiniteQuery({
    refetchInterval: 5000,
    queryKey: ["ritual-history", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listRitualHistory(pageParam, filters),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  return (
    <section className="flex flex-col gap-4" aria-label="Ritual history">
      <SettingsSection layout="rows" title="History">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ritual-history-kind">Ritual</FieldLabel>
            <NativeSelect
              id="ritual-history-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <NativeSelectOption value="">Both rituals</NativeSelectOption>
              <NativeSelectOption value="morning">Morning</NativeSelectOption>
              <NativeSelectOption value="night">Evening</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="ritual-history-from">From</FieldLabel>
            <DateInput id="ritual-history-from" value={dateFrom} onValueChange={setDateFrom} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ritual-history-through">Through</FieldLabel>
            <DateInput id="ritual-history-through" value={dateTo} onValueChange={setDateTo} />
          </Field>
        </FieldGroup>
      </SettingsSection>
      <SettingsSection title="Entries">
        {history.isPending ? <p>Loading history…</p> : null}
        <QueryFeedback query={history} title="Couldn’t load ritual history." />
        {history.data?.pages
          .flatMap((p) => p.items)
          .map((o) => (
            <details key={o.id}>
              <summary>
                {o.definition.kind === "night" ? "Evening ritual" : "Morning ritual"} ·{" "}
                {o.scheduledLocalDate} · {o.status.replaceAll("_", " ")}
              </summary>
              <div className="flex flex-col gap-2 py-3">
                <p>
                  Due{" "}
                  {new Date(o.dueAt).toLocaleString(undefined, {
                    timeZone: o.timeZone,
                    timeZoneName: "short",
                  })}
                </p>
                {o.responses.map((r) => (
                  <p key={r.id}>
                    {o.definition.steps.find((s) => s.id === r.stepId)?.label}:{" "}
                    {typeof r.value === "boolean" ? (r.value ? "Done" : "Unchecked") : r.value}{" "}
                    {r.submitted ? "" : "(draft)"} ·{" "}
                    {new Date(r.recordedAt).toLocaleString(undefined, {
                      timeZone: o.timeZone,
                      timeZoneName: "short",
                    })}
                  </p>
                ))}
                {o.status === "completed"
                  ? unfinishedOptionalRitualSteps(o).map((step) => (
                      <p key={`optional-${step.id}`}>
                        {step.label}: Optional ·{" "}
                        {o.optionalFollowUp?.stepIds.includes(step.id)
                          ? `Reminder ${o.optionalFollowUp.reminderIds ? "scheduled" : "waiting to sync"} · ${new Date(o.optionalFollowUp.dueAt).toLocaleString(undefined, { timeZone: o.timeZone, timeZoneName: "short" })}`
                          : "Not done"}
                      </p>
                    ))
                  : null}
                {o.actions.map((a) => (
                  <p key={a.id}>
                    {a.kind.replaceAll("_", " ")} · {a.outcome} ·{" "}
                    {new Date(a.recordedAt).toLocaleString(undefined, {
                      timeZone: o.timeZone,
                      timeZoneName: "short",
                    })}
                  </p>
                ))}
              </div>
            </details>
          ))}
        {history.data?.pages[0]?.items.length === 0 ? (
          <p className="text-muted-foreground">Your ritual history will appear here.</p>
        ) : null}
        {history.hasNextPage ? (
          <Button variant="outline" onClick={() => void history.fetchNextPage()}>
            More history
          </Button>
        ) : null}
      </SettingsSection>
    </section>
  );
}
