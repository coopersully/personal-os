import type { AccessScope, AssistantDomain } from "@personal-os/domain";
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

const domainOptions: Array<{
  domain: AssistantDomain;
  label: string;
  shortLabel: string;
}> = [
  { domain: "mail", label: "Mail", shortLabel: "Mail" },
  { domain: "calendar", label: "Calendar", shortLabel: "Calendar" },
  { domain: "reminders", label: "Reminders", shortLabel: "Reminders" },
  { domain: "tasks", label: "Tasks", shortLabel: "Tasks" },
  { domain: "finances", label: "Finances", shortLabel: "Finances" },
  { domain: "goals", label: "Goals", shortLabel: "Goals" },
];

const scopeLabels: Record<AccessScope, string> = {
  "audit:read": "Read activity",
  "automations:read": "Read automations",
  "automations:write": "Run automations",
  "bookmarks:read": "Read X bookmarks",
  "calendar:read": "Read calendar",
  "calendar:write": "Manage calendar",
  "finances:read": "Read finances",
  "finances:write": "Manage finances",
  "goals:read": "Read goals & motives",
  "goals:write": "Manage goals & motives",
  "mail:read": "Read mail",
  "mail:write": "Manage mail",
  "reminders:read": "Read reminders",
  "reminders:write": "Manage reminders",
  "tasks:read": "Read tasks",
  "tasks:write": "Manage tasks",
};

