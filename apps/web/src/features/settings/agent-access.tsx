import type {
  AccessScope,
  AssistantSetupPlan,
  MailRulePreview,
  MailSetupAccount,
} from "@personal-os/domain";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ApprovalHandIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClipboardIcon,
  ErrorIcon,
  ExternalLinkIcon,
  KeyIcon,
  PlugIcon,
  ShieldCheckIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import { api, errorMessage } from "../../api.js";
import { ReadinessPanel } from "../../components/readiness-panel.js";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../../components/ui/input-group.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../../components/ui/item.js";
import { Textarea } from "../../components/ui/textarea.js";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group.js";
import { WorkspaceIcon } from "../../components/workspace-identity.js";
import {
  type ConnectedHostAuthority,
  type DomainCapability,
  type DomainReadinessItem,
  type DomainSupport,
  type Loadable,
  mapLoadable,
  type SetupDomain,
  setupDomainLabels,
  setupDomainOptions,
} from "../agent-access/readiness.js";
import {
  calendarAgentAccessCapability,
  calendarAgentAccessReadiness,
} from "../calendar/agent-access.js";
import {
  financeAgentAccessCapability,
  financeAgentAccessReadiness,
} from "../finances/agent-access.js";
import { mailAgentAccessCapability, mailAgentAccessReadiness } from "../mail/agent-access.js";
import { taskAgentAccessCapability, taskAgentAccessReadiness } from "../tasks/agent-access.js";

const scopeLabels: Record<AccessScope, string> = {
  "audit:read": "Read activity",
  "automations:read": "Read daily brief",
  "automations:write": "Legacy automation access (inactive)",
  "bookmarks:read": "Read X bookmarks",
  "calendar:read": "Read calendar",
  "calendar:write": "Manage calendar",
  "finances:read": "Read sensitive financial accounts and activity",
  "finances:write": "Save Finance guidance drafts",
  "goals:read": "Read goals & motives",
  "goals:write": "Manage goals & motives",
  "mail:read": "Read mail",
  "mail:write": "Manage mail",
  "reminders:read": "Read reminders",
  "reminders:write": "Manage reminders",
  "tasks:read": "Read tasks",
  "tasks:write": "Manage tasks",
};

const defaultTokenScopes: AccessScope[] = ["mail:read", "mail:write"];
const selectableScopes = (Object.keys(scopeLabels) as AccessScope[]).filter(
  (scope) => scope !== "automations:write",
);
const tokenPresets: Array<{ description: string; name: string; scopes: AccessScope[] }> = [
  {
    description: "Learn your inbox preferences, preview rules, and run approved Mail rules.",
    name: "Mail setup",
    scopes: defaultTokenScopes,
  },
  {
    description: "Plan, create, and complete your day.",
    name: "Calendar & planning",
    scopes: [
      "calendar:read",
      "calendar:write",
      "reminders:read",
      "reminders:write",
      "tasks:read",
      "tasks:write",
      "automations:read",
    ],
  },
  {
    description: "Read your agenda, mail, and generated daily brief without changing them.",
    name: "Daily brief",
    scopes: ["calendar:read", "reminders:read", "mail:read", "automations:read"],
  },
  {
    description: "Create, manage, and audit all supported Ilo material.",
    name: "Full Ilo",
    scopes: [
      "calendar:read",
      "calendar:write",
      "reminders:read",
      "reminders:write",
      "tasks:read",
      "tasks:write",
      "mail:read",
      "mail:write",
      "finances:read",
      "finances:write",
      "goals:read",
      "goals:write",
      "automations:read",
      "audit:read",
      "bookmarks:read",
    ],
  },
];

export function ConnectedAgentsSettings() {
  return <AgentAccessSettings view="connections" />;
}

export function WorkspaceAccessSettings() {
  return <AgentAccessSettings view="access" />;
}

export function WorkspaceSettings({ domain }: { domain: SetupDomain }) {
  return <AgentAccessSettings domain={domain} view="workspaces" />;
}

export type WorkspaceSettingsActions = Partial<Record<SetupDomain, boolean>>;

export function workspaceSetupNeedsPersonAction(plan: AssistantSetupPlan | undefined): boolean {
  if (!plan || plan.status === "complete") return false;
  return plan.steps.find((step) => step.id === plan.currentStepId)?.owner === "person";
}

export function useWorkspaceSettingsActions(enabled: boolean): WorkspaceSettingsActions {
  const results = useQueries({
    queries: setupDomainOptions.map(({ domain }) => ({
      enabled,
      queryFn: () => api.getIloSetup({ domain }),
      queryKey: ["ilo-setup-plan", domain],
      refetchInterval: 60_000,
      staleTime: 30_000,
    })),
  });

  return Object.fromEntries(
    setupDomainOptions.map(({ domain }, index) => [
      domain,
      workspaceSetupNeedsPersonAction(results[index]?.data),
    ]),
  ) as WorkspaceSettingsActions;
}

