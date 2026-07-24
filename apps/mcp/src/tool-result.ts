/** Consistent, typed MCP result envelopes shared by feature-owned tool modules. */
export function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

export function emptyResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { ok: true },
  };
}
