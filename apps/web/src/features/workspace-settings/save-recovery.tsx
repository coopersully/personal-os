import type { Workspace } from "@personal-os/domain";
import { type ReactNode, useId } from "react";
import { RecoveryRequest } from "@/components/recovery-request";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
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
  children,
  recoveryActions,
  toastId,
}: {
  toastId?: string | undefined;
  children?: ReactNode;
  recoveryActions?: ReactNode;
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
  const descriptionId = useId();
  return (
    <RecoveryRequest
      toastId={toastId}
      open
      title={title}
      description={
        outcome === "conflict"
          ? "Another editor changed these settings. Review the latest values before applying your change."
          : outcome === "uncertain"
            ? "The change may have been saved. Refresh checks the current values without writing."
            : "The change could not be applied. Refresh the current values before trying again."
      }
      actions={
        <div className="grid w-full min-w-0 gap-2">
          {recoveryActions}
          <ItemGroup className="grid gap-2 sm:grid-cols-2">
            <Item variant="muted" className="min-w-0 flex-col flex-nowrap items-stretch">
              <ItemContent>
                <ItemTitle>Apply your change</ItemTitle>
                <ItemDescription className="line-clamp-none" id={`${descriptionId}-apply`}>
                  Save your attempted values after reviewing the latest settings.
                </ItemDescription>
              </ItemContent>
              <ItemFooter className="basis-auto">
                <Button
                  aria-describedby={`${descriptionId}-apply`}
                  className="w-full whitespace-normal"
                  type="button"
                  variant="secondary"
                  disabled={pending || !reviewed || reapplyUnavailable}
                  onClick={onReapply}
                >
                  Reapply reviewed change
                </Button>
              </ItemFooter>
            </Item>
            <Item variant="muted" className="min-w-0 flex-col flex-nowrap items-stretch">
              <ItemContent>
                <ItemTitle>Keep saved settings</ItemTitle>
                <ItemDescription className="line-clamp-none" id={`${descriptionId}-keep`}>
                  Discard your attempted change and use the saved values.
                </ItemDescription>
              </ItemContent>
              <ItemFooter className="basis-auto">
                <Button
                  aria-describedby={`${descriptionId}-keep`}
                  className="w-full"
                  type="button"
                  disabled={pending || !reviewed}
                  onClick={onAccept}
                >
                  Use latest settings
                </Button>
              </ItemFooter>
            </Item>
          </ItemGroup>
        </div>
      }
    >
      <div className="grid min-w-0 gap-3">
        {children}
        <ItemGroup className="gap-2" aria-label={title}>
          {rows.map((row) => (
            <Item key={row.label} variant="muted">
              <ItemContent>
                <ItemTitle>{row.label}</ItemTitle>
                <p>Your change: {row.attempted}</p>
                <p className="text-muted-foreground">
                  Latest: {reviewed ? row.current : "Not loaded — refresh to review"}
                </p>
              </ItemContent>
            </Item>
          ))}
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>Review saved values first</ItemTitle>
              <ItemDescription className="line-clamp-none">
                Read the saved values without changing them.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant={reviewed ? "secondary" : "default"}
                disabled={pending}
                onClick={onRefresh}
                aria-label="Refresh latest settings"
              >
                Refresh
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </div>
    </RecoveryRequest>
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
  children,
  recoveryActions,
}: {
  workspace: W;
  children?: ReactNode;
  recoveryActions?: ReactNode;
  formatValue?: (value: unknown, key: string) => string;
  unavailable?: boolean;
}) {
  const query = useWorkspacePreferences(workspace);
  const save = useSaveWorkspacePreferences(workspace);
  if (!save.recovery) return null;
  return (
    <SettingsSaveRecovery
      toastId={save.recovery.toastId}
      recoveryActions={recoveryActions}
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
    >
      {children}
    </SettingsSaveRecovery>
  );
}
