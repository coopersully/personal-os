import { createKnowledgeApiClient } from "./knowledge.js";

const id = "11111111-1111-4111-8111-111111111111";
const merge = { mergeId: id, from: "money", into: "finances", undoneAt: null };

it("routes tag index, merge and unmerge through the authenticated transport", async () => {
  const request = vi.fn().mockResolvedValue({ tags: [], aliases: [] });
  const api = createKnowledgeApiClient(request);
  expect(await api.listKnowledgeTags()).toEqual({ tags: [], aliases: [] });
  expect(request).toHaveBeenLastCalledWith("/v1/knowledge/tags");
  await api.listKnowledgeTags({ limit: 5 });
  expect(request).toHaveBeenLastCalledWith("/v1/knowledge/tags?limit=5");

  request.mockResolvedValue(merge);
  const input = { from: "Money", into: "finances", mutationKey: id };
  expect(await api.mergeKnowledgeTags(input)).toEqual(merge);
  expect(request).toHaveBeenLastCalledWith("/v1/knowledge/tags/merge", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const undo = { mergeId: id, mutationKey: id };
  expect(await api.unmergeKnowledgeTags(undo)).toEqual(merge);
  expect(request).toHaveBeenLastCalledWith("/v1/knowledge/tags/unmerge", {
    method: "POST",
    body: JSON.stringify(undo),
  });
});
