import type { AccountSetupWorkspace } from "@personal-os/domain";
import { type WorkspaceId, workspaceIdentities } from "@/components/workspace-identity";
export const workspaceOptions: Array<{
  description: string;
  label: string;
  value: WorkspaceId & AccountSetupWorkspace;
}> = [
  {
    description: "See commitments across every calendar.",
    label: workspaceIdentities.calendar.label,
    value: "calendar",
  },
  {
    description: "Capture and plan locally from the start.",
    label: workspaceIdentities.tasks.label,
    value: "tasks",
  },
  {
    description: "Bring the conversations that need attention together.",
    label: workspaceIdentities.mail.label,
    value: "mail",
  },
  {
    description: "Track accounts, spending, and decisions.",
    label: workspaceIdentities.finances.label,
    value: "finances",
  },
];
