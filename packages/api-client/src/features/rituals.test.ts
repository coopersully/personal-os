import { createRitualsApiClient } from "./rituals.js";

it("routes ritual operations through the authenticated transport and encodes path segments", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createRitualsApiClient(request);
  await api.getCurrentRitual();
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/current");
  await api.listRitualHistory("2026-09-29T12:00:00Z");
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/history?cursor=2026-09-29T12%3A00%3A00Z");
  await api.deleteRitualData("../night");
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/..%2Fnight/data", { method: "DELETE" });
  await api.exportRitualData();
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/export");
});

it("sends explicit completion and encoded responses through the transport", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createRitualsApiClient(request);
  const mutation = {
    requestId: crypto.randomUUID(),
    deviceId: "desktop",
    expectedRevision: 2,
    observedAt: "2026-09-29T12:00:00Z",
  };
  const completion = { ...mutation, kind: "complete" as const };
  await api.recordRitualAction("occurrence/one", completion);
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/occurrences/occurrence%2Fone/actions", {
    method: "POST",
    body: JSON.stringify(completion),
  });
  const response = { ...mutation, value: "06:30", submitted: true };
  await api.saveRitualResponse("occurrence/one", "wake/time", response);
  expect(request).toHaveBeenLastCalledWith(
    "/v1/rituals/occurrences/occurrence%2Fone/responses/wake%2Ftime",
    { method: "PUT", body: JSON.stringify(response) },
  );
  const definition = {
    requestId: mutation.requestId,
    deviceId: "desktop",
    expectedRevision: 0,
    kind: "morning" as const,
    title: "Morning",
    enabled: true,
    time: "06:00",
    timeZone: "UTC",
    steps: [{ id: "wake", label: "Wake time", kind: "time" as const }],
  };
  await api.saveRitual(definition);
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/morning", {
    method: "PUT",
    body: JSON.stringify(definition),
  });
  await api.listRituals();
  expect(request).toHaveBeenLastCalledWith("/v1/rituals");
  await api.listRitualHistory();
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/history");
  await api.listRitualHistory(undefined, { kind: "night", dateFrom: "2026-09-29" });
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/history?kind=night&dateFrom=2026-09-29");
});

it("omits absent and empty history filters", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createRitualsApiClient(request);
  await api.listRitualHistory(undefined, { kind: undefined, dateFrom: "", dateTo: undefined });
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/history");
  await api.listRitualHistory("next", { kind: undefined, dateFrom: "2026-09-29" });
  expect(request).toHaveBeenLastCalledWith("/v1/rituals/history?dateFrom=2026-09-29&cursor=next");
});
