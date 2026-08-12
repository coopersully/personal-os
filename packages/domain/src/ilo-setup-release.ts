import { z } from "zod";
import { semanticVersionSchema } from "./common.js";
import releaseManifest from "./ilo-setup-release.json" with { type: "json" };

const iloSetupReleaseSchema = z.object({
  legacySourcePaths: z.array(z.string().startsWith("/")).min(1),
  legacySourceUrls: z.array(z.url()).min(1),
  legacyRevisions: z.array(z.string().trim().min(1).max(128)),
  legacyVersions: z.array(semanticVersionSchema),
  revision: z.string().trim().min(1).max(128),
  sourcePath: z.string().startsWith("/").endsWith("/SKILL.md"),
  version: semanticVersionSchema,
});

/** The single repository-owned identity for the official guided-setup artifact. */
export const iloSetupRelease = iloSetupReleaseSchema.parse(releaseManifest);
export type IloSetupRelease = z.infer<typeof iloSetupReleaseSchema>;
