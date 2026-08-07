import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createGooglePubSubAuth, type GooglePubSubAuthError } from "./google-pubsub-auth.js";

const now = new Date("2026-08-06T12:00:00.000Z");
const audience = "https://api.example.com/v1/connectors/google/gmail/notifications";
const serviceAccount = "ilo-pubsub@example-project.iam.gserviceaccount.com";

describe("Google Pub/Sub authentication", () => {
  it("accepts only a current Google-signed token for the exact audience and service account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const verify = createGooglePubSubAuth({
      audience,
      jwks: createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "test-key", use: "sig" }] }),
      now: () => now,
      serviceAccount,
    });
    const token = await new SignJWT({ email: serviceAccount, email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setAudience(audience)
      .setExpirationTime(Math.floor(now.getTime() / 1_000) + 300)
      .setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setIssuer("https://accounts.google.com")
      .setSubject("pubsub-push")
      .sign(privateKey);

    await expect(verify(token)).resolves.toEqual({ subject: "pubsub-push" });
  });

  it.each([
    [
      "wrong audience",
      {
        aud: "https://attacker.example.com",
        email: serviceAccount,
        email_verified: true,
        iss: "https://accounts.google.com",
      },
    ],
    [
      "wrong identity",
      {
        aud: audience,
        email: "other@example.com",
        email_verified: true,
        iss: "https://accounts.google.com",
      },
    ],
    [
      "unverified identity",
      {
        aud: audience,
        email: serviceAccount,
        email_verified: false,
        iss: "https://accounts.google.com",
      },
    ],
    [
      "wrong issuer",
      {
        aud: audience,
        email: serviceAccount,
        email_verified: true,
        iss: "https://issuer.example.com",
      },
    ],
  ])("rejects %s", async (_label, claims) => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const verify = createGooglePubSubAuth({
      audience,
      jwks: createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "test-key", use: "sig" }] }),
      now: () => now,
      serviceAccount,
    });
    const token = await new SignJWT({
      email: claims.email,
      email_verified: claims.email_verified,
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setAudience(claims.aud)
      .setExpirationTime(Math.floor(now.getTime() / 1_000) + 300)
      .setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setIssuer(claims.iss)
      .sign(privateKey);

    await expect(verify(token)).rejects.toThrow("Pub/Sub authentication failed.");
  });

  it("rejects expired tokens and algorithm confusion without leaking verifier details", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const verify = createGooglePubSubAuth({
      audience,
      jwks: createLocalJWKSet({ keys: [{ ...jwk, alg: "ES256", kid: "test-key", use: "sig" }] }),
      now: () => now,
      serviceAccount,
    });
    const expired = await new SignJWT({ email: serviceAccount, email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setAudience(audience)
      .setExpirationTime(Math.floor(now.getTime() / 1_000) - 10)
      .setIssuer("https://accounts.google.com")
      .sign(privateKey);

    await expect(verify(expired)).rejects.toThrow("Pub/Sub authentication failed.");
    await expect(
      verify("eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ."),
    ).rejects.toThrow("Pub/Sub authentication failed.");
  });

  it("marks JWKS transport failures as retryable without exposing provider details", async () => {
    const verify = createGooglePubSubAuth({
      audience,
      jwks: async () => {
        throw new TypeError("private network failure");
      },
      now: () => now,
      serviceAccount,
    });

    await expect(verify("eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.e30.c2lnbmF0dXJl")).rejects.toEqual(
      expect.objectContaining<Partial<GooglePubSubAuthError>>({
        message: "Pub/Sub authentication failed.",
        retryable: true,
      }),
    );
  });
});
