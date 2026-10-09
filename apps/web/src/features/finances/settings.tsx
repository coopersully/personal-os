import type { FinanceGuidedSetupContext } from "@personal-os/domain";
import { Spinner } from "@personal-os/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { api } from "../../api.js";
import { InlineError, QueryFeedback } from "../../components/async-state.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceNotificationPreferences } from "../notifications/finance-preferences";
import { FinanceConfigurationEditor } from "./configuration-editor.js";

const financeHumanOnlyActionLabels = {
  add_manual_transaction: "add manual transactions",
  apply_categorization: "apply category decisions",
  confirm_ambiguous_transfer: "confirm ambiguous transfers",
  connect_or_disconnect_source: "connect or disconnect sources",
  create_merchant_rule: "create permanent merchant rules",
  import_transactions: "import transactions",
  manage_accounts: "manage accounts",
  manage_budgets: "manage budgets",
  manage_financial_profile: "manage the financial profile",
  manage_merchants: "rename or merge merchants",
  refresh_provider_data: "refresh provider data",
  resolve_alert: "resolve or dismiss alerts",
  review_recurring_obligation: "change recurring-obligation review state",
} satisfies Record<FinanceGuidedSetupContext["humanOnlyActions"][number], string>;

export function FinanceSettings() {
  const queryClient = useQueryClient();
  const setup = useQuery({
    queryFn: api.getFinanceGuidedSetup,
    queryKey: ["finance-guided-setup"],
  });
  const agentProfile = useQuery({
    queryFn: () => api.getDomainProfile("finances"),
    queryKey: ["domain-profile", "finances"],
  });
  const activate = useFeedbackMutation({
    feedback: { action: "activate financial planning", safeToRetry: false, form: false },
    mutationFn: async () => {
      const current = agentProfile.data;
      if (!current) throw new Error("No Finance guidance draft is available to activate.");
      return api.upsertDomainProfile({
        categories: current.categories,
        domain: "finances",
        expectedVersion: current.version,
        instructions: current.instructions,
        objective: current.objective,
        preferences: current.preferences,
        sourceContexts: current.sourceContexts,
        status: "active",
        summary: current.summary,
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domain-profile", "finances"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-guided-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["finances", "guided-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["ilo-setup-plan", "finances"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-setup-status"] }),
      ]),
  });
  return (
    <div className="agent-access" id="guidance">
      <FinanceConfigurationEditor />
      <FinanceNotificationPreferences />
      <QueryFeedback query={setup} title="Couldn’t load finance setup." />
      <QueryFeedback query={agentProfile} title="Couldn’t load finance guidance." />
      <MutationFeedback feedback={activate.feedback} />
      <FinanceAgentGuidancePanel
        activating={activate.isPending}
        activationEligible={
          agentProfile.data?.status === "draft" && agentProfile.data.sourceContexts.length > 0
        }
        error={null}
        loading={setup.isPending || agentProfile.isPending}
        onActivate={() => activate.mutate()}
        profileStatus={agentProfile.data?.status ?? null}
        setup={setup.data}
      />
    </div>
  );
}

function FinanceAgentGuidancePanel({
  activating,
  activationEligible,
  error,
  loading,
  onActivate,
  profileStatus,
  setup,
}: {
  activating: boolean;
  activationEligible: boolean;
  error: Error | null;
  loading: boolean;
  onActivate: () => void;
  profileStatus: "active" | "draft" | null;
  setup: FinanceGuidedSetupContext | undefined;
}) {
  const approvedProfile = setup?.guidance.approvedProfile ?? null;
  const draftProposal = setup?.guidance.draftProposal ?? null;
  const guidanceStatus =
    approvedProfile && draftProposal
      ? "Active + draft"
      : approvedProfile
        ? "Active"
        : draftProposal || profileStatus === "draft"
          ? "Draft"
          : "Not configured";
  const availableWorkflows =
    setup?.suggestedWorkflows.filter((workflow) => workflow.available).length ?? 0;
  const humanOnlyActionLabels =
    setup?.humanOnlyActions
      .map((action) => financeHumanOnlyActionLabels[action])
      .filter((label): label is string => Boolean(label)) ?? [];
  const monthlyReviewGuidance =
    draftProposal?.preferences.monthly_review === true ||
    approvedProfile?.preferences.monthly_review === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent guidance</CardTitle>
        <CardDescription>
          Durable source meanings, review preferences, terminology, thresholds, and safety
          constraints for Claude, Codex, and other scoped hosts.
        </CardDescription>
        <CardAction>
          <Badge variant={approvedProfile ? "default" : "secondary"}>{guidanceStatus}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? <Spinner label="Loading Finance agent guidance" /> : null}
        {error ? <InlineError error={error} /> : null}
        {setup ? (
          <ItemGroup>
            <Item size="sm" variant="secondary">
              <ItemContent>
                <ItemTitle>Sources ready</ItemTitle>
                <ItemDescription>
                  {setup.accountSources.length} account
                  {setup.accountSources.length === 1 ? "" : "s"} available for a short,
                  example-based interview.
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item size="sm" variant="secondary">
              <ItemContent>
                <ItemTitle>Suggested workflows</ItemTitle>
                <ItemDescription>{availableWorkflows} available now.</ItemDescription>
              </ItemContent>
            </Item>
            <Item size="sm" variant="secondary">
              <ItemContent>
                <ItemTitle>Portal controls</ItemTitle>
                <ItemDescription>
                  {humanOnlyActionLabels.length > 0
                    ? `You can ${humanOnlyActionLabels.join(", ")} directly in Finance.`
                    : "Manage your financial records and decisions directly in Finance."}
                </ItemDescription>
              </ItemContent>
            </Item>
            {monthlyReviewGuidance ? (
              <Item size="sm" variant="secondary">
                <ItemContent>
                  <ItemTitle>Monthly review guidance</ItemTitle>
                  <ItemDescription>
                    This preference guides agent behavior. No recurring schedule has been created.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : null}
            {approvedProfile ? (
              <Item size="sm" variant="secondary">
                <ItemContent>
                  <ItemTitle>Active approved guidance</ItemTitle>
                  <ItemDescription>
                    This approved snapshot remains operative
                    {draftProposal ? " while the pending draft is reviewed." : "."}
                  </ItemDescription>
                  <FinanceGuidanceDetails
                    legend="Active approved Finance guidance contents"
                    profile={approvedProfile}
                  />
                </ItemContent>
              </Item>
            ) : null}
            {draftProposal || profileStatus === "draft" ? (
              <Item size="sm" variant="secondary">
                <ItemContent>
                  <ItemTitle>Draft activation</ItemTitle>
                  <ItemDescription>
                    {activationEligible
                      ? "Review the recorded source meanings, thresholds, terminology, and safety constraints before activating this guidance."
                      : "Add at least one owned account source to the draft before activation."}
                  </ItemDescription>
                  {draftProposal ? (
                    <FinanceGuidanceDetails
                      legend="Finance guidance draft contents"
                      profile={draftProposal}
                    />
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Button
                    disabled={!activationEligible || activating}
                    onClick={onActivate}
                    size="sm"
                  >
                    {activating ? "Activating…" : "Activate guidance"}
                  </Button>
                </ItemActions>
              </Item>
            ) : null}
          </ItemGroup>
        ) : null}
      </CardContent>
    </Card>
  );
}

function withOccurrenceKeys(values: string[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1;
    occurrences.set(value, occurrence);
    return { key: `${value}:${occurrence}`, value };
  });
}

function FinanceGuidanceDetails({
  legend,
  profile,
}: {
  legend: string;
  profile: NonNullable<FinanceGuidedSetupContext["guidance"]["approvedProfile"]>;
}) {
  return (
    <fieldset className="mt-3 grid gap-3 text-sm">
      <legend className="sr-only">{legend}</legend>
      <div>
        <p className="font-medium">Objective</p>
        <p className="text-muted-foreground">{profile.objective}</p>
      </div>
      <div>
        <p className="font-medium">Summary</p>
        <p className="text-muted-foreground">{profile.summary}</p>
      </div>
      <div>
        <p className="font-medium">Safety and operating instructions</p>
        {profile.instructions.length > 0 ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {withOccurrenceKeys(profile.instructions).map(({ key, value }) => (
              <li key={key}>{value}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </div>
      <div>
        <p className="font-medium">Account meanings</p>
        {profile.sourceContexts.length > 0 ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {profile.sourceContexts.map((source) => (
              <li key={source.sourceId}>
                {source.sourceLabel} — {source.purpose}
                {source.notes ? ` — ${source.notes}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </div>
      <div>
        <p className="font-medium">Categories</p>
        <p className="text-muted-foreground">
          {profile.categories.length > 0
            ? profile.categories
                .map((category) => `${category.label}: ${category.description}`)
                .join("; ")
            : "None recorded."}
        </p>
      </div>
      <div>
        <p className="font-medium">Preferences</p>
        <p className="text-muted-foreground">
          {Object.keys(profile.preferences).length > 0
            ? Object.entries(profile.preferences)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join("; ")
            : "None recorded."}
        </p>
      </div>
    </fieldset>
  );
}
