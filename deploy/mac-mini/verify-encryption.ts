import { readFileSync } from "node:fs";
import type { EncryptedCredentials } from "@personal-os/database";
import { decryptJson } from "../../apps/api/src/security.js";

// Existing crypto implementation only: no app, scheduler or provider starts here.
// Called by the private database rehearsal; never print decrypted data.
try {
  const source = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
  const lines = readFileSync(process.argv[3] ?? "", "utf8").trim();
  const records = lines ? lines.split("\n") : [];
  for (const record of records) {
    decryptJson(JSON.parse(record) as EncryptedCredentials, source.APP_ENCRYPTION_KEY);
  }
  console.log(records.length);
} catch {
  console.error("Restored credential verification failed; no decrypted values logged.");
  process.exitCode = 1;
}
