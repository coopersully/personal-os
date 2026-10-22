import { useId, useState } from "react";
import { InputGroup, InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group";

/** Inline record editing: unchanged blur is silent; failed saves retain the draft. */
export function RecordTextEditor({ label, value, onSave, multiline = false, required = false, pending = false }: {
  label: string; value: string; onSave: (value: string) => Promise<unknown>;
  multiline?: boolean; required?: boolean; pending?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const invalid = required && draft !== null && !draft.trim();
  const commit = async () => {
    if (draft === null || invalid || saving) return;
    const next = draft.trim();
    if (next === value) { setDraft(null); return; }
    setSaving(true);
    try { await onSave(next); setDraft(null); } catch { /* Mutation owns Sonner feedback; retain draft. */ }
    finally { setSaving(false); }
  };
  if (draft === null) return (
    <button type="button" aria-label={`Edit ${label}`} disabled={pending}
      className="block max-w-full rounded-md text-left whitespace-pre-wrap hover:bg-muted/50 focus-visible:border-foreground/50"
      onClick={() => setDraft(value)}>
      {value || <span className="text-muted-foreground">Not set</span>}
    </button>
  );
  const props = {
    id, "aria-label": label, "aria-invalid": invalid, autoFocus: true,
    value: draft, disabled: saving || pending,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => { void commit(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); }
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
    },
  };
  return <span className="settings-panel record-inline-editor">
    <InputGroup className="settings-value-input">
      {multiline ? <InputGroupTextarea {...props} className="min-h-24 max-h-48 overflow-y-auto" /> : <InputGroupInput {...props} />}
    </InputGroup>
    {invalid ? <span className="block text-xs text-destructive">Enter a {label.toLowerCase()}.</span> : null}
  </span>;
}
