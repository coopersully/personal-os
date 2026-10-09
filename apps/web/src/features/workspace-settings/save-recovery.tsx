import type { Workspace } from "@personal-os/domain";
import { Button } from "@/components/ui/button";
import { useSaveWorkspacePreferences, useWorkspacePreferences } from "./preferences";

/** Domain-owned callers supply reviewed values and exact-revision reapply actions. */
export function SettingsSaveRecovery({
  title,
  outcome,
  rows,
  reviewed,
  pending,
  reapplyUnavailable = false,
  onRefresh,
  onAccept,
  onReapply,
}: {
  title: string;
  outcome: "conflict" | "uncertain" | "rejected";
  rows: Array<{ label: string; attempted: string; current?: string }>;
  reviewed: boolean;
  pending: boolean;
  reapplyUnavailable?: boolean;
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
        <Button
          type="button"
          disabled={pending || !reviewed || reapplyUnavailable}
          onClick={onReapply}
        >
          Reapply reviewed change
        </Button>
      </div>
    </fieldset>
  );
}

const preferenceNames: Record<string, string> = {
  calendarView: "Preferred view",
  weekStartsOn: "Week starts on",
  defaultEventDurationMinutes: "Default event duration (minutes)",
  autoFollowToday: "Automatically follow today",
  snapToFollow: "Snap back to Follow",
  followSnapSensitivity: "Follow snap sensitivity",
  showWeekends: "Show weekends",
  mailConversationLayout: "Conversation layout",
  mailListDensity: "Conversation density",
  mailListWidth: "Conversation list width (%)",
  taskSort: "Sort by",
  taskGroup: "Group by",
  taskContainerSort: "List and project sorting",
  taskRowDetails: "Row details",
  pinnedListIds: "Pinned lists",
  pinnedProjectIds: "Pinned projects",
  defaultCaptureListId: "Default capture list",
  showCompletedTasks: "Show completed tasks",
  financeTransactionView: "Transaction view",
  financeTransactionGroup: "Group cards by",
  spendAccountIds: "Accounts included in spending",
  cashAccountIds: "Accounts included in cash",
  investmentAccountIds: "Accounts included in investments",
  includeArchivedInSearch: "Include completed and archived items in search",
};
export function preferenceValueLabel(value: unknown, key: string): string {
  if (value === null)
    return key === "defaultCaptureListId"
      ? "Inbox (product default)"
      : "All eligible accounts (including newly added accounts)";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None selected";
  const names: Record<string, string> = {
    auto: "Automatic (day on phone, week on desktop)",
    split: "Split view",
    single: "Full-width view",
    reserved: "Reserved time",
    default: "Recommended",
    updated: "Recently updated",
    name: "Name A–Z",
    newest: "Newest first",
    oldest: "Oldest first",
    title: "Title A–Z",
    estimate: "Shortest estimate",
  };
  return names[String(value)] ?? String(value ?? "Unavailable").replaceAll("_", " ");
}

/** All callers share the same account/session/workspace transient intent, including across navigation. */
export function WorkspacePreferenceRecovery<W extends Workspace>({
  workspace,
  formatValue = preferenceValueLabel,
  unavailable = false,
}: {
  workspace: W;
  formatValue?: (value: unknown, key: string) => string;
  unavailable?: boolean;
}) {
  const query = useWorkspacePreferences(workspace);
  const save = useSaveWorkspacePreferences(workspace);
  if (!save.recovery) return null;
  return (
    <SettingsSaveRecovery
      outcome={save.recovery.outcome}
      title="Workspace preference change has not been confirmed."
      pending={query.isFetching || save.isWorkspacePending}
      reapplyUnavailable={unavailable}
      reviewed={!!save.recovery.reviewed}
      rows={Object.entries(save.recovery.attempted).map(([key, value]) => ({
        label: preferenceNames[key] ?? "Workspace preference",
        attempted: formatValue(value, key),
        current: formatValue(
          (save.recovery?.reviewed?.preferences as Record<string, unknown> | undefined)?.[key],
          key,
        ),
      }))}
      onRefresh={() => void save.refreshRecovery()}
      onAccept={save.acceptLatest}
      onReapply={save.reapplyReviewed}
    />
  );
}