function AgentAccessSettings({
  domain,
  view,
}: {
  domain?: SetupDomain;
  view: "access" | "connections" | "workspaces";
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [oauthClientToRevoke, setOauthClientToRevoke] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const requestedWorkspace = searchParams.get("workspace");
  const selectedDomain: SetupDomain =
    domain ??
    (setupDomainOptions.some((option) => option.domain === requestedWorkspace)
      ? (requestedWorkspace as SetupDomain)
      : "mail");
  const reviewRuleId = searchParams.get("reviewRule");

  function updateSearchParam(name: string, value: string | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null) next.delete(name);
      else next.set(name, value);
      return next;
    });
  }
  const guide = useQuery({
    queryFn: api.getAgentConnectionGuide,
    queryKey: ["agent-connection-guide"],
  });
  const selectedGuide = guide.data?.domains.find((item) => item.domain === selectedDomain);
  const selectedDomainEnabled =
    guide.isSuccess && selectedGuide !== undefined && selectedGuide.support !== "unsupported";
  const setup = useQuery({
    enabled: view === "workspaces",
    queryFn: api.getAssistantSetupStatus,
    queryKey: ["assistant-setup-status"],
  });
  const setupPlan = useQuery({
    enabled: view === "workspaces" && selectedDomainEnabled,
    queryFn: () => api.getIloSetup({ domain: selectedDomain }),
    queryKey: ["ilo-setup-plan", selectedDomain],
    refetchInterval: 10_000,
  });
  const mailSetup = useQuery({
    enabled: view === "workspaces" && selectedDomain === "mail" && selectedDomainEnabled,
    queryFn: api.getMailSetupContext,
    queryKey: ["mail-setup-context"],
  });
  const rules = useQuery({
    enabled: view === "workspaces" && selectedDomain === "mail" && selectedDomainEnabled,
    queryFn: api.listMailRules,
    queryKey: ["mail-rules"],
  });
  const calendars = useQuery({
    enabled: view === "workspaces" && selectedDomain === "calendar" && selectedDomainEnabled,
    queryFn: api.listCalendars,
    queryKey: ["calendars"],
  });
  const tasks = useQuery({
    enabled: view === "workspaces" && selectedDomain === "tasks" && selectedDomainEnabled,
    queryFn: () => api.listTasks({ lifecycle: "open", limit: 100 }),
    queryKey: ["tasks", "agent-access", "open"],
  });
  const financeSetup = useQuery({
    enabled: view === "workspaces" && selectedDomain === "finances" && selectedDomainEnabled,
    queryFn: api.getFinanceGuidedSetup,
    queryKey: ["finances", "guided-setup"],
  });
  const tokens = useQuery({ queryFn: api.listAccessTokens, queryKey: ["tokens"] });
  const oauthClients = useQuery({ queryFn: api.listOAuthClients, queryKey: ["oauth-clients"] });
  const revokeOAuthClient = useMutation({
    mutationFn: api.revokeOAuthClient,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      toast.success("Agent connection revoked.");
      setOauthClientToRevoke(null);
      return queryClient.invalidateQueries({ queryKey: ["oauth-clients"] });
    },
  });

  const currentTime = Date.now();
  const activeTokens = (tokens.data ?? []).filter(
    (token) =>
      token.revokedAt === null &&
      (token.expiresAt === null || new Date(token.expiresAt).getTime() > currentTime),
  );
  const usedActiveTokens = activeTokens.filter((token) => token.lastUsedAt !== null);
  const connectedAgentCount = usedActiveTokens.length + (oauthClients.data?.length ?? 0);
  const connectionCountUnavailable = tokens.isError || oauthClients.isError;
  const connectionCountLoading = tokens.isPending || oauthClients.isPending;
  const mailSources = mailSetup.data?.accounts ?? [];
  const setupResource = queryLoadable(setup);
  const selectedProfile = mapLoadable(setupResource, (value) =>
    value.domains.find((item) => item.domain === selectedDomain),
  );
  const mailProfile = mapLoadable(setupResource, (value) =>
    value.domains.find((item) => item.domain === "mail"),
  );
  const hostAuthorities = connectedHostAuthorities(tokens, oauthClients, currentTime);
  const selectedLabel = setupDomainLabels[selectedDomain];
  const selectedSupport: DomainSupport = selectedGuide?.support ?? "unsupported";
  const guidedSetupComplete = setupPlan.data?.status === "complete";
  const currentSetupStep = setupPlan.data?.steps.find(
    (step) => step.id === setupPlan.data?.currentStepId,
  );
  const capability = domainCapability(
    selectedDomain,
    selectedSupport,
    guide.data?.skill.invocation ?? "$ilo-setup",
  );
  const readiness = selectedDomainEnabled
    ? domainReadiness({
        calendars: queryLoadable(calendars),
        domain: selectedDomain,
        financeSetup: queryLoadable(financeSetup),
        hosts: hostAuthorities,
        mailRules: queryLoadable(rules),
        mailSetup: queryLoadable(mailSetup),
        profile: selectedProfile,
        tasks: queryLoadable(tasks),
      })
    : [];
  const readinessPending =
    guide.isPending ||
    setup.isPending ||
    tokens.isPending ||
    oauthClients.isPending ||
    (selectedDomainEnabled &&
      (selectedDomain === "mail"
        ? mailSetup.isPending || rules.isPending
        : selectedDomain === "calendar"
          ? calendars.isPending
          : selectedDomain === "tasks"
            ? tasks.isPending
            : financeSetup.isPending));
  const blockingError = guide.error;
  const readinessError =
    setup.error ??
    tokens.error ??
    oauthClients.error ??
    (selectedDomain === "mail"
      ? (mailSetup.error ?? rules.error)
      : selectedDomain === "calendar"
        ? calendars.error
        : selectedDomain === "tasks"
          ? tasks.error
          : selectedDomain === "finances"
            ? financeSetup.error
            : null);

  return (
    <div className="agent-access">
      {view === "access" ? (
        <Card className="settings-section agent-access__workspaces">
          <CardHeader>
            <CardTitle>
              <h2>Workspace access</h2>
            </CardTitle>
            <CardDescription>
              See what connected agents can read and prepare in each workspace.
            </CardDescription>
            <CardAction>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings?section=agent-connections">Connected agents</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="settings-section__body agent-access__body">
            {blockingError ? (
              <Alert variant="destructive">
                <XIcon />
                <AlertTitle>Workspace access could not be loaded</AlertTitle>
                <AlertDescription>{errorMessage(blockingError)}</AlertDescription>
              </Alert>
            ) : null}

            <FieldSet>
              <FieldLegend className="sr-only" variant="label">
                Choose an agent workspace
              </FieldLegend>
              <ToggleGroup
                aria-label="Agent workspaces"
                className="agent-access__domains"
                onValueChange={(value) => {
                  if (value) updateSearchParam("workspace", value);
                }}
                type="single"
                value={selectedDomain}
                variant="outline"
              >
                {setupDomainOptions.map((option) => {
                  const domainGuide = guide.data?.domains.find(
                    (item) => item.domain === option.domain,
                  );
                  return (
                    <ToggleGroupItem
                      className="agent-access__domain"
                      disabled={!domainGuide || domainGuide.support === "unsupported"}
                      key={option.domain}
                      value={option.domain}
                    >
                      <WorkspaceIcon size="md" workspace={option.domain} />
                      <span className="agent-access__domain-copy">
                        <span>{option.shortLabel}</span>
                        <span aria-hidden="true" className="agent-access__domain-phase">
                          {domainAuthorityLabel(domainGuide, hostAuthorities)}
                        </span>
                      </span>
                      <CircleCheckIcon
                        aria-hidden="true"
                        className="agent-access__domain-selection"
                      />
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </FieldSet>

            <section
              aria-labelledby="workspace-capability-heading"
              className="agent-access__capability"
            >
              <div className="agent-access__capability-heading">
                <WorkspaceIcon size="md" workspace={selectedDomain} />
                <div>
                  <h3 id="workspace-capability-heading">{capability.title}</h3>
                  <p>{capability.description}</p>
                </div>
              </div>
              <p className="agent-access__source-scope">{capability.sourceScope}</p>
              <div className="agent-access__capability-lists">
                <CapabilityList items={capability.allowed} label="Allowed" tier="allowed" />
                <CapabilityList
                  items={capability.approvalRequired}
                  label="Needs your approval"
                  tier="approval-required"
                />
                <CapabilityList
                  items={capability.unavailable}
                  label="Not allowed"
                  tier="not-allowed"
                />
              </div>
            </section>
          </CardContent>
        </Card>
      ) : null}

      {view === "workspaces" ? (
        <>
          <Card className="settings-section agent-access__workspaces">
            <CardHeader>
              <CardTitle>
                <h2>{selectedLabel} settings</h2>
              </CardTitle>
              <CardDescription>
                Configure {selectedLabel}, understand its setup state, and see whether you need to
                act.
              </CardDescription>
              <CardAction>
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings?section=workspace-access">Workspace access</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="settings-section__body agent-access__body">
              {blockingError ? (
                <Alert variant="destructive">
                  <XIcon />
                  <AlertTitle>Agent connection details could not be loaded</AlertTitle>
                  <AlertDescription>{errorMessage(blockingError)}</AlertDescription>
                </Alert>
              ) : null}

              <WorkspaceSettingsStatus
                error={setupPlan.error}
                label={selectedLabel}
                loading={setupPlan.isPending}
                plan={setupPlan.data}
                step={currentSetupStep}
              />

              <DomainReadinessPanel
                domain={selectedDomain}
                enabled={selectedDomainEnabled}
                error={readinessError}
                key={selectedDomain}
                label={selectedLabel}
                loading={readinessPending}
                readiness={readiness}
                suppressFocus={workspaceSetupNeedsPersonAction(setupPlan.data)}
              />

              {setupPlan.data && !guidedSetupComplete ? (
                <SetupProtocolDetails
                  guide={guide.data}
                  guideLoading={guide.isPending}
                  plan={setupPlan.data}
                />
              ) : null}
            </CardContent>
          </Card>

          {selectedDomain === "mail" && selectedDomainEnabled ? (
            <MailRuleReviewDialog
              accounts={mailSources}
              onClose={() => updateSearchParam("reviewRule", null)}
              profileActive={
                mailProfile.state === "ready" && mailProfile.data?.profileStatus === "active"
              }
              profileLoading={mailProfile.state === "loading"}
              profileUnavailable={mailProfile.state === "unavailable"}
              reviewRuleId={reviewRuleId}
              rules={rules.data ?? []}
              unavailable={rules.isError}
            />
          ) : null}
        </>
      ) : null}

      {view === "connections" ? (
        <>
          <header className="agent-access__page-heading">
            <div>
              <h2>Connected agents</h2>
              <p>
                See every host and local credential that can act in Ilo, then revoke access in one
                place.
              </p>
            </div>
            <Badge
              variant={
                !connectionCountLoading && !connectionCountUnavailable && connectedAgentCount > 0
                  ? "default"
                  : "secondary"
              }
            >
              {connectionCountLoading
                ? "Checking connections"
                : connectionCountUnavailable
                  ? "Connections unavailable"
                  : `${connectedAgentCount} connected`}
            </Badge>
          </header>

          <Card className="settings-section" size="sm">
            <CardHeader>
              <CardTitle>
                <h3>Connect an agent host</h3>
              </CardTitle>
              <CardDescription>
                Add Ilo’s MCP endpoint to a compatible host. Provider credentials stay in Ilo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CopyInput
                label="Ilo MCP URL"
                loading={guide.isPending}
                value={guide.data?.mcpUrl ?? ""}
              />
            </CardContent>
          </Card>

          <section
            aria-labelledby="access-management-heading"
            className="agent-access__access"
            id="access-management"
          >
            <div className="agent-access__section-heading">
              <h2 id="access-management-heading">Access management</h2>
              <p>Review connected hosts and least-privilege local credentials.</p>
            </div>

            {(oauthClients.data?.length ?? 0) > 0 ? (
              <Card className="settings-section" size="sm">
                <CardHeader>
                  <CardTitle>
                    <h3>Connected hosts</h3>
                  </CardTitle>
                  <CardDescription>
                    OAuth connections can be revoked without affecting Ilo sessions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ItemGroup>
                    {oauthClients.data?.map((client) => (
                      <Item key={client.id} variant="outline">
                        <ItemMedia variant="icon">
                          {/* OAuth client names are self-asserted, not verified provider identities. */}
                          <PlugIcon />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{client.name}</ItemTitle>
                          <ItemDescription>
                            {client.scopes.map((scope) => scopeLabels[scope]).join(" · ")} ·{" "}
                            {client.lastUsedAt ? "Used recently" : "Not used yet"}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            aria-label={`Revoke ${client.name}`}
                            disabled={revokeOAuthClient.isPending}
                            onClick={() =>
                              setOauthClientToRevoke({ id: client.id, name: client.name })
                            }
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <TrashIcon />
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </CardContent>
              </Card>
            ) : null}

            <TokenAccess
              activeTokens={activeTokens}
              currentTime={currentTime}
              inactiveTokens={(tokens.data ?? []).filter(
                (token) => !activeTokens.some((active) => active.id === token.id),
              )}
              loading={tokens.isPending}
            />
          </section>
          <RevokeAccessDialog
            description="This host will immediately lose its Ilo access. Your Ilo sessions and provider connections will not be changed."
            name={oauthClientToRevoke?.name ?? null}
            onConfirm={() => {
              if (oauthClientToRevoke) revokeOAuthClient.mutate(oauthClientToRevoke.id);
            }}
            onOpenChange={(open) => {
              if (!open && !revokeOAuthClient.isPending) setOauthClientToRevoke(null);
            }}
            pending={revokeOAuthClient.isPending}
          />
        </>
      ) : null}
    </div>
  );
}

function MailRuleReviewDialog({
  accounts,
  onClose,
  profileActive,
  profileLoading,
  profileUnavailable,
  reviewRuleId,
  rules,
  unavailable,
}: {
  accounts: MailSetupAccount[];
  onClose: () => void;
  profileActive: boolean;
  profileLoading: boolean;
  profileUnavailable: boolean;
  reviewRuleId: string | null;
  rules: Awaited<ReturnType<typeof api.listMailRules>>;
  unavailable: boolean;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    enabled: reviewRuleId !== null,
    queryFn: () => api.previewSavedMailRule(reviewRuleId as string),
    queryKey: ["mail-rule-preview", reviewRuleId],
  });
  const activate = useMutation({
    mutationFn: ({ id, preview }: { id: string; preview: MailRulePreview }) =>
      api.activateMailRule(id, {
        expectedCandidateIds: preview.candidates.map((candidate) => candidate.id),
        expectedPreviewFingerprint: preview.fingerprint,
        expectedPreviewedAt: preview.previewedAt,
        expectedVersion: preview.ruleVersion as number,
      }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: async () => {
      toast.success("Mail rule activated.");
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-setup-context"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-access-work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-setup-status"] }),
      ]);
    },
  });
  const accountNames = new Map(
    accounts.map((account) => [account.accountId, account.email ?? account.label]),
  );
  const reviewedRule = reviewRuleId ? rules.find((rule) => rule.id === reviewRuleId) : null;
  const reviewed = preview.data;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={reviewRuleId !== null}
    >
      <DialogContent className="agent-access__rule-dialog">
        <DialogHeader>
          <DialogTitle>
            {reviewedRule ? `Review ${reviewedRule.name}` : "Review Mail rule"}
          </DialogTitle>
          <DialogDescription>
            Review the current bounded sample before activating this agent-drafted rule.
          </DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <Alert variant="destructive">
            <XIcon />
            <AlertTitle>Mail rules are unavailable</AlertTitle>
            <AlertDescription>
              Reload Mail rules before making an activation decision.
            </AlertDescription>
          </Alert>
        ) : null}

        {preview.isPending ? (
          <Alert role="status" variant="info">
            <ShieldCheckIcon />
            <AlertTitle>Checking current matches</AlertTitle>
            <AlertDescription>
              Ilo is rebuilding the bounded preview for this rule.
            </AlertDescription>
          </Alert>
        ) : null}

        {preview.isError ? (
          <Alert variant="destructive">
            <XIcon />
            <AlertTitle>Rule preview could not be loaded</AlertTitle>
            <AlertDescription>{errorMessage(preview.error)}</AlertDescription>
          </Alert>
        ) : null}

        {reviewed ? (
          <div className="agent-access__rule-preview">
            <Alert role="status" variant={reviewed.window.truncated ? "warning" : "info"}>
              <ShieldCheckIcon />
              <AlertTitle>
                {reviewed.matchedCount} current match
                {reviewed.matchedCount === 1 ? "" : "es"}
              </AlertTitle>
              <AlertDescription>
                Reviewed {formatPreviewWindow(reviewed)}. This is a bounded recent sample; the rule
                condition will also govern future matching Mail. Activation rechecks this sample,
                due states, rule version, and fingerprint.
                {reviewedRule
                  ? ` Rule scope: ${formatRuleSources(reviewedRule.sourceIds, accountNames)}.`
                  : ""}
              </AlertDescription>
            </Alert>
            {reviewed.candidates.length > 0 ? (
              <ItemGroup aria-label="Exact Mail rule matches">
                {reviewed.candidates.map((candidate) => (
                  <Item key={candidate.id} size="xs" variant="muted">
                    <ItemContent>
                      <ItemTitle>{candidate.subject || "(No subject)"}</ItemTitle>
                      <ItemDescription>
                        {candidate.from.address} ·{" "}
                        {accountNames.get(candidate.accountId) ?? "Unknown account"} ·{" "}
                        {formatCandidateActions(candidate.actions)}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            ) : null}
            {!profileActive ? (
              <Alert variant="warning">
                <ShieldCheckIcon />
                <AlertTitle>
                  {profileLoading
                    ? "Mail profile status is loading"
                    : profileUnavailable
                      ? "Mail profile status is unavailable"
                      : "Activate your Mail profile first"}
                </AlertTitle>
                <AlertDescription>
                  {profileLoading
                    ? "Wait for setup status before deciding whether this rule can be activated."
                    : profileUnavailable
                      ? "Reload setup status before deciding whether this rule can be activated."
                      : "Review and accept the profile summary in your agent conversation before activating a rule."}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        <DialogFooter showCloseButton>
          <Button
            disabled={
              !reviewRuleId ||
              !reviewed ||
              activate.isPending ||
              unavailable ||
              !profileActive ||
              reviewed.ruleVersion === null
            }
            onClick={() => {
              if (reviewRuleId && reviewed)
                activate.mutate({ id: reviewRuleId, preview: reviewed });
            }}
            type="button"
          >
            Activate reviewed rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatPreviewWindow(preview: MailRulePreview): string {
  if (!preview.window.newestReceivedAt || !preview.window.oldestReceivedAt) {
    return `0 of ${preview.window.limit} recent conversations`;
  }
  const oldest = new Date(preview.window.oldestReceivedAt).toLocaleDateString();
  const newest = new Date(preview.window.newestReceivedAt).toLocaleDateString();
  return `${preview.scannedCount} conversations from ${oldest} to ${newest}${
    preview.window.truncated ? ` (more than ${preview.window.limit} exist)` : ""
  }`;
}

function formatRuleSources(sourceIds: string[], accountNames: Map<string, string>): string {
  if (sourceIds.length === 0) return "no explicit account selected";
  return sourceIds.map((sourceId) => accountNames.get(sourceId) ?? "Unknown account").join(", ");
}

function formatCandidateActions(actions: MailRulePreview["candidates"][number]["actions"]): string {
  return actions
    .map((action) => {
      const label =
        action.type === "trash" ? "recoverable Trash" : action.type.replaceAll("_", " ");
      const delay = action.afterDays > 0 ? ` after ${action.afterDays}d` : "";
      return `${label}${delay} — ${action.due ? "due now" : "retained until due"}`;
    })
    .join("; ");
}

function CapabilityList({
  items,
  label,
  tier,
}: {
  items: string[];
  label: string;
  tier: "allowed" | "approval-required" | "not-allowed";
}) {
  const TierIcon =
    tier === "allowed"
      ? CircleCheckIcon
      : tier === "approval-required"
        ? ApprovalHandIcon
        : ErrorIcon;

  return (
    <div>
      <h4>{label}</h4>
      <ul>
        {items.map((item) => (
          <li data-tier={tier} key={item}>
            <TierIcon
              aria-hidden="true"
              className="agent-access__capability-tier-icon"
              data-tier={tier}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkspaceSettingsStatus({
  error,
  label,
  loading,
  plan,
  step,
}: {
  error: Error | null;
  label: string;
  loading: boolean;
  plan: AssistantSetupPlan | undefined;
  step: AssistantSetupPlan["steps"][number] | undefined;
}) {
  const agentOwned = Boolean(plan && plan.status !== "complete" && step?.owner === "agent");
  if (
    !error &&
    !loading &&
    (!plan || plan.status === "complete" || (step?.owner !== "person" && !agentOwned))
  ) {
    return null;
  }
  const title = error
    ? "Setup unavailable"
    : loading
      ? "Checking settings"
      : agentOwned
        ? "Setup in progress"
        : "Action required";
  const description = error
    ? errorMessage(error)
    : loading
      ? `Ilo is checking ${label} configuration.`
      : agentOwned
        ? (plan?.nextAction ?? step?.description ?? `The agent is setting up ${label}.`)
        : (step?.userAction ?? plan?.nextAction ?? `${label} setup has not started.`);
  const action =
    !error && !loading && step?.id === "connect_agent"
      ? { label: "Connect agent", to: "/settings?section=agent-connections" }
      : !error && !loading && step?.id === "review_guidance" && plan?.domain === "finances"
        ? { label: "Review guidance", to: "/settings?section=finances#guidance" }
        : null;
  return (
    <Alert role="status" variant={error ? "destructive" : "info"}>
      {error ? <XIcon /> : <ShieldCheckIcon />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {action ? (
        <AlertAction>
          <Button asChild size="sm" variant="outline">
            <Link to={action.to}>{action.label}</Link>
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

function DomainReadinessPanel({
  domain,
  enabled,
  error,
  label,
  loading,
  readiness,
  suppressFocus,
}: {
  domain: SetupDomain;
  enabled: boolean;
  error: Error | null;
  label: string;
  loading: boolean;
  readiness: DomainReadinessItem[];
  suppressFocus: boolean;
}) {
  const priority = readiness.find((item) => !item.complete);
  const recommended = readiness.find(
    (item) => !item.complete && (item.nextStep !== undefined || item.action !== undefined),
  );
  const focus = recommended ?? priority;
  const remainingCount = readiness.filter((item) => !item.complete).length;
  const summary = error
    ? `${label} readiness could not be loaded.`
    : loading
      ? "Checking setup and access."
      : !enabled
        ? `${label} is not available in this deployment.`
        : priority
          ? suppressFocus
            ? `${remainingCount} ${remainingCount === 1 ? "check is" : "checks are"} open, including the action above.`
            : `${remainingCount} ${remainingCount === 1 ? "check needs" : "checks need"} attention.`
          : "Setup and access are ready.";

  return (
    <ReadinessPanel
      checks={readiness.map((item) => ({
        action: item.action ? (
          <Button asChild size="sm" variant="outline">
            <Link to={item.action.to}>{item.action.label}</Link>
          </Button>
        ) : undefined,
        complete: item.complete,
        description: item.description,
        id: item.title,
        title: item.title,
      }))}
      description={summary}
      detailsLabel={`${label} readiness checks`}
      {...(!suppressFocus && !loading && !error && enabled && focus
        ? {
            focus: {
              label: recommended ? ("Next step" as const) : ("Current constraint" as const),
              title: focus.nextStep ?? focus.title,
            },
          }
        : {})}
      icon={<WorkspaceIcon size="md" workspace={domain} />}
      loading={loading}
      title={`${label} readiness`}
      unavailable={error !== null || (!loading && !enabled)}
    />
  );
}

function domainAuthorityLabel(
  guide: Awaited<ReturnType<typeof api.getAgentConnectionGuide>>["domains"][number] | undefined,
  hosts: Loadable<ConnectedHostAuthority[]>,
): string {
  if (!guide || guide.support === "unsupported" || hosts.state === "unavailable") {
    return "Unavailable";
  }
  if (hosts.state === "loading") return "Checking";
  const readers = hosts.data.filter((host) =>
    host.scopes.includes(guide.readScope as AccessScope),
  ).length;
  const writers = guide.writeScope
    ? hosts.data.filter((host) => host.scopes.includes(guide.writeScope as AccessScope)).length
    : 0;
  if (writers > 0) return "Read & prepare";
  if (readers > 0) return "Read only";
  return "No access";
}

function SetupProtocolDetails({
  guide,
  guideLoading,
  plan,
}: {
  guide: Awaited<ReturnType<typeof api.getAgentConnectionGuide>> | undefined;
  guideLoading: boolean;
  plan: AssistantSetupPlan | undefined;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button className="agent-access__protocol-trigger" size="sm" variant="ghost">
          Setup protocol details
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="agent-access__protocol-details">
        <p>
          Connected agents read the current setup step from Ilo. If a host waits for a request, send
          this one sentence; the hosted skill is optional.
        </p>
        <CopyPrompt
          copyLabel="Copy agent setup request"
          label="Agent setup request"
          loading={guideLoading}
          value={guide?.skill.setupPrompt ?? ""}
        />
        {guide ? (
          <Item size="xs" variant="muted">
            <ItemMedia variant="icon">
              <ShieldCheckIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Optional setup reference v{guide.skill.version}</ItemTitle>
              <ItemDescription>
                Protocol {plan?.protocolVersion ?? "1.0"} · source revision {guide.skill.revision}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button asChild size="sm" variant="ghost">
                <a href={guide.skill.sourceUrl} rel="noreferrer" target="_blank">
                  View skill source
                  <ExternalLinkIcon data-icon="inline-end" />
                </a>
              </Button>
            </ItemActions>
          </Item>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CopyInput({
  label,
  loading = false,
  value,
}: {
  label: string;
  loading?: boolean;
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={`copy-${label.replaceAll(" ", "-").toLowerCase()}`}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          aria-label={label}
          id={`copy-${label.replaceAll(" ", "-").toLowerCase()}`}
          readOnly
          value={loading ? "Loading…" : value}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={`Copy ${label}`}
            disabled={loading || !value}
            onClick={() => void copyToClipboard(value, label)}
            size="icon-xs"
          >
            <ClipboardIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

function CopyPrompt({
  copyLabel,
  label,
  loading = false,
  value,
}: {
  copyLabel: string;
  label: string;
  loading?: boolean;
  value: string;
}) {
  const id = `copy-${label.replaceAll(" ", "-").toLowerCase()}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        className="agent-access__prompt"
        id={id}
        readOnly
        rows={4}
        value={loading ? "Loading…" : value}
      />
      <Button
        disabled={loading || !value}
        onClick={() => void copyToClipboard(value, copyLabel.replace("Copy ", ""))}
        size="sm"
        type="button"
        variant="outline"
      >
        <ClipboardIcon data-icon="inline-start" />
        {copyLabel}
      </Button>
    </Field>
  );
}

function TokenAccess({
  activeTokens,
  currentTime,
  inactiveTokens,
  loading,
}: {
  activeTokens: Awaited<ReturnType<typeof api.listAccessTokens>>;
  currentTime: number;
  inactiveTokens: Awaited<ReturnType<typeof api.listAccessTokens>>;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<
    Awaited<ReturnType<typeof api.listAccessTokens>>[number] | null
  >(null);
  const [tokenName, setTokenName] = useState("Local agent");
  const [scopes, setScopes] = useState<AccessScope[]>(defaultTokenScopes);
  const create = useMutation({
    mutationFn: () => api.createAccessToken({ name: tokenName.trim(), scopes }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (token) => {
      setSecret(token.token);
      toast.success("Local agent token created.");
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tokens"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-access-work-items"] }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteAccessToken,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      toast.success("Agent token revoked.");
      setTokenToRevoke(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tokens"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-access-work-items"] }),
      ]);
    },
  });
  const selectedPreset =
    tokenPresets.find(
      (preset) =>
        preset.scopes.length === scopes.length &&
        preset.scopes.every((scope) => scopes.includes(scope)),
    )?.name ?? "";

  return (
    <Card className="settings-section" size="sm">
      <CardHeader>
        <CardTitle>
          <h2>Local and manual access</h2>
        </CardTitle>
        <CardDescription>
          Use a personal access token only when your host cannot complete the recommended OAuth
          connection.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{activeTokens.length} active</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Collapsible onOpenChange={setOpen} open={open}>
          <CollapsibleTrigger asChild>
            <Button className="settings-disclosure__trigger" type="button" variant="outline">
              <KeyIcon data-icon="inline-start" />
              {open ? "Hide token setup" : "Set up a local token"}
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="agent-access__token-content">
            <FieldGroup>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="token-name">Token name</FieldLabel>
                  <FieldDescription>Name the host or device that will use it.</FieldDescription>
                </FieldContent>
                <Input
                  autoComplete="off"
                  id="token-name"
                  name="token-name"
                  onChange={(event) => setTokenName(event.target.value)}
                  value={tokenName}
                />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Permission preset</FieldLegend>
                <ToggleGroup
                  aria-label="Permission preset"
                  className="agent-access__presets"
                  onValueChange={(presetName) => {
                    const preset = tokenPresets.find((item) => item.name === presetName);
                    if (preset) setScopes(preset.scopes);
                  }}
                  type="single"
                  value={selectedPreset}
                  variant="outline"
                >
                  {tokenPresets.map((preset) => (
                    <ToggleGroupItem
                      aria-label={`${preset.name}: ${preset.description}`}
                      key={preset.name}
                      value={preset.name}
                    >
                      {preset.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
              <Collapsible onOpenChange={setPermissionsOpen} open={permissionsOpen}>
                <CollapsibleTrigger asChild>
                  <Button className="settings-disclosure__trigger" type="button" variant="outline">
                    Fine-tune permissions · {scopes.length} selected
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="settings-disclosure__content">
                  <FieldSet>
                    <FieldLegend className="sr-only" variant="label">
                      Fine-tune permissions
                    </FieldLegend>
                    <FieldGroup className="token-permissions">
                      {selectableScopes.map((scope) => (
                        <Field key={scope} orientation="horizontal">
                          <Checkbox
                            checked={scopes.includes(scope)}
                            id={`scope-${scope}`}
                            onCheckedChange={(checked) =>
                              setScopes((current) =>
                                checked
                                  ? [...new Set([...current, scope])]
                                  : current.filter((selectedScope) => selectedScope !== scope),
                              )
                            }
                          />
                          <FieldLabel htmlFor={`scope-${scope}`}>{scopeLabels[scope]}</FieldLabel>
                        </Field>
                      ))}
                    </FieldGroup>
                  </FieldSet>
                </CollapsibleContent>
              </Collapsible>
              <Button
                disabled={create.isPending || scopes.length === 0 || tokenName.trim().length === 0}
                onClick={() => create.mutate()}
                type="button"
              >
                <KeyIcon data-icon="inline-start" />
                Create local token
              </Button>
            </FieldGroup>
            {secret ? (
              <Alert role="status">
                <KeyIcon />
                <AlertTitle>Copy this token now</AlertTitle>
                <AlertDescription>
                  It will not be shown again. <code>{secret}</code>
                </AlertDescription>
                <Button
                  aria-label="Dismiss token"
                  onClick={() => setSecret(null)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Dismiss
                </Button>
              </Alert>
            ) : null}
          </CollapsibleContent>
        </Collapsible>

        {!loading && activeTokens.length > 0 ? (
          <ItemGroup className="agent-access__credentials">
            {activeTokens.map((token) => (
              <Item key={token.id} variant="outline">
                <ItemMedia variant="icon">
                  <KeyIcon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{token.name}</ItemTitle>
                  <ItemDescription>
                    {tokenScopeSummary(token.scopes)}
                    {" · "}
                    {token.lastUsedAt ? "Used recently" : "Not used yet"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    aria-label={`Revoke ${token.name}`}
                    disabled={remove.isPending}
                    onClick={() => setTokenToRevoke(token)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <TrashIcon />
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : null}

        {inactiveTokens.length > 0 ? (
          <Collapsible className="agent-access__revoked">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost">
                Inactive tokens · {inactiveTokens.length}
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ItemGroup>
                {inactiveTokens.map((token) => (
                  <Item key={token.id} size="xs" variant="muted">
                    <ItemContent>
                      <ItemTitle>{token.name}</ItemTitle>
                      <ItemDescription>
                        {token.revokedAt
                          ? "Revoked"
                          : token.expiresAt && new Date(token.expiresAt).getTime() <= currentTime
                            ? `Expired · ${tokenScopeSummary(token.scopes)}`
                            : "Inactive"}
                      </ItemDescription>
                    </ItemContent>
                    {!token.revokedAt ? (
                      <ItemActions>
                        <Button
                          aria-label={`Revoke ${token.name}`}
                          disabled={remove.isPending}
                          onClick={() => setTokenToRevoke(token)}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <TrashIcon />
                        </Button>
                      </ItemActions>
                    ) : null}
                  </Item>
                ))}
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <RevokeAccessDialog
          description="This local credential will immediately stop working. Existing Ilo sessions and connected providers will not be changed."
          name={tokenToRevoke?.name ?? null}
          onConfirm={() => {
            if (tokenToRevoke) remove.mutate(tokenToRevoke.id);
          }}
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setTokenToRevoke(null);
          }}
          pending={remove.isPending}
        />
      </CardContent>
    </Card>
  );
}

function tokenScopeSummary(scopes: AccessScope[]): string {
  const currentScopes = scopes
    .filter((scope) => scope !== "automations:write")
    .map((scope) => scopeLabels[scope]);
  if (scopes.includes("automations:write")) currentScopes.push("Legacy inactive permission");
  return currentScopes.join(" · ");
}

function RevokeAccessDialog({
  description,
  name,
  onConfirm,
  onOpenChange,
  pending,
}: {
  description: string;
  name: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={name !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name ? `Revoke ${name}?` : "Revoke access?"}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} variant="destructive">
            {pending ? "Revoking…" : "Revoke access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function domainCapability(
  domain: SetupDomain,
  support: DomainSupport,
  invocation: string,
): DomainCapability {
  if (domain === "mail") return mailAgentAccessCapability(support, invocation);
  if (domain === "calendar") return calendarAgentAccessCapability(support, invocation);
  if (domain === "tasks") return taskAgentAccessCapability(support, invocation);
  return financeAgentAccessCapability(support, invocation);
}

function domainReadiness({
  calendars,
  domain,
  financeSetup,
  hosts,
  mailRules,
  mailSetup,
  profile,
  tasks,
}: {
  calendars: Parameters<typeof calendarAgentAccessReadiness>[0]["calendars"];
  domain: SetupDomain;
  financeSetup: Parameters<typeof financeAgentAccessReadiness>[0]["setup"];
  hosts: Loadable<ConnectedHostAuthority[]>;
  mailRules: Parameters<typeof mailAgentAccessReadiness>[0]["rules"];
  mailSetup: Parameters<typeof mailAgentAccessReadiness>[0]["setup"];
  profile: Parameters<typeof mailAgentAccessReadiness>[0]["profile"];
  tasks: Parameters<typeof taskAgentAccessReadiness>[0]["tasks"];
}): DomainReadinessItem[] {
  if (domain === "mail") {
    return mailAgentAccessReadiness({
      hosts,
      profile,
      rules: mailRules,
      setup: mailSetup,
    });
  }
  if (domain === "calendar") {
    return calendarAgentAccessReadiness({ calendars, hosts, profile });
  }
  if (domain === "tasks") {
    return taskAgentAccessReadiness({ hosts, profile, tasks });
  }
  return financeAgentAccessReadiness({ hosts, profile, setup: financeSetup });
}

function queryLoadable<T>({
  data,
  isError,
  isPending,
}: {
  data: T | undefined;
  isError: boolean;
  isPending: boolean;
}): Loadable<T> {
  if (isPending) return { state: "loading" };
  if (isError || data === undefined) return { state: "unavailable" };
  return { data, state: "ready" };
}

function connectedHostAuthorities(
  tokens: {
    data: Awaited<ReturnType<typeof api.listAccessTokens>> | undefined;
    isError: boolean;
    isPending: boolean;
  },
  oauthClients: {
    data: Awaited<ReturnType<typeof api.listOAuthClients>> | undefined;
    isError: boolean;
    isPending: boolean;
  },
  currentTime: number,
): Loadable<ConnectedHostAuthority[]> {
  if (tokens.isPending || oauthClients.isPending) return { state: "loading" };
  if (tokens.isError || oauthClients.isError || !tokens.data || !oauthClients.data) {
    return { state: "unavailable" };
  }
  return {
    data: [
      ...tokens.data
        .filter(
          (token) =>
            token.revokedAt === null &&
            token.lastUsedAt !== null &&
            (token.expiresAt === null || new Date(token.expiresAt).getTime() > currentTime),
        )
        .map((token) => ({ name: token.name, scopes: token.scopes })),
      ...oauthClients.data.map((client) => ({ name: client.name, scopes: client.scopes })),
    ],
    state: "ready",
  };
}

async function copyToClipboard(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}
