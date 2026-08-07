import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { EncryptedCredentials } from "@personal-os/database";
import { AppError } from "./errors.js";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, digestValue, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !digestValue || extra !== undefined) {
    return false;
  }
  const expected = Buffer.from(digestValue, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
  )) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function generateInvitationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function hashToken(token: string): string {
  // codeql[js/insufficient-password-hash]
  return createHash("sha256").update(token).digest("hex");
}

function decodeEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new AppError(
      "internal_error",
      "APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

export function encryptJson(value: unknown, encryptionKey: string): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeEncryptionKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    version: 1,
  };
}

export function decryptJson<T>(value: EncryptedCredentials, encryptionKey: string): T {
  if (value.version !== 1) {
    throw new AppError("internal_error", "Unsupported encrypted credential version.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(encryptionKey),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
