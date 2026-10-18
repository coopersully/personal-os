import { attentionConnections } from "./attention-model";

it("deduplicates shared accounts and separates automatic retries from recovery", () => {
  const account = {
    id: "same",
    label: "Work",
    health: {
      state: "reconnect" as const,
      message: null,
      nextSyncAt: null,
      recovery: "reconnect" as const,
    },
  };
  expect(attentionConnections([account, account])).toHaveLength(1);
  expect(
    attentionConnections([
      { ...account, health: { ...account.health, state: "retrying", recovery: "automatic" } },
    ]),
  ).toEqual([]);
});
