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
    } catch {
      throw new Error("Pub/Sub authentication failed.");
    }
  };
}