const tokenPresets: Array<{ description: string; name: string; scopes: AccessScope[] }> = [
  {
    description: "Learn your inbox preferences, preview rules, and run approved Mail rules.",
    name: "Mail setup",
    scopes: ["mail:read", "mail:write"],
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
  const [selectedDomain, setSelectedDomain] = useState<AssistantDomain>("mail");
  const guide = useQuery({
    queryFn: api.getAgentConnectionGuide,
    queryKey: ["agent-connection-guide"],
  });
  const setup = useQuery({
    queryFn: api.getAssistantSetupStatus,
    queryKey: ["assistant-setup-status"],
  });
  const connectors = useQuery({ queryFn: api.listConnectors, queryKey: ["connectors"] });
  const rules = useQuery({ queryFn: api.listMailRules, queryKey: ["mail-rules"] });
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

  const activeTokens = (tokens.data ?? []).filter((token) => token.revokedAt === null);
  const connectedAgentCount = activeTokens.length + (oauthClients.data?.length ?? 0);
  const mailSources = (connectors.data ?? []).filter((account) => account.mailEnabled);
  const mailProfile = setup.data?.domains.find((item) => item.domain === "mail");
  const activeRules = (rules.data ?? []).filter(
    (rule) => rule.enabled && rule.policy === "approved_rule",
  );
  const selectedGuide = guide.data?.domains.find((item) => item.domain === selectedDomain);
  const selectedProfile = setup.data?.domains.find((item) => item.domain === selectedDomain);
  const selectedLabel =
    domainOptions.find((item) => item.domain === selectedDomain)?.label ?? selectedDomain;
  const setupPrompt = domainSetupPrompt(
    selectedDomain,
    selectedLabel,
    guide.data?.skill.invocation ?? "$ilo-setup",
  );
  const blockingError =
    guide.error ??
    setup.error ??
    connectors.error ??
    rules.error ??
    tokens.error ??
    oauthClients.error;

  return (
    <div className="agent-access">
      <Card className="settings-section agent-access__hero">
        <CardHeader>
          <CardTitle>
            <h2>Connect an agent</h2>
          </CardTitle>
          <CardDescription>
            Give any MCP-compatible agent scoped Ilo access, then teach it how you want each part of
            your life handled.
          </CardDescription>
          <CardAction>
            <Badge variant={connectedAgentCount > 0 ? "default" : "secondary"}>
              {connectedAgentCount > 0 ? `${connectedAgentCount} connected` : "Not connected"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="settings-section__body agent-access__body">
          {blockingError ? (
            <Alert variant="destructive">
              <X />
              <AlertTitle>Agent setup could not be loaded</AlertTitle>
              <AlertDescription>{errorMessage(blockingError)}</AlertDescription>
            </Alert>
          ) : null}

          <ItemGroup className="agent-access__readiness">
            <ReadinessItem
              complete={mailSources.length > 0}
              description={
                mailSources.length > 0
                  ? `${mailSources.length} Mail account${mailSources.length === 1 ? "" : "s"} ready for setup`
                  : "Connect a Mail account before asking an agent to learn your inbox."
              }
              title="Connected material"
            >
              {mailSources.length === 0 ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/settings?section=connections">Connect Mail</Link>
                </Button>
              ) : null}
            </ReadinessItem>
            <ReadinessItem
              complete={connectedAgentCount > 0}
              description={
                connectedAgentCount > 0
                  ? "At least one host can access Ilo."
                  : "Add the MCP URL to your agent host and authorize access."
              }
              title="Agent connection"
            />
            <ReadinessItem
              complete={mailProfile?.profileStatus === "active"}
              description={
                mailProfile?.profileStatus === "active"
                  ? `${activeRules.length} active approved Mail rule${activeRules.length === 1 ? "" : "s"}`
                  : mailProfile?.profileStatus === "draft"
                    ? "Your Mail profile is drafted and waiting for review."
                    : "Run the guided interview to teach Ilo what signal means to you."
              }
              title="Mail preferences"
            />
          </ItemGroup>

          <div className="agent-access__steps">
            <ConnectionStep
              description="Paste this URL into any host that supports remote MCP. Ilo will handle sign-in and consent through OAuth when the host supports it."
              number="1"
              title="Add Ilo as an MCP connector"
            >
              <CopyInput
                label="Ilo MCP URL"
                loading={guide.isPending}
                value={guide.data?.mcpUrl ?? ""}
              />
            </ConnectionStep>

            <ConnectionStep
              description="The skill gives the agent the interview, profile, preview, approval, and recovery workflow. Personal preferences stay in Ilo."
              number="2"
              title="Install the guided setup skill"
            >
              <CopyPrompt
                copyLabel="Copy skill install request"
                loading={guide.isPending}
                value={guide.data?.skill.installPrompt ?? ""}
              />
              {guide.data ? (
                <Button asChild size="sm" variant="ghost">
                  <a href={guide.data.skill.sourceUrl} rel="noreferrer" target="_blank">
                    View skill source
                    <ExternalLink data-icon="inline-end" />
                  </a>
                </Button>
              ) : null}
            </ConnectionStep>

            <ConnectionStep
              description="Choose a domain, copy the prompt, and paste it into the same agent conversation. Mail includes exact rule previews and approved automatic actions."
              number="3"
              title="Start the shortest useful setup"
            >
              <FieldSet>
                <FieldLegend variant="label">Set up first</FieldLegend>
                <ToggleGroup
                  aria-label="Domain to set up"
                  className="agent-access__domains"
                  onValueChange={(value) => {
                    if (value) setSelectedDomain(value as AssistantDomain);
                  }}
                  type="single"
                  value={selectedDomain}
                  variant="outline"
                >
                  {domainOptions.map((option) => (
                    <ToggleGroupItem key={option.domain} value={option.domain}>
                      {option.shortLabel}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
              <Alert role="status" variant="info">
                <ShieldCheck />
                <AlertTitle>
                  {selectedGuide?.support === "executable_rules"
                    ? "Profiles, previews, and approved rules"
                    : "Preferences and attention items"}
                </AlertTitle>
                <AlertDescription>
                  {selectedGuide?.support === "executable_rules"
                    ? "Mail is the first full automation path. New rules begin as drafts, preview exact recent matches, and should only be activated after you accept the summary."
                    : `${selectedLabel} uses the same durable profile and attention structure. Executable domain rules are not available yet.`}
                  {selectedProfile?.profileStatus
                    ? ` Your current profile is ${selectedProfile.profileStatus}.`
                    : ""}
                </AlertDescription>
              </Alert>
              <CopyPrompt copyLabel={`Copy ${selectedLabel} setup prompt`} value={setupPrompt} />
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

function ReadinessItem({
  children,
  complete,
  description,
  title,
}: {
  children?: React.ReactNode;
  complete: boolean;
  description: string;
  title: string;
}) {
  return (
    <Item size="sm" variant="muted">
      <ItemMedia variant="icon">
        {complete ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      {children ? <ItemActions>{children}</ItemActions> : null}
    </Item>
  );
}

function ConnectionStep({
  children,
  description,
  number,
  title,
}: {
  children: React.ReactNode;
  description: string;
  number: string;
  title: string;
}) {
  return (
    <section className="agent-access__step">
      <div className="agent-access__step-number" aria-hidden="true">
        {number}
      </div>
      <div className="agent-access__step-content">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {children}
      </div>
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
  loading = false,
  value,
}: {
  copyLabel: string;
  loading?: boolean;
  value: string;
}) {
  return (
    <Field>
      <Textarea
        aria-label={copyLabel.replace("Copy ", "")}
        className="agent-access__prompt"
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
  const [scopes, setScopes] = useState<AccessScope[]>(tokenPresets[0]?.scopes ?? []);
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

function domainSetupPrompt(domain: AssistantDomain, label: string, invocation: string): string {
  if (domain === "mail") {
    return `Use ${invocation} to set up my Mail in Ilo. Inspect my connected mailboxes and a small recent sample, ask the shortest useful interview, save a draft profile, preview exact rule matches, and do not activate anything until I accept the summary.`;
  }
  return `Use ${invocation} to set up my ${label} in Ilo. Inspect the available sources and any existing profile, ask the shortest useful interview, save my preferences as a draft, and clearly separate what Ilo can do now from behavior that is not yet automated.`;
}

async function copyToClipboard(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}
