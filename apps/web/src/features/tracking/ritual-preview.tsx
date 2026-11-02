import {
  localDateAt,
  localDateToIso,
  type RitualDefinition,
  type RitualState,
  ritualDefinitionForDate,
  ritualIsAnswered,
} from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../api.js";
import { isDesktop } from "../desktop/bridge.js";
import { showRitualPreview } from "../desktop/ritual-bridge.js";
import { RitualChecklist } from "./ritual-overlay.js";

export async function makeRitualPreview(definition: RitualDefinition): Promise<RitualState> {
  const now = new Date().toISOString();
  const date = localDateToIso(localDateAt(new Date(), definition.timeZone));
  const history = await api.listRitualHistory(undefined, {
    kind: definition.kind,
    dateFrom: date,
    dateTo: date,
  });
  const today = history.items.find(
    (item) => item.definitionRevision === definition.revision && item.scheduledLocalDate === date,
  );
  return {
    definitions: [definition],
    serverNow: now,
    snoozeCount: 0,
    syncStatus: "saved",
    preview: true,
    current: {
      id: `preview-${crypto.randomUUID()}`,
      ritualId: definition.id,
      definitionRevision: definition.revision,
      scheduledLocalDate: date,
      timeZone: definition.timeZone,
      dueAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      definition: ritualDefinitionForDate(definition, date),
      revision: 1,
      status: "pending",
      snoozedUntil: null,
      settledAt: null,
      responses: today?.responses ?? [],
      actions: [],
    },
  };
}
export function RitualPreviewChecklist({
  initialState,
  onClose,
}: {
  initialState: RitualState;
  onClose: () => void;
}) {
  const [state, setState] = useState(initialState);
  const ref = useRef(state);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onClose]);
  function store(next: RitualState) {
    ref.current = next;
    setState(next);
    return next;
  }
  return (
    <RitualChecklist
      state={state}
      onPreviewDateChange={(date) => {
        const current = ref.current.current;
        if (!current || date === current.scheduledLocalDate) return;
        const definition = ref.current.definitions.find((item) => item.id === current.ritualId);
        if (!definition) return;
        store({
          ...ref.current,
          current: {
            ...current,
            scheduledLocalDate: date,
            definition: ritualDefinitionForDate(definition, date),
            responses: [],
            revision: current.revision + 1,
          },
        });
      }}
      preview
      saveResponse={async (stepId, input) => {
        const current = ref.current.current!;
        return store({
          ...ref.current,
          current: {
            ...current,
            revision: current.revision + 1,
            responses: [
              ...current.responses,
              {
                id: input.requestId,
                requestId: input.requestId,
                stepId,
                value: input.value,
                submitted: input.submitted,
                observedAt: input.observedAt,
                recordedAt: new Date().toISOString(),
              },
            ],
          },
        });
      }}
      act={async (input) => {
        if (input.kind === "complete" && !ritualIsAnswered(ref.current.current!))
          return { outcome: "conflict", state: ref.current };
        if (input.kind === "complete") {
          if (isDesktop()) await showRitualPreview(null, true);
          else {
            document.documentElement.classList.add("ritual-exiting");
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
              ),
            );
            onClose();
            document.documentElement.classList.remove("ritual-exiting");
          }
        } else onClose();
        return { outcome: "applied", state: ref.current };
      }}
    />
  );
}
export function RitualPreview({ state, onClose }: { state: RitualState; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        showCloseButton={false}
        className="ritual-fullscreen ritual-surface ritual-browser-preview translate-x-0 translate-y-0"
        data-ritual-kind={state.current?.definition.kind}
      >
        <DialogTitle className="sr-only">Ritual preview</DialogTitle>
        <DialogDescription className="sr-only">
          Preview only — answers and actions are not recorded
        </DialogDescription>
        <div className="relative flex min-h-0 w-full max-w-lg flex-col items-center justify-center justify-self-center">
          <RitualPreviewChecklist initialState={state} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
