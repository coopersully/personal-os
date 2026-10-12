import type { ConnectedAccountHealth } from "@personal-os/domain";
import { connectionHealth } from "@/features/connections/health";
export function attentionConnections(
  accounts: Array<{ id: string; label: string; health: ConnectedAccountHealth }>,
) {
  return [
    ...new Map(
      accounts
        .filter((account) =>
          ["reconnect", "service_attention"].includes(connectionHealth(account).state),
        )
        .map((account) => [account.id, account]),
    ).values(),
  ];
}
