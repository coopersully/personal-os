import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function FinanceConversationComposer({
  text,
  onChange,
  onSubmit,
  disabled,
  pending,
  label = "Message",
}: {
  text: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  pending: boolean;
  label?: string;
}) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() && !disabled && !pending) onSubmit();
      }}
    >
      <Field>
        <FieldLabel htmlFor="finance-conversation-draft">{label}</FieldLabel>
        <Textarea
          id="finance-conversation-draft"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          maxLength={10000}
          disabled={pending}
          aria-describedby="finance-conversation-timing"
        />
      </Field>
      <p id="finance-conversation-timing" className="text-sm text-muted-foreground">
        Messages wait for the next eligible automation run. Response time is unknown.
      </p>
      <Button
        type="submit"
        className="justify-self-start"
        disabled={disabled || pending || !text.trim()}
      >
        {pending ? "Saving…" : label === "Message" ? "Send message" : "Save answer"}
      </Button>
    </form>
  );
}
