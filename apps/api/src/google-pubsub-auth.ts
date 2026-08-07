import { createRemoteJWKSet, type JWTVerifyGetKey, type JWTVerifyResult, jwtVerify } from "jose";

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  cooldownDuration: 30_000,
  timeoutDuration: 5_000,
});

type Options = {
  audience: string;
  jwks?: JWTVerifyGetKey;
  now?: () => Date;
  serviceAccount: string;
};

export type GooglePubSubIdentity = {
  subject: string | null;
};

export class GooglePubSubAuthError extends Error {
  public constructor(public readonly retryable: boolean) {
    super("Pub/Sub authentication failed.");
    this.name = "GooglePubSubAuthError";
  }
}

function isRetryableVerifierError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_FETCH_FAILED";
}

export function createGooglePubSubAuth({
  audience,
  jwks = googleJwks,
  now = () => new Date(),
  serviceAccount,
}: Options): (token: string) => Promise<GooglePubSubIdentity> {
  return async (token) => {
    try {
      const result: JWTVerifyResult = await jwtVerify(token, jwks, {
        algorithms: ["ES256", "RS256"],
        audience,
        clockTolerance: 5,
        currentDate: now(),
        issuer: ["accounts.google.com", "https://accounts.google.com"],
      });
      if (result.payload.email !== serviceAccount || result.payload.email_verified !== true) {
        throw new Error("identity_mismatch");
      }
      return { subject: result.payload.sub ?? null };
    } catch (error) {
      throw new GooglePubSubAuthError(isRetryableVerifierError(error));
    }
  };
}
