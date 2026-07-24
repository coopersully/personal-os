import { AppError } from "./errors.js";

export function requireDatabaseRecord<T>(record: T | undefined, message: string): T {
  if (!record) throw new AppError("internal_error", message);
  return record;
}
