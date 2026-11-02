import type { AgentAccount } from "@personal-os/domain";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export const agentPlatformLabels = {
  claude: "Claude",
  codex: "Codex",
  other: "Other",
  unknown: "Unknown platform",
} as const;

// Version 1: FNV-1a over the versioned seed, then a mirrored 5 × 5 pattern.
// Deliberately independent of mutable profile names and platform labels.
export function agentAvatarCells(seed: string, version: 1): boolean[] {
  let hash = 2166136261;
  for (const character of `${version}:${seed}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return Array.from({ length: 25 }, (_, index) => {
    const column = index % 5;
    const bit = Math.floor(index / 5) * 3 + Math.min(column, 4 - column);
    return bit === 7 || ((hash >>> bit) & 1) === 1;
  });
}

export function AgentAvatar({ account }: { account: AgentAccount }) {
  return (
    <Avatar aria-hidden="true">
      <AvatarFallback>
        <span className="grid size-5 grid-cols-5 grid-rows-5 overflow-hidden rounded-sm">
          {agentAvatarCells(account.avatarSeed, account.avatarVersion).map((filled, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Fixed immutable grid positions are cell identities.
            <span key={`cell-${index}`} className={filled ? "bg-current" : "bg-transparent"} />
          ))}
        </span>
      </AvatarFallback>
    </Avatar>
  );
}

export function AgentIdentity({ account }: { account: AgentAccount }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AgentAvatar account={account} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{account.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {agentPlatformLabels[account.platform]}
          {account.accountLabel ? ` · ${account.accountLabel}` : ""}
        </span>
      </span>
    </span>
  );
}
