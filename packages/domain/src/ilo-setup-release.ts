import { z } from "zod";
import { semanticVersionSchema } from "./common.js";
import releaseManifest from "./ilo-setup-release.json" with { type: "json" };

const iloSetupReleaseSchema = z.object({
  legacySourceUrl: z.url(),
  revision: z.string().trim().min(1).max(128),
  sourceUrl: z.url(),
  version: semanticVersionSchema,
});

/** The single repository-owned identity for the official guided-setup artifact. */
export const iloSetupRelease = iloSetupReleaseSchema.parse(releaseManifest);
export type IloSetupRelease = z.infer<typeof iloSetupReleaseSchema>;
