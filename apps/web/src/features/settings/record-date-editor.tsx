import { format, parseISO } from "date-fns";
import { useState } from "react";
import { CalendarIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function RecordDateEditor({
  value,
  pending,
  onSave,
}: {
  value: string;
  pending: boolean;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const save = async (next: string) => {
    if (saving || pending) return;
    if (next === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
    } catch {
      /* Mutation reports errors through Sonner. */
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          disabled={pending || saving}
          aria-label="Edit Target date"
        >
          <CalendarIcon aria-hidden="true" />
          {selected ? format(selected, "MMM d, yyyy") : "Not set"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Calendar
          mode="single"
          selected={selected}
          {...(selected ? { defaultMonth: selected } : {})}
          captionLayout="dropdown"
          endMonth={new Date(new Date().getFullYear() + 100, 11)}
          autoFocus
          disabled={pending || saving}
          onSelect={(date) => {
            if (date) void save(format(date, "yyyy-MM-dd"));
          }}
        />
        {value ? (
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={pending || saving}
            onClick={() => {
              void save("");
            }}
          >
            Clear date
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
