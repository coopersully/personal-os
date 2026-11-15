import type { AssistantDomain } from "@personal-os/domain";
import { useState } from "react";
import { Section, SectionNote } from "../../components/forms/form-rows";
import { Choice, State } from "../tasks/ui";
import {
  areaLabel,
  scopeLabels,
  setupStatusLabels,
  stepOwnerLabels,
  stepStateLabels,
  supportLabels,
} from "./agent-copy";
import { DetailBlock } from "./agent-rows";
import { useSettingsResource } from "./data";
import { SettingsActionRow, SettingsDetailRow } from "./settings-row";

const scopeName = (scope: string) => (scopeLabels as Record<string, string>)[scope] ?? scope;
const version = (value: number | null) => (value === null ? "None" : `Version ${value}`);

/** How to connect an agent, and what agents can do in each workspace on this deployment. */
export function AgentConnectionGuide() {
  const guide = useSettingsResource("agent-guide", (api) => api.getAgentConnectionGuide());
  if (!guide.data)
    return (
      <Section title="Connect an agent">
        <State
          loading={guide.isPending}
          retry={guide.isError ? () => void guide.refetch() : undefined}
        />
      </Section>
    );
  return (
    <>
      <Section title="Connect an agent">
        <SectionNote>
          An agent is an AI assistant, such as Claude or Codex, that you let work in nohmi. Add this
          server address in your agent, then give it the two requests below. Press and hold any of
          them to copy.
        </SectionNote>
        <DetailBlock label="1. Server address (MCP)" lines={[guide.data.mcpUrl]} selectable />
        <DetailBlock
          label="2. Ask your agent to install the nohmi skill"
          lines={[guide.data.skill.installPrompt]}
          selectable
        />
        <DetailBlock
          label="3. Ask your agent to start setup"
          lines={[guide.data.skill.setupPrompt]}
          selectable
        />
      </Section>
      <Section title="What agents can help with">
        {guide.data.domains.length === 0 && (
          <SectionNote ink>Agents can’t help in any workspace yet.</SectionNote>
        )}
        {guide.data.domains.map((domain) => (
          <DetailBlock
            key={domain.domain}
            label={areaLabel(domain.domain)}
            lines={[
              supportLabels[domain.support] ?? domain.support.replaceAll("_", " "),
              `Reading needs “${scopeName(domain.readScope)}”. Changing needs “${scopeName(domain.writeScope)}”.`,
            ]}
          />
        ))}
      </Section>
    </>
  );
}

const setupDomains = ["tasks", "mail", "calendar", "finances"] as const;

/** One workspace's setup: what the agent may do there, how far setup is, and each step. */
export function AgentWorkspaceSetup() {
  const [domain, setDomain] = useState<AssistantDomain>("tasks");
  const status = useSettingsResource("agent-setup-status", (api) => api.getAssistantSetupStatus());
  const setup = useSettingsResource(`agent-setup-${domain}`, (api) =>
    api.getPersonalOsSetup({ domain }),
  );
  const readiness = status.data?.domains.find((item) => item.domain === domain);
  return (
    <>
      <Section title="Workspace setup">
        <SectionNote>
          Each workspace is set up separately. Choose one to see what your agent may do there and
          what is left.
        </SectionNote>
        <Choice
          label="Workspace"
          icon="grid"
          value={domain}
          options={setupDomains.map((value) => ({
            value,
            label: areaLabel(value),
            icon: value,
          }))}
          onChange={(value) => setDomain(value as AssistantDomain)}
        />
        {readiness && (
          <>
            <SettingsDetailRow label="Agent can read" value={readiness.canRead ? "Yes" : "No"} />
            <SettingsDetailRow
              label="Agent can make changes"
              value={readiness.canWrite ? "Yes" : "No"}
            />
            <SettingsDetailRow
              label="Approved guidance"
              value={version(readiness.approvedProfileVersion)}
            />
            <SettingsDetailRow
              label="Draft waiting for approval"
              value={version(readiness.pendingDraftVersion)}
            />
          </>
        )}
        {status.isError && (
          <SettingsActionRow
            label="Retry setup status"
            icon="refresh"
            onPress={() => void status.refetch()}
          />
        )}
      </Section>
      {setup.data ? (
        <>
          <Section title={`${areaLabel(domain)} progress`}>
            <SettingsDetailRow
              label="Status"
              value={setupStatusLabels[setup.data.status] ?? setup.data.status}
              attention={setup.data.status === "blocked"}
            />
            <SettingsDetailRow
              label="Steps done"
              value={`${setup.data.progress.completed} of ${setup.data.progress.total}`}
            />
            <DetailBlock label="Next" lines={[setup.data.nextAction]} />
          </Section>
          {setup.data.steps.map((step, index) => (
            <Section key={step.id} title={`Step ${index + 1}: ${step.title}`}>
              <SettingsDetailRow label="Status" value={stepStateLabels[step.state] ?? step.state} />
              <SettingsDetailRow
                label="Done by"
                value={stepOwnerLabels[step.owner] ?? step.owner}
              />
              <SectionNote>{step.description}</SectionNote>
              {step.instructions.length > 0 && (
                <DetailBlock label="Instructions" lines={step.instructions} selectable />
              )}
              {step.userAction && (
                <DetailBlock label="Your part" lines={[step.userAction]} selectable />
              )}
            </Section>
          ))}
        </>
      ) : (
        <Section title={`${areaLabel(domain)} progress`}>
          <State
            loading={setup.isPending}
            retry={setup.isError ? () => void setup.refetch() : undefined}
          />
        </Section>
      )}
    </>
  );
}
