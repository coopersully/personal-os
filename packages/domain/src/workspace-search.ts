import { z } from "zod";
import { workspaceSchema } from "./workspace-settings.js";

export const searchableWorkspaceSchema = workspaceSchema;
export type SearchableWorkspace = z.infer<typeof searchableWorkspaceSchema>;
export const workspaceSearchQuerySchema = z.object({
  kind: z.enum(["all", "content", "reviews"]).default("all"),
  q: z.string().trim().min(1).max(200),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeArchived: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});
export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuerySchema>;
export type WorkspaceSearchResult = {
  id: string;
  kind: string;
  title: string;
  preview: string;
  href: string;
  state: string | null;
};
export type WorkspaceSearchPage = {
  items: WorkspaceSearchResult[];
  nextOffset: number | null;
  coverage: "synced";
  unavailable?: Array<"reviews">;
};
