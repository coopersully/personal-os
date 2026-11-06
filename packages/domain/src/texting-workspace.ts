import { z } from "zod";
export const textWorkspaceSchema = z.enum(["mail", "tasks", "calendar", "finances"]);
export type TextWorkspace = z.infer<typeof textWorkspaceSchema>;
