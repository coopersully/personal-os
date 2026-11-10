import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";

export type NativePushProviderResult =
  | "accepted"
  | "invalid_token"
  | "retryable"
  | "failed"
  | "uncertain";
export type NativePushPayload = {
  aps: { alert: { title: string; body: string }; sound: "default" };
  version: 1;
  kind: "finance";
  eventId: string;
  audience: string;
};
export type ApnsConfig = {
  enabled: boolean;
  teamId: string;
  keyId: string;
  privateKey: string;
  topic: string;
  environment: "production" | "sandbox";
};
export type NativePushTransport = (input: {
  token: string;
  id: string;
  payload: NativePushPayload;
}) => Promise<NativePushProviderResult>;

export function classifyApnsResponse(status: number, reason?: string): NativePushProviderResult {
  if (status === 200) return "accepted";
  if (status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")
    return "invalid_token";
  if (status === 429 || status === 500 || status === 503) return "retryable";
  return "failed";
}

/** Transport errors, including timeout, cannot prove whether APNs accepted a request. */
export function createApnsTransport(config: ApnsConfig): NativePushTransport {
  let cachedJwt: { value: string; created: number } | undefined;
  return async ({ token, id, payload }) => {
    if (!config.enabled) return "failed";
    const now = Math.floor(Date.now() / 1000);
    let jwt: string;
    try {
      if (!cachedJwt || now - cachedJwt.created >= 1800) {
        const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString(
          "base64url",
        );
        const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })).toString(
          "base64url",
        );
        const input = `${header}.${claims}`;
        const signature = sign("sha256", Buffer.from(input), {
          key: createPrivateKey(config.privateKey),
          dsaEncoding: "ieee-p1363",
        }).toString("base64url");
        cachedJwt = { value: `${input}.${signature}`, created: now };
      }
      jwt = cachedJwt.value;
    } catch {
      return "failed";
    }
    return new Promise<NativePushProviderResult>((resolve) => {
      const session = connect(
        config.environment === "production"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com",
      );
      let settled = false;
      const finish = (result: NativePushProviderResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        session.destroy();
        resolve(result);
      };
      const deadline = setTimeout(() => finish("uncertain"), 10_000);
      session.on("error", () => finish("uncertain"));
      session.on("connect", () => {
        if (settled) return;
        try {
          const stream = session.request({
            ":method": "POST",
            ":path": `/3/device/${token}`,
            authorization: `bearer ${jwt}`,
            "apns-topic": config.topic,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "apns-expiration": String(now + 3600),
            "apns-id": id,
            "content-type": "application/json",
          });
          let status = 0;
          let body = "";
          stream.on("response", (headers) => {
            status = Number(headers[":status"]);
          });
          stream.on("data", (chunk: Buffer) => {
            body += chunk.toString();
            if (body.length > 4096) finish("uncertain");
          });
          stream.on("error", () => finish("uncertain"));
          stream.on("end", () => {
            let reason: string | undefined;
            try {
              reason = (JSON.parse(body) as { reason?: string }).reason;
            } catch {
              /* Status still defines explicit rejection. */
            }
            finish(classifyApnsResponse(status, reason));
          });
          stream.end(JSON.stringify(payload));
        } catch {
          finish("uncertain");
        }
      });
    });
  };
}
