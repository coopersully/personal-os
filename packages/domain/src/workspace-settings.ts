import { z } from "zod";

export const workspaceSchema = z.enum(["calendar", "tasks", "mail", "finances"]);
export type Workspace = z.infer<typeof workspaceSchema>;

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
export const taskRowDetailsPreferenceSchema = z
  .array(z.enum(["estimate", "tags", "notes"]))
  .max(3)
  .refine((values) => new Set(values).size === values.length, "Choose each detail once.");
export const taskContainerSortPreferenceSchema = z.enum(["updated", "name", "newest", "target"]);
export const mailListDensityPreferenceSchema = z.enum(["compact", "comfortable", "expanded"]);
export const mailListWidthPreferenceSchema = z.number().finite().min(5).max(95);
export const financeTransactionViewPreferenceSchema = z.enum(["table", "cards"]);
export const financeTransactionGroupPreferenceSchema = z.enum([
  "none",
  "date",
  "category",
  "merchant",
  "direction",
  "posting",
]);
const ids = z
  .array(z.uuid())
  .max(100)
  .refine((values) => new Set(values).size === values.length, "Choose each item once.");
const common = { includeArchivedInSearch: z.boolean().default(true) };
export const workspacePreferenceSchemas = {
  calendar: z
    .object({
      ...common,
      calendarView: z.enum(["auto", "day", "week", "month"]).default("auto"),
      showWeekends: z.boolean().default(true),
      autoFollowToday: z.boolean().default(true),
      snapToFollow: z.boolean().default(true),
      followSnapSensitivity: z.enum(["precise", "balanced", "generous"]).default("balanced"),
      weekStartsOn: z.enum(["sunday", "monday"]).default("sunday"),
      defaultEventDurationMinutes: z.number().int().min(5).max(1440).default(60),
    })
    .strict(),
  tasks: z
    .object({
      ...common,
      taskSort: taskSortPreferenceSchema.default("default"),
      taskGroup: taskGroupPreferenceSchema.default("none"),
      taskRowDetails: taskRowDetailsPreferenceSchema.default(["estimate"]),
      taskContainerSort: taskContainerSortPreferenceSchema.default("updated"),
      pinnedListIds: ids.default([]),
      pinnedProjectIds: ids.default([]),
      defaultCaptureListId: z.uuid().nullable().default(null),
      showCompletedTasks: z.boolean().default(false),
    })
    .strict(),
  mail: z
    .object({
      ...common,
      mailConversationLayout: z.enum(["split", "single"]).default("split"),
      mailListDensity: mailListDensityPreferenceSchema.default("comfortable"),
      mailListWidth: mailListWidthPreferenceSchema.default(34),
    })
    .strict(),
  finances: z
    .object({
      ...common,
      financeTransactionView: financeTransactionViewPreferenceSchema.default("table"),
      financeTransactionGroup: financeTransactionGroupPreferenceSchema.default("none"),
      // null follows all eligible accounts; [] is an explicit empty selection.
      spendAccountIds: ids.nullable().default(null),
      cashAccountIds: ids.nullable().default(null),
      investmentAccountIds: ids.nullable().default(null),
    })
    .strict(),
};
export type WorkspacePreferencesMap = {
  [W in Workspace]: z.infer<(typeof workspacePreferenceSchemas)[W]>;
};
export type WorkspacePreferences<W extends Workspace = Workspace> = WorkspacePreferencesMap[W];
export type CalendarWorkspacePreferences = WorkspacePreferences<"calendar">;
export type TasksWorkspacePreferences = WorkspacePreferences<"tasks">;
export type MailWorkspacePreferences = WorkspacePreferences<"mail">;
export type FinancesWorkspacePreferences = WorkspacePreferences<"finances">;

const revision = z.number().int().min(0);
export const workspaceSettingsSchema = z.discriminatedUnion("workspace", [
  z.object({
    workspace: z.literal("calendar"),
    revision,
    preferences: workspacePreferenceSchemas.calendar,
  }),
  z.object({
    workspace: z.literal("tasks"),
    revision,
    preferences: workspacePreferenceSchemas.tasks,
  }),
  z.object({
    workspace: z.literal("mail"),
    revision,
    preferences: workspacePreferenceSchemas.mail,
  }),
  z.object({
    workspace: z.literal("finances"),
    revision,
    preferences: workspacePreferenceSchemas.finances,
  }),
]);
export type WorkspaceSettings<W extends Workspace = Workspace> = Extract<
  z.infer<typeof workspaceSettingsSchema>,
  { workspace: W }
>;

function updateSchema<S extends Record<string, z.ZodDefault<z.ZodType>>>(shape: S) {
  type Fields = { [K in keyof S]: z.ZodOptional<S[K]["def"]["innerType"]> };
  // Defaults belong to reads only: omitted PATCH fields must remain omitted.
  const fields = Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, value.removeDefault().optional()]),
  ) as Fields;
  return z.object({ expectedRevision: revision, preferences: z.object(fields).strict() }).strict();
}
export const workspaceSettingsUpdateSchemas = {
  calendar: updateSchema(workspacePreferenceSchemas.calendar.shape),
  tasks: updateSchema(workspacePreferenceSchemas.tasks.shape),
  mail: updateSchema(workspacePreferenceSchemas.mail.shape),
  finances: updateSchema(workspacePreferenceSchemas.finances.shape),
};
export const updateWorkspaceSettingsSchema = z.union([
  workspaceSettingsUpdateSchemas.calendar,
  workspaceSettingsUpdateSchemas.tasks,
  workspaceSettingsUpdateSchemas.mail,
  workspaceSettingsUpdateSchemas.finances,
]);
export type UpdateWorkspaceSettings<W extends Workspace = Workspace> = {
  expectedRevision: number;
  preferences: Partial<WorkspacePreferences<W>>;
};

export function getDefaultWorkspacePreferences<W extends Workspace>(
  workspace: W,
): WorkspacePreferences<W> {
  return workspacePreferenceSchemas[workspace].parse({}) as WorkspacePreferences<W>;
}
/** Persisted rows include metadata; only this workspace's preference columns enter the result. */
export function resolveWorkspaceSettings<W extends Workspace>(
  workspace: W,
  row?: Record<string, unknown>,
): WorkspaceSettings<W> {
  // Earlier releases allowed repeated row-detail values. Preserve their set meaning on read;
  // new PATCH requests still reject duplicates rather than silently accepting them.
  const preferences =
    workspace === "tasks" && Array.isArray(row?.taskRowDetails)
      ? { ...row, taskRowDetails: [...new Set(row.taskRowDetails)] }
      : row;
  return {
    workspace,
    revision: row?.revision ?? 0,
    preferences: workspacePreferenceSchemas[workspace].strip().parse(preferences ?? {}),
  } as WorkspaceSettings<W>;
}

export const calendarWorkspacePreferencesSchema = workspacePreferenceSchemas.calendar;
export const tasksWorkspacePreferencesSchema = workspacePreferenceSchemas.tasks;
export const mailWorkspacePreferencesSchema = workspacePreferenceSchemas.mail;
export const financesWorkspacePreferencesSchema = workspacePreferenceSchemas.finances;
