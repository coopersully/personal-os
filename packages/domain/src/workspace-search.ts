import { z } from "zod";

export const searchableWorkspaceSchema = z.enum(["calendar", "tasks", "mail", "finances"]);
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

export const taskSortPreferenceSchema = z.enum([
  "default",
  "date",
  "reserved",
  "priority",
  "newest",
  "oldest",
  "title",
  "estimate",
]);
export const taskGroupPreferenceSchema = z.enum(["none", "date", "list", "project"]);
export const taskRowDetailsPreferenceSchema = z.array(z.enum(["estimate", "tags", "notes"])).max(3);
export const taskContainerSortPreferenceSchema = z.enum(["updated", "name", "newest", "target"]);

export const workspacePreferencesSchema = z.object({
  taskSort: taskSortPreferenceSchema.optional(),
  taskGroup: taskGroupPreferenceSchema.optional(),
  taskRowDetails: taskRowDetailsPreferenceSchema.optional(),
  taskContainerSort: taskContainerSortPreferenceSchema.optional(),
  pinnedListIds: z.array(z.uuid()).max(100).default([]),
  pinnedProjectIds: z.array(z.uuid()).max(100).default([]),
  includeArchivedInSearch: z.boolean().default(true),
  calendarView: z.enum(["auto", "day", "week", "month"]).default("auto"),
  showWeekends: z.boolean().default(true),
  autoFollowToday: z.boolean().default(true),
  snapToFollow: z.boolean().default(true),
  followSnapSensitivity: z.enum(["precise", "balanced", "generous"]).default("balanced"),
});
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;
export type WorkspaceSettings = {
  workspace: SearchableWorkspace;
  revision: number;
  preferences: WorkspacePreferences;
};
export const updateWorkspaceSettingsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    // PATCH fields must not carry read-time defaults: omitted preferences stay unchanged.
    preferences: z
      .object({
        taskSort: taskSortPreferenceSchema.optional(),
        taskGroup: taskGroupPreferenceSchema.optional(),
        taskRowDetails: taskRowDetailsPreferenceSchema.optional(),
        taskContainerSort: taskContainerSortPreferenceSchema.optional(),
        pinnedListIds: workspacePreferencesSchema.shape.pinnedListIds.removeDefault().optional(),
        pinnedProjectIds: workspacePreferencesSchema.shape.pinnedProjectIds
          .removeDefault()
          .optional(),
        includeArchivedInSearch: workspacePreferencesSchema.shape.includeArchivedInSearch
          .removeDefault()
          .optional(),
        calendarView: workspacePreferencesSchema.shape.calendarView.removeDefault().optional(),
        showWeekends: workspacePreferencesSchema.shape.showWeekends.removeDefault().optional(),
        autoFollowToday: workspacePreferencesSchema.shape.autoFollowToday
          .removeDefault()
          .optional(),
        snapToFollow: workspacePreferencesSchema.shape.snapToFollow.removeDefault().optional(),
        followSnapSensitivity: workspacePreferencesSchema.shape.followSnapSensitivity
          .removeDefault()
          .optional(),
      })
      .strict(),
  })
  .strict();
export type UpdateWorkspaceSettings = z.infer<typeof updateWorkspaceSettingsSchema>;
