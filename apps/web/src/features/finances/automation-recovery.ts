import type { FinanceConversationReadiness } from "@personal-os/domain";

export const financeConversationRecovery: Record<
  FinanceConversationReadiness["reason"],
  { cause: string; action: string; href: string }
> = {
  ready: { cause: "Chat is ready.", action: "Open conversation", href: "/finances/chat" },
  registration_missing: {
    cause: "No automation is registered for Chat.",
    action: "Set up automation",
    href: "/finances/automations",
  },
  registration_paused: {
    cause:
      "Your automation registration is paused. Resume the job in its host and confirm its registration there.",
    action: "Review host setup",
    href: "/finances/automations",
  },
  registration_revoked: {
    cause:
      "The automation registration was removed. A new registration needs its own message verification.",
    action: "Register automation",
    href: "/finances/automations",
  },
  connection_missing: {
    cause: "The original host connection is unavailable.",
    action: "Connect host",
    href: "/settings?section=connections",
  },
  connection_disconnected: {
    cause: "The original host connection is disconnected or expired.",
    action: "Reconnect host",
    href: "/settings?section=connections",
  },
  connection_revoked: {
    cause:
      "The original host connection was revoked. A replacement must be registered and verified.",
    action: "Reconnect host",
    href: "/settings?section=connections",
  },
  execution_not_authorized: {
    cause: "Your host does not have Finance execution permission.",
    action: "Review host permissions",
    href: "/settings?section=workspace-access",
  },
  message_protocol_unavailable: {
    cause: "Your host has not demonstrated Finance messaging support.",
    action: "Review message verification",
    href: "/finances/automations",
  },
  challenge_required: {
    cause:
      "Your host must fetch, acknowledge and respond to a verification challenge before Chat can send.",
    action: "Verify message access",
    href: "/finances/automations",
  },
  challenge_expired: {
    cause: "Message verification expired. Your host must complete a new challenge.",
    action: "Verify message access again",
    href: "/finances/automations",
  },
  protocol_upgrade_required: {
    cause: "Your host’s messaging support needs an update, then a new verification challenge.",
    action: "Review message verification",
    href: "/finances/automations",
  },
};

export function financeRecoveryHref(href: string, returnTo: string) {
  const safeReturn = /^\/finances\/chat(?:[?#]|$)/.test(returnTo) ? returnTo : "/finances/chat";
  return `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(safeReturn)}`;
}
