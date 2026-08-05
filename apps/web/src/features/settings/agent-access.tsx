import type {
  AccessScope,
  AssistantSetupStatus,
  AssistantSetupStep,
  MailRulePreview,
  MailSetupAccount,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Clipboard,
  ExternalLink,
  KeyRound,
  Plug,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errorMessage } from "../../api.js";
import { ReadinessPanel } from "../../components/readiness-panel.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
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
  "automations:read": "Read automations",
  "automations:write": "Run automations",
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
    description: "Read your agenda, mail, and routine results without changing them.",
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
      "automations:write",
      "audit:read",
      "bookmarks:read",
    ],
  },
];

export function AgentAccessSettings() {
  const queryClient = useQueryClient();
  const [selectedDomain, setSelectedDomain] = useState<SetupDomain>("mail");
  const guide = useQuery({
    queryFn: api.getAgentConnectionGuide,
    queryKey: ["agent-connection-guide"],
  });
  const selectedGuide = guide.data?.domains.find((item) => item.domain === selectedDomain);
  const selectedDomainEnabled =
    guide.isSuccess && selectedGuide !== undefined && selectedGuide.support !== "unsupported";
  const setup = useQuery({
    queryFn: api.getAssistantSetupStatus,
    queryKey: ["assistant-setup-status"],
  });
  const setupPlan = useQuery({
    enabled: selectedDomainEnabled,
    queryFn: () => api.getIloSetup({ domain: selectedDomain }),
    queryKey: ["ilo-setup-plan", selectedDomain],
    refetchInterval: 10_000,
  });
  const mailSetup = useQuery({
    enabled: selectedDomain === "mail" && selectedDomainEnabled,
    queryFn: api.getMailSetupContext,
    queryKey: ["mail-setup-context"],
  });
  const rules = useQuery({
    enabled: selectedDomain === "mail" && selectedDomainEnabled,
    queryFn: api.listMailRules,
    queryKey: ["mail-rules"],
  });
  const calendars = useQuery({
    enabled: selectedDomain === "calendar" && selectedDomainEnabled,
    queryFn: api.listCalendars,
    queryKey: ["calendars"],
  });
  const tasks = useQuery({
    enabled: selectedDomain === "tasks" && selectedDomainEnabled,
    queryFn: () => api.listTasks({ completed: false, limit: 100 }),
    queryKey: ["tasks", "agent-access", "open"],
  });
  const financeSetup = useQuery({
    enabled: selectedDomain === "finances" && selectedDomainEnabled,
    queryFn: api.getFinanceGuidedSetup,
    queryKey: ["finances", "guided-setup"],
  });
  const attention = useQuery({
    enabled: selectedDomainEnabled,
    queryFn: () => api.listAttentionItems({ domain: selectedDomain, limit: 100, status: "open" }),
    queryKey: ["assistant-attention", selectedDomain, "open"],
  });
  const tokens = useQuery({ queryFn: api.listAccessTokens, queryKey: ["tokens"] });
  const oauthClients = useQuery({ queryFn: api.listOAuthClients, queryKey: ["oauth-clients"] });
  const revokeOAuthClient = useMutation({
    mutationFn: api.revokeOAuthClient,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      toast.success("Agent connection revoked.");
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
  const attentionResource = queryLoadable(attention);
  const selectedLabel = setupDomainLabels[selectedDomain];
  const selectedSupport: DomainSupport = selectedGuide?.support ?? "unsupported";
  const mcpConnectionComplete = setupPlan.data?.connection.observed ?? false;
  const guidedSetupComplete = setupPlan.data?.status === "complete";
  const capability = domainCapability(
    selectedDomain,
    selectedSupport,
    guide.data?.skill.invocation ?? "$ilo-setup",
  );
  const readiness = selectedDomainEnabled
    ? domainReadiness({
        attention: attentionResource,
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
      (attention.isPending ||
        (selectedDomain === "mail"
          ? mailSetup.isPending || rules.isPending
          : selectedDomain === "calendar"
            ? calendars.isPending
            : selectedDomain === "tasks"
              ? tasks.isPending
              : financeSetup.isPending)));
  const blockingError = guide.error;
  const selectedDomainError =
    setup.error ??
    setupPlan.error ??
    attention.error ??
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
      <Card className="settings-section agent-access__hero">
        <CardHeader>
          <CardTitle>
            <h2>Connect an agent</h2>
          </CardTitle>
          <CardDescription>
            Connect once. Ilo gives the agent its identity, available work surface, current setup
            step, evidence, and next tools so the agent can do the setup work itself.
          </CardDescription>
          <CardAction>
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
                  : connectedAgentCount > 0
                    ? `${connectedAgentCount} connected`
                    : "Not connected"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="settings-section__body agent-access__body">
          {blockingError ? (
            <Alert variant="destructive">
              <X />
              <AlertTitle>Agent connection details could not be loaded</AlertTitle>
              <AlertDescription>{errorMessage(blockingError)}</AlertDescription>
            </Alert>
          ) : null}

          <FieldSet>
            <FieldLegend variant="label">Product setup</FieldLegend>
            <ToggleGroup
              aria-label="Domain to set up"
              className="agent-access__domains"
              onValueChange={(value) => {
                if (value) setSelectedDomain(value as SetupDomain);
              }}
              type="single"
              value={selectedDomain}
              variant="outline"
            >
              {setupDomainOptions.map((option) => {
                const domainGuide = guide.data?.domains.find(
                  (item) => item.domain === option.domain,
                );
                const setupPhase = domainSetupPhase({
                  domain: option.domain,
                  guideLoading: guide.isPending,
                  published: domainGuide !== undefined && domainGuide.support !== "unsupported",
                  setup: setupResource,
                });
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
                        {setupPhase}
                      </span>
                    </span>
                    <CheckCircle2 aria-hidden="true" className="agent-access__domain-selection" />
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </FieldSet>

          {selectedDomainError ? (
            <Alert variant="destructive">
              <X />
              <AlertTitle>{selectedLabel} readiness could not be loaded</AlertTitle>
              <AlertDescription>{errorMessage(selectedDomainError)}</AlertDescription>
            </Alert>
          ) : null}

          <DomainReadinessPanel
            domain={selectedDomain}
            enabled={selectedDomainEnabled}
            error={selectedDomainError !== null}
            key={selectedDomain}
            label={selectedLabel}
            loading={readinessPending}
            readiness={readiness}
          />

          {selectedDomain === "mail" && selectedDomainEnabled ? (
            <MailRuleReview
              accounts={mailSources}
              loading={rules.isPending}
              profileActive={
                mailProfile.state === "ready" && mailProfile.data?.profileStatus === "active"
              }
              profileLoading={mailProfile.state === "loading"}
              profileUnavailable={mailProfile.state === "unavailable"}
              rules={rules.data ?? []}
              unavailable={rules.isError}
            />
          ) : null}

          <div className="agent-access__steps">
            <ConnectionStep
              complete={mcpConnectionComplete}
              defaultOpen={!mcpConnectionComplete}
              description="Add this remote MCP URL to the host and authorize Ilo. This is the only setup handoff the person must complete. Provider credentials stay in Ilo."
              number="1"
              status={
                setupPlan.isPending
                  ? "Checking for a connected host…"
                  : setupPlan.isError
                    ? "Connection status is unavailable."
                    : mcpConnectionComplete
                      ? "MCP connection confirmed by Ilo."
                      : "Waiting for a host to connect."
              }
              title="Connect an agent"
            >
              <CopyInput
                label="Ilo MCP URL"
                loading={guide.isPending}
                value={guide.data?.mcpUrl ?? ""}
              />
            </ConnectionStep>

            <ConnectionStep
              complete={guidedSetupComplete}
              defaultOpen={mcpConnectionComplete && !guidedSetupComplete}
              description="After connection, the agent calls get_ilo_context to orient itself, then get_ilo_setup for the current semantic step, domain context, required tools, and approval boundary. A separately installed skill is not required."
              number="2"
              status={
                setupPlan.isPending
                  ? `Checking ${selectedLabel} setup…`
                  : setupPlan.isError
                    ? `${selectedLabel} setup status is unavailable.`
                    : (setupPlan.data?.nextAction ?? "Waiting for the setup protocol.")
              }
              title="Let the agent set up Ilo"
            >
              <Alert role="status" variant="info">
                <ShieldCheck />
                <AlertTitle>
                  {setupPlan.data
                    ? (setupPlan.data.steps.find(
                        (step) => step.id === setupPlan.data?.currentStepId,
                      )?.title ?? capability.title)
                    : `Loading ${selectedLabel} setup`}
                </AlertTitle>
                <AlertDescription>
                  {setupPlan.data?.nextAction ??
                    "Ilo is checking the authenticated setup plan and domain state."}{" "}
                  {!guide.isPending ? capability.description : ""}
                </AlertDescription>
              </Alert>

              {setupPlan.data ? (
                <ItemGroup className="agent-access__protocol-steps">
                  {setupPlan.data.steps.map((step) => (
                    <SetupProtocolStep key={step.id} step={step} />
                  ))}
                </ItemGroup>
              ) : null}

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button className="agent-access__protocol-trigger" size="sm" variant="ghost">
                    Setup protocol details
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="agent-access__protocol-details">
                  <p>
                    Most hosts can begin from the tool description. If yours waits for a request,
                    send this one sentence. The hosted skill remains an optional reference for hosts
                    that support skills.
                  </p>
                  <CopyPrompt
                    copyLabel="Copy agent setup request"
                    label="Agent setup request"
                    loading={guide.isPending}
                    value={guide.data?.skill.setupPrompt ?? ""}
                  />
                  {guide.data ? (
                    <Item size="xs" variant="muted">
                      <ItemMedia variant="icon">
                        <ShieldCheck />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>Optional setup reference v{guide.data.skill.version}</ItemTitle>
                        <ItemDescription>
                          Protocol {setupPlan.data?.protocolVersion ?? "1.0"} · source revision{" "}
                          {guide.data.skill.revision}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button asChild size="sm" variant="ghost">
                          <a href={guide.data.skill.sourceUrl} rel="noreferrer" target="_blank">
                            View skill source
                            <ExternalLink data-icon="inline-end" />
                          </a>
                        </Button>
                      </ItemActions>
                    </Item>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </ConnectionStep>
          </div>
        </CardContent>
      </Card>

      {(oauthClients.data?.length ?? 0) > 0 ? (
        <Card className="settings-section" size="sm">
          <CardHeader>
            <CardTitle>
              <h2>Connected hosts</h2>
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
                    <Plug />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{client.name}</ItemTitle>
                    <ItemDescription>
                      {client.scopes.length} permissions ·{" "}
                      {client.lastUsedAt ? "Used recently" : "Not used yet"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      aria-label={`Revoke ${client.name}`}
                      disabled={revokeOAuthClient.isPending}
                      onClick={() => revokeOAuthClient.mutate(client.id)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
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
        loading={tokens.isPending}
        revokedTokens={(tokens.data ?? []).filter((token) => token.revokedAt !== null)}
      />
    </div>
  );
}

function MailRuleReview({
  accounts,
  loading,
  profileActive,
  profileLoading,
  profileUnavailable,
  rules,
  unavailable,
}: {
  accounts: MailSetupAccount[];
  loading: boolean;
  profileActive: boolean;
  profileLoading: boolean;
  profileUnavailable: boolean;
  rules: Awaited<ReturnType<typeof api.listMailRules>>;
  unavailable: boolean;
}) {
  const queryClient = useQueryClient();
  const [reviewed, setReviewed] = useState<{ id: string; preview: MailRulePreview } | null>(null);
  const review = useMutation({
    mutationFn: api.previewSavedMailRule,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (preview, id) => setReviewed({ id, preview }),
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
      setReviewed(null);
      toast.success("Mail rule activated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mail-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-setup-context"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-setup-status"] }),
      ]);
    },
  });
  if (loading) return null;
  if (unavailable) {
    return (
      <Alert variant="destructive">
        <X />
        <AlertTitle>Mail rules are unavailable</AlertTitle>
        <AlertDescription>
          Ilo cannot report an approved-rule count or open rule review until Mail rules load.
        </AlertDescription>
      </Alert>
    );
  }
  if (rules.length === 0) return null;
  const accountNames = new Map(
    accounts.map((account) => [account.accountId, account.email ?? account.label]),
  );
  const reviewedRule = reviewed ? rules.find((rule) => rule.id === reviewed.id) : null;
  return (
    <section aria-labelledby="mail-rule-review-heading" className="agent-access__rule-review">
      <div>
        <h3 id="mail-rule-review-heading">Review Mail rules</h3>
        <p>Agents can draft rules. Only you can activate one after reviewing its current sample.</p>
      </div>
      <ItemGroup>
        {rules.map((rule) => (
          <Item key={rule.id} size="sm" variant="outline">
            <ItemContent>
              <ItemTitle>{rule.name}</ItemTitle>
              <ItemDescription>
                {describeMailRule(rule)} ·{" "}
                {rule.enabled && rule.policy === "approved_rule" ? "Active" : "Draft"}
              </ItemDescription>
            </ItemContent>
            {!rule.enabled ? (
              <ItemActions>
                <Button
                  disabled={review.isPending}
                  onClick={() => review.mutate(rule.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Review
                </Button>
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </ItemGroup>
      {reviewed ? (
        <div className="agent-access__rule-preview">
          <Alert role="status" variant={reviewed.preview.window.truncated ? "warning" : "info"}>
            <ShieldCheck />
            <AlertTitle>
              {reviewed.preview.matchedCount} current match
              {reviewed.preview.matchedCount === 1 ? "" : "es"}
            </AlertTitle>
            <AlertDescription>
              Reviewed {formatPreviewWindow(reviewed.preview)}. This is a bounded recent sample; the
              rule condition will also govern future matching Mail. Activation rechecks this sample,
              due states, rule version, and fingerprint.
              {reviewedRule
                ? ` Rule scope: ${formatRuleSources(reviewedRule.sourceIds, accountNames)}.`
                : ""}
            </AlertDescription>
          </Alert>
          {reviewed.preview.candidates.length > 0 ? (
            <ItemGroup aria-label="Exact Mail rule matches">
              {reviewed.preview.candidates.map((candidate) => (
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
              <ShieldCheck />
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
          <Button
            disabled={activate.isPending || !profileActive || reviewed.preview.ruleVersion === null}
            onClick={() => activate.mutate(reviewed)}
            type="button"
          >
            Activate reviewed rule
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function describeMailRule(rule: Awaited<ReturnType<typeof api.listMailRules>>[number]): string {
  const action = rule.actions
    .map(
      (item) =>
        `${item.type.replaceAll("_", " ")}${item.afterDays ? ` after ${item.afterDays}d` : ""}`,
    )
    .join(", ");
  return `${rule.condition.field} ${rule.condition.operator.replaceAll("_", " ")} “${rule.condition.value}” → ${action}`;
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

function DomainReadinessPanel({
  domain,
  enabled,
  error,
  label,
  loading,
  readiness,
}: {
  domain: SetupDomain;
  enabled: boolean;
  error: boolean;
  label: string;
  loading: boolean;
  readiness: DomainReadinessItem[];
}) {
  const priority = readiness.find((item) => !item.complete);
  const recommended = readiness.find(
    (item) => !item.complete && (item.nextStep !== undefined || item.action !== undefined),
  );
  const focus = recommended ?? priority;
  const summary = error
    ? `${label} readiness could not be loaded.`
    : loading
      ? `Checking ${label} material, preferences, workflows, and agent access.`
      : !enabled
        ? `${label} guided setup is not published by this deployment.`
        : priority
          ? `${label} is partially ready for agent use.`
          : `Everything Ilo checks for ${label} is ready.`;

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
      {...(!loading && !error && enabled && focus
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
      unavailable={error || (!loading && !enabled)}
    />
  );
}

function domainSetupPhase({
  domain,
  guideLoading,
  published,
  setup,
}: {
  domain: SetupDomain;
  guideLoading: boolean;
  published: boolean;
  setup: Loadable<AssistantSetupStatus>;
}): string {
  if (guideLoading || setup.state === "loading") return "Checking";
  if (!published || setup.state === "unavailable") return "Unavailable";
  const profile = setup.data.domains.find((item) => item.domain === domain);
  if (profile?.pendingDraftVersion || profile?.profileStatus === "draft") return "Needs review";
  if (profile?.approvedProfileStatus === "active" || profile?.profileStatus === "active") {
    return "Set up";
  }
  return "Not set up";
}

function SetupProtocolStep({ step }: { step: AssistantSetupStep }) {
  const status =
    step.state === "complete" ? "Done" : step.state === "current" ? "Current" : "Waiting";
  const description = step.completionEvidence[0] ?? step.description;
  return (
    <Item size="xs" variant={step.state === "current" ? "outline" : "muted"}>
      <ItemMedia variant="icon">
        {step.state === "complete" ? <CheckCircle2 /> : <Circle />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{step.title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={step.state === "current" ? "default" : "secondary"}>{status}</Badge>
      </ItemActions>
    </Item>
  );
}

function ConnectionStep({
  children,
  complete,
  defaultOpen,
  description,
  number,
  status,
  title,
}: {
  children: React.ReactNode;
  complete: boolean;
  defaultOpen: boolean;
  description: string;
  number: string;
  status: string;
  title: string;
}) {
  return (
    <section className="agent-access__step" data-complete={complete || undefined}>
      <Collapsible defaultOpen={defaultOpen}>
        <div className="agent-access__step-layout">
          <div className="agent-access__step-number" aria-hidden="true">
            {complete ? <CheckCircle2 /> : number}
          </div>
          <div className="agent-access__step-content">
            <h3>
              <CollapsibleTrigger asChild>
                <Button className="agent-access__step-trigger" type="button" variant="ghost">
                  <span>
                    <span className="agent-access__step-title">{title}</span>
                    <span className="agent-access__step-status">{status}</span>
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent className="agent-access__step-details">
              <p>{description}</p>
              {children}
            </CollapsibleContent>
          </div>
        </div>
      </Collapsible>
    </section>
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
            <Clipboard />
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
        <Clipboard data-icon="inline-start" />
        {copyLabel}
      </Button>
    </Field>
  );
}

function TokenAccess({
  activeTokens,
  loading,
  revokedTokens,
}: {
  activeTokens: Awaited<ReturnType<typeof api.listAccessTokens>>;
  loading: boolean;
  revokedTokens: Awaited<ReturnType<typeof api.listAccessTokens>>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Local agent");
  const [scopes, setScopes] = useState<AccessScope[]>(defaultTokenScopes);
  const create = useMutation({
    mutationFn: () => api.createAccessToken({ name: tokenName.trim(), scopes }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (token) => {
      setSecret(token.token);
      toast.success("Local agent token created.");
      return queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteAccessToken,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      toast.success("Agent token revoked.");
      return queryClient.invalidateQueries({ queryKey: ["tokens"] });
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
              <KeyRound data-icon="inline-start" />
              {open ? "Hide token setup" : "Set up a local token"}
              <ChevronDown data-icon="inline-end" />
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
                  id="token-name"
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
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="settings-disclosure__content">
                  <FieldSet>
                    <FieldLegend className="sr-only" variant="label">
                      Fine-tune permissions
                    </FieldLegend>
                    <FieldGroup className="token-permissions">
                      {(Object.keys(scopeLabels) as AccessScope[]).map((scope) => (
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
                <KeyRound data-icon="inline-start" />
                Create local token
              </Button>
            </FieldGroup>
            {secret ? (
              <Alert role="status">
                <KeyRound />
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
                  <KeyRound />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{token.name}</ItemTitle>
                  <ItemDescription>
                    {token.scopes.length} permissions ·{" "}
                    {token.lastUsedAt ? "Used recently" : "Not used yet"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    aria-label={`Revoke ${token.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(token.id)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : null}

        {revokedTokens.length > 0 ? (
          <Collapsible className="agent-access__revoked">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost">
                Revoked tokens · {revokedTokens.length}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ItemGroup>
                {revokedTokens.map((token) => (
                  <Item key={token.id} size="xs" variant="muted">
                    <ItemContent>
                      <ItemTitle>{token.name}</ItemTitle>
                      <ItemDescription>Revoked</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
    </Card>
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
  attention,
  calendars,
  domain,
  financeSetup,
  hosts,
  mailRules,
  mailSetup,
  profile,
  tasks,
}: {
  attention: Parameters<typeof mailAgentAccessReadiness>[0]["attention"];
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
      attention,
      hosts,
      profile,
      rules: mailRules,
      setup: mailSetup,
    });
  }
  if (domain === "calendar") {
    return calendarAgentAccessReadiness({ attention, calendars, hosts, profile });
  }
  if (domain === "tasks") {
    return taskAgentAccessReadiness({ attention, hosts, profile, tasks });
  }
  return financeAgentAccessReadiness({ attention, hosts, profile, setup: financeSetup });
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
