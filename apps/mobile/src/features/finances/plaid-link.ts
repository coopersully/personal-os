import { Platform } from "react-native";

/** What Plaid Link hands back once a person has signed in with their bank. */
export interface LinkedBank {
  publicToken: string;
  /** Either part may be missing; a blank or over-long value is never sent. */
  institution: string | null;
  institutionId: string | null;
  accounts: { name: string; mask: string | null }[];
}
export type BankLinkOutcome =
  | { kind: "linked"; bank: LinkedBank }
  /** The person closed Link; nothing was authorized. */
  | { kind: "cancelled" }
  /** Plaid or the bank ended the session with an error. */
  | { kind: "failed" };

/** The exchange route's limits; a longer or blank value would be refused after the bank is linked. */
const clamp = (text: string | undefined, max: number) => text?.trim().slice(0, max).trim() || null;

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
            institution: clamp(success.metadata.institution?.name, 160),
            institutionId: clamp(success.metadata.institution?.id, 256),
            accounts: success.metadata.accounts
              .flatMap((account) => {
                const name = clamp(account.name, 240);
                return name ? [{ name, mask: clamp(account.mask, 32) }] : [];
              })
              .slice(0, 100),
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
