import type {
  AccessScope,
  AgentDomainSupport,
  AssistantDomain,
  AssistantSetupStatus,
  AttentionItem,
} from "@personal-os/domain";

export type SetupDomain = Extract<AssistantDomain, "mail" | "finances" | "calendar" | "tasks">;
export type DomainSupport = AgentDomainSupport["support"];
export type DomainSetupStatus = AssistantSetupStatus["domains"][number];

export type Loadable<T> =
  | { state: "loading" }
  | { state: "unavailable" }
  | { data: T; state: "ready" };

export type ConnectedHostAuthority = {
  name: string;
  scopes: readonly AccessScope[];
};

export type DomainReadinessItem = {
  action?: { label: string; to: string };
  complete: boolean;
  description: string;
  nextStep?: string;
  title: string;
};

export type DomainCapability = {
  description: string;
  setupPrompt: string | null;
  title: string;
};

export const setupDomainOptions: Array<{
  domain: SetupDomain;
  label: string;
  shortLabel: string;
}> = [
  { domain: "mail", label: "Mail", shortLabel: "Mail" },
  { domain: "finances", label: "Finances", shortLabel: "Finances" },
  { domain: "calendar", label: "Calendar", shortLabel: "Calendar" },
  { domain: "tasks", label: "Tasks", shortLabel: "Tasks" },
];

export const setupDomainLabels: Record<SetupDomain, string> = Object.fromEntries(
  setupDomainOptions.map((option) => [option.domain, option.label]),
) as Record<SetupDomain, string>;

export function mapLoadable<T, U>(resource: Loadable<T>, map: (value: T) => U): Loadable<U> {
  return resource.state === "ready" ? { data: map(resource.data), state: "ready" } : resource;
}

export function profileReadiness(
  label: string,
  profile: Loadable<DomainSetupStatus | undefined>,
): DomainReadinessItem {
  if (profile.state === "loading") {
    return loadingReadiness(`${label} preferences`, `${label} preferences are loading.`);
  }
  if (profile.state === "unavailable") {
    return unavailableReadiness(
      `${label} preferences`,
      `${label} preferences are unavailable until setup status can be loaded.`,
    );
  }
  if (profile.data?.approvedProfileStatus === "active") {
    return {
      complete: true,
      description: profile.data.pendingDraftVersion
        ? `Approved guidance v${profile.data.approvedProfileVersion} is active; draft v${profile.data.pendingDraftVersion} awaits signed-in review.`
        : `Approved guidance v${profile.data.approvedProfileVersion} is active.`,
      title: `${label} preferences`,
    };
  }
  if (profile.data?.profileStatus === "active") {
    return {
      complete: true,
      description: `Profile v${profile.data.profileVersion} is active.`,
      title: `${label} preferences`,
    };
  }
  if (profile.data?.profileStatus === "draft") {
    return {
      complete: false,
      description: `Draft profile v${profile.data.profileVersion} is waiting for review.`,
      nextStep: `Review the draft ${label} profile`,
      title: `${label} preferences`,
    };
  }
  return {
    complete: false,
    description: `Run the guided interview to teach Ilo your ${label} preferences.`,
    nextStep: `Teach Ilo your ${label} preferences`,
    title: `${label} preferences`,
  };
}

export function attentionReadiness(
  label: string,
  items: Loadable<AttentionItem[]>,
): DomainReadinessItem {
  if (items.state === "loading") {
    return loadingReadiness(`${label} attention`, `${label} attention is loading.`);
  }
  if (items.state === "unavailable") {
    return unavailableReadiness(
      `${label} attention`,
      `${label} attention is unavailable until Ilo can load it.`,
    );
  }
  return {
    complete: true,
    description:
      items.data.length === 0
        ? `No open ${label} attention items.`
        : `${items.data.length}${items.data.length === 100 ? "+" : ""} open ${label} attention item${items.data.length === 1 ? "" : "s"}.`,
    title: `${label} attention`,
  };
}

export function hostPermissionReadiness({
  hosts,
  label,
  readScope,
  writeCapability,
  writeScope,
}: {
  hosts: Loadable<ConnectedHostAuthority[]>;
  label: string;
  readScope: AccessScope;
  writeCapability: string;
  writeScope: AccessScope;
}): DomainReadinessItem {
  if (hosts.state === "loading") {
    return loadingReadiness(`${label} agent access`, "Connected-host permissions are loading.");
  }
  if (hosts.state === "unavailable") {
    return unavailableReadiness(
      `${label} agent access`,
      "Connected-host permissions are unavailable, so Ilo cannot claim agent access.",
    );
  }
  const readers = hosts.data.filter((host) => host.scopes.includes(readScope));
  const writers = hosts.data.filter((host) => host.scopes.includes(writeScope));
  if (readers.length === 0) {
    return {
      complete: false,
      description: `No connected host has ${label} read permission.`,
      nextStep: `Connect an agent with ${label} read access`,
      title: `${label} agent access`,
    };
  }
  return {
    complete: writers.length > 0,
    description:
      writers.length > 0
        ? `${readers.length} connected host${readers.length === 1 ? "" : "s"} can read ${label}; ${writers.length} can ${writeCapability}.`
        : `${readers.length} connected host${readers.length === 1 ? "" : "s"} can read ${label}; none has ${label} write permission.`,
    ...(writers.length === 0 ? { nextStep: `Give a connected agent ${label} write access` } : {}),
    title: `${label} agent access`,
  };
}

export function loadingReadiness(title: string, description: string): DomainReadinessItem {
  return { complete: false, description, title };
}

export function unavailableReadiness(title: string, description: string): DomainReadinessItem {
  return { complete: false, description, title };
}

export function unsupportedCapability(label: string): DomainCapability {
  return {
    description: `${label} guided setup is not published by this Ilo deployment.`,
    setupPrompt: null,
    title: `${label} setup unavailable`,
  };
}
