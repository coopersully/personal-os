import { useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";

export function GoalProgressEditor({ value, pending, onSave }: { value: number; pending: boolean; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && (draft.trim() === "" || !Number.isInteger(Number(draft)) || Number(draft) < 0 || Number(draft) > 100);
  return (
    <div className="settings-panel">
      <div className="space-y-1">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <label htmlFor="goal-progress-value" className="settings-detail-heading">Progress</label>
        <InputGroup className="settings-value-input">
          <InputGroupInput id="goal-progress-value" type="number" min={0} max={100} step={1} disabled={pending} value={draft ?? value} aria-invalid={invalid} aria-describedby={invalid ? "goal-progress-help" : undefined}
            onFocus={(event) => { setDraft(String(value)); event.target.select(); }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (invalid) return; if (draft !== null && Number(draft) !== value) onSave(Number(draft)); setDraft(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); } }} />
          <InputGroupAddon align="inline-end"><span>%</span></InputGroupAddon>
        </InputGroup>
      </div>
      <Progress value={value} aria-label="Goal progress" />
      </div>
      {invalid ? <p id="goal-progress-help" className="text-xs text-destructive">Enter a whole number from 0 to 100.</p> : null}
    </div>
  );
}
