import { Platform } from "react-native";

/** What Plaid Link hands back once a person has signed in with their bank. */
export interface LinkedBank {
  publicToken: string;
  institution: { id: string; name: string } | null;
  accounts: { name: string; mask: string | null }[];
}
export type BankLinkOutcome =
  | { kind: "linked"; bank: LinkedBank }
  /** The person closed Link; nothing was authorized. */
  | { kind: "cancelled" }
  /** Plaid or the bank ended the session with an error. */
  | { kind: "failed" };

/** Plaid's native Link exists only in the iPhone build. */
export function canLinkBank() {
  return Platform.OS === "ios";
}

/**
 * Presents Plaid's native Link for a server-issued link token and resolves once it closes.
 * Bank credentials are typed into Plaid's own screens and never reach nohmi. The module is
 * loaded on demand so screens and tests do not need the native build.
 */
export async function openBankLink(token: string): Promise<BankLinkOutcome> {
  const { createPlaidLinkSession } = await import("react-native-plaid-link-sdk");
  return new Promise<BankLinkOutcome>((resolve, reject) => {
    createPlaidLinkSession({
      token,
      onSuccess: (success) =>
        resolve({
          kind: "linked",
          bank: {
            publicToken: success.publicToken,
            institution: success.metadata.institution
              ? {
                  id: success.metadata.institution.id,
                  name: success.metadata.institution.name,
                }
              : null,
            accounts: success.metadata.accounts.flatMap((account) =>
              account.name?.trim()
                ? [{ name: account.name.trim(), mask: account.mask?.trim() || null }]
                : [],
            ),
          },
        }),
      // Plaid's error text and codes stay on the device; only the outcome is used.
      onExit: (exit) => resolve(exit.error ? { kind: "failed" } : { kind: "cancelled" }),
      onEvent: () => undefined,
    })
      .then((session) => session.open())
      .catch(reject);
  });
}
