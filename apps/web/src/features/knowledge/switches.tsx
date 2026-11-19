import type { KnowledgeLifecycleInput, KnowledgeRecord } from "@personal-os/domain";
import { useId } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/**
 * Why Core can't change right now, or null. Turning Core off is always allowed except on a
 * disputed memory, where a revise would clear the dispute (COO-268). Turning it on is blocked for
 * sensitive and hidden memory, which never loads at session start.
 */
export function coreUnavailable(record: KnowledgeRecord) {
  if (record.status === "disputed")
    return "Confirm or edit this disputed memory first. Changing this would clear the dispute.";
  if (record.core) return null;
  if (record.sensitivity === "sensitive") return "Sensitive memories never load at session start.";
  if (record.agentAccess === "blocked")
    return "Memories hidden from agents never load at session start.";
  return null;
}

/** Owner-only switches that apply immediately, each with its own Sonner outcome. */
export function MemorySwitches({
  record,
  busy,
  act,
}: {
  record: KnowledgeRecord;
  busy: boolean;
  act: (input: KnowledgeLifecycleInput, success?: string) => void;
}) {
  const id = useId();
  const identity = () => ({
    recordId: record.id,
    expectedRevision: record.revision,
    mutationKey: crypto.randomUUID(),
  });
  // Core is revised content metadata, which a pending proposal or archived memory cannot take.
  const coreEditable = ["active", "disputed", "expired"].includes(record.status);
  const coreBlocked = coreUnavailable(record);
  return (
    <FieldGroup className="gap-3">
      {coreEditable ? (
        <Field orientation="horizontal" data-disabled={Boolean(coreBlocked)}>
          <Switch
            id={`${id}-core`}
            checked={record.core}
            disabled={busy || Boolean(coreBlocked)}
            aria-describedby={coreBlocked ? `${id}-core-blocked` : undefined}
            onCheckedChange={(core) =>
              act(
                { ...identity(), action: "revise", content: record.content, core },
                core
                  ? "Memory will load at session start."
                  : "Memory no longer loads at session start.",
              )
            }
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-core`}>Load at session start</FieldLabel>
            {coreBlocked ? (
              <FieldDescription id={`${id}-core-blocked`}>{coreBlocked}</FieldDescription>
            ) : null}
          </FieldContent>
        </Field>
      ) : null}
      <Field orientation="horizontal">
        <Switch
          id={`${id}-access`}
          checked={record.agentAccess === "allowed"}
          disabled={busy}
          onCheckedChange={(allowed) =>
            act({
              ...identity(),
              action: "set_access",
              agentAccess: allowed ? "allowed" : "blocked",
            })
          }
        />
        <FieldLabel htmlFor={`${id}-access`}>Agents can read this</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id={`${id}-sensitive`}
          checked={record.sensitivity === "sensitive"}
          disabled={busy}
          onCheckedChange={(sensitive) =>
            act({
              ...identity(),
              action: "set_sensitivity",
              sensitivity: sensitive ? "sensitive" : "standard",
            })
          }
        />
        <FieldLabel htmlFor={`${id}-sensitive`}>Sensitive memory</FieldLabel>
      </Field>
    </FieldGroup>
  );
}
