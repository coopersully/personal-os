import { Button } from "../../components/ui/button.js";
import { RitualClouds } from "./ritual-clouds.js";

/** The miniature is one preview action; its content and footer are decorative placeholders. */
export function RitualSkyPreview({
  kind,
  disabled,
  onPreview,
}: {
  kind: "morning" | "night";
  disabled: boolean;
  onPreview: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="ritual-sky-preview"
      aria-label={`Preview ${kind === "morning" ? "Morning" : "Evening"} Ritual`}
      disabled={disabled}
      onClick={onPreview}
    >
      <span className="ritual-sky-preview__scene" data-ritual-kind={kind} aria-hidden="true">
        <span className="ritual-glow" data-ritual-kind={kind} />
        <RitualClouds kind={kind} />
        <span className="ritual-sky-preview__card relative flex h-3/4 w-2/5 flex-col gap-1 rounded-md bg-card p-1.5">
          <span className="h-1.5 w-full rounded-sm bg-muted" />
          <span className="h-1.5 w-3/4 rounded-sm bg-muted" />
          <span className="mt-auto h-2 w-full rounded-full bg-primary" />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="ritual-sky-preview__action rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
      >
        Preview
      </span>
    </Button>
  );
}
