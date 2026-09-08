import twilio from "twilio";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
  verifyServiceSid: string;
};

export type TwilioMessage = {
  numSegments?: string | null;
  sid: string;
  status: string;
};

export type TwilioConnector = {
  checkVerification: (
    verificationSid: string,
    code: string,
  ) => Promise<"approved" | "pending" | "failed">;
  sendMessage: (input: {
    body: string;
    statusCallback?: string;
    to: string;
  }) => Promise<TwilioMessage>;
  getMessageOccurredAt: (messageSid: string) => Promise<Date>;
  startVerification: (to: string) => Promise<{ sid: string; status: string }>;
  validateWebhook: (signature: string, url: string, parameters: Record<string, string>) => boolean;
};

/** Create the bounded Twilio Verify and Programmable Messaging adapter used by the API. */
export function createTwilioConnector(config: TwilioConfig): TwilioConnector {
  const client = twilio(config.accountSid, config.authToken, { timeout: 15_000 });
  return {
    async checkVerification(verificationSid, code) {
      const check = await client.verify.v2
        .services(config.verifyServiceSid)
        .verificationChecks.create({ code, verificationSid });
      return check.status === "approved"
        ? "approved"
        : check.status === "pending"
          ? "pending"
          : "failed";
    },
    async sendMessage(input) {
      return client.messages.create({
        body: input.body,
        messagingServiceSid: config.messagingServiceSid,
        ...(input.statusCallback ? { statusCallback: input.statusCallback } : {}),
        to: input.to,
      });
    },
    async getMessageOccurredAt(messageSid) {
      const message = await client.messages(messageSid).fetch();
      return message.dateCreated;
    },
    async startVerification(to) {
      const verification = await client.verify.v2
        .services(config.verifyServiceSid)
        .verifications.create({ channel: "sms", to });
      return { sid: verification.sid, status: verification.status };
    },
    validateWebhook(signature, url, parameters) {
      return twilio.validateRequest(config.authToken, signature, url, parameters);
    },
  };
}

const gsmBasic = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const gsmExtended = new Set("^{}\\[~]|€");

/** Estimate Twilio's SMS parts with toll-free concatenation limits and Smart Encoding enabled. */
export function estimateTwilioSegments(body: string): {
  encoding: "GSM-7" | "UCS-2";
  segments: number;
  units: number;
} {
  let gsmUnits = 0;
  let isGsm = true;
  for (const character of body) {
    if (gsmBasic.has(character)) gsmUnits += 1;
    else if (gsmExtended.has(character)) gsmUnits += 2;
    else isGsm = false;
  }
  if (isGsm) {
    return {
      encoding: "GSM-7",
      segments: gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 152),
      units: gsmUnits,
    };
  }
  const units = [...body].reduce(
    (total, character) => total + ((character.codePointAt(0) ?? 0) > 0xffff ? 2 : 1),
    0,
  );
  return { encoding: "UCS-2", segments: units <= 70 ? 1 : Math.ceil(units / 66), units };
}
