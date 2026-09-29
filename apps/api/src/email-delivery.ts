import { providerFetch } from "@personal-os/connectors";
import { AppError } from "./errors.js";

export type EmailMessage = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

export type EmailDelivery = {
  send: (message: EmailMessage) => Promise<void>;
};

type EmailDeliveryOptions = {
  from: string;
  log?: (entry: { event: "email_delivery_skipped"; recipient: string; subject: string }) => void;
  resendApiKey: string;
};

/** Sends transactional account email through Resend, or safely skips it in local development. */
export function createEmailDelivery(options: EmailDeliveryOptions): EmailDelivery {
  return {
    async send(message) {
      if (!options.from || !options.resendApiKey) {
        options.log?.({
          event: "email_delivery_skipped",
          recipient: message.to,
          subject: message.subject,
        });
        return;
      }
      const response = await providerFetch(globalThis.fetch, "https://api.resend.com/emails", {
        body: JSON.stringify({
          from: options.from,
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: [message.to],
        }),
        headers: {
          authorization: `Bearer ${options.resendApiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new AppError("service_unavailable", "Account email could not be delivered.");
      }
    },
  };
}
