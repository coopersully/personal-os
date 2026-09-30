import { idSchema } from "@personal-os/domain";
import { AppError } from "./errors.js";

export type Cursor = {
  createdAt: Date;
  id: string;
};

export function encodeCursor(value: Cursor): string {
  return Buffer.from(`${value.createdAt.toISOString()}|${value.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  const [createdAtValue, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const createdAt = new Date(String(createdAtValue));
  const parsedId = idSchema.safeParse(id);
  if (
    !createdAtValue ||
    !parsedId.success ||
    extra !== undefined ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new AppError("invalid_request", "The pagination cursor is invalid.");
  }
  return { createdAt, id: parsedId.data };
}
