import { Button } from "@/components/ui/button";

/** Domain-owned callers supply reviewed values and exact-revision reapply actions. */
export function SettingsSaveRecovery({
  title,
  outcome,
  rows,
  reviewed,
  pending,
  onRefresh,
  onAccept,
  onReapply,
}: {
  title: string;
  outcome: "conflict" | "uncertain" | "rejected";
  rows: Array<{ label: string; attempted: string; current?: string }>;
  reviewed: boolean;
  pending: boolean;
  onRefresh: () => void;
  onAccept: () => void;
  onReapply: () => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3" aria-label={title}>
      <p>{title} Review the latest settings before applying your change.</p>
      <p className="text-sm text-muted-foreground">
        {outcome === "conflict"
          ? "Another editor changed these settings. Your attempted change was rejected."
          : outcome === "uncertain"
            ? "The change may have been saved. Refresh checks the current values without writing."
            : "The change could not be applied. Refresh the current values before trying again."}
      </p>
      <dl className="text-sm">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="font-medium">{row.label}</dt>
            <dd>Your change: {row.attempted}</dd>
            <dd>Latest: {reviewed ? row.current : "Not loaded — refresh to review"}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={pending} onClick={onRefresh}>
          Refresh latest settings
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !reviewed}
          onClick={onAccept}
        >
          Use latest settings
        </Button>
        <Button type="button" disabled={pending || !reviewed} onClick={onReapply}>
          Reapply reviewed change
        </Button>
      </div>
    </fieldset>
  );
}
