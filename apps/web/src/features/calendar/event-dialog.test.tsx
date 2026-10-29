// @vitest-environment jsdom

import type { Calendar, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventDialog } from "../../app";

const mocks = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn(), getDomainProfile: vi.fn() }));
vi.mock("../../api.js", () => ({ api: mocks }));

it.each([
  false,
  true,
])("handles delayed duration preferences while preserving edited end: %s", async (editEnd) => {
  let resolvePreferences!: (value: unknown) => void;
  mocks.getWorkspaceSettings.mockReturnValue(
    new Promise((resolve) => {
      resolvePreferences = resolve;
    }),
  );
  mocks.getDomainProfile.mockResolvedValue(null);
  const user = { id: "owner", planningTimezone: "UTC" } as User;
  const client = new QueryClient();
  client.setQueryData(["me"], user);
  render(
    <QueryClientProvider client={client}>
      <EventDialog calendars={[] as Calendar[]} close={vi.fn()} event={undefined} user={user} />
    </QueryClientProvider>,
  );
  const end = screen.getByLabelText("Ends") as HTMLInputElement;
  const start = screen.getByLabelText("Starts") as HTMLInputElement;
  if (editEnd) fireEvent.change(end, { target: { value: "2030-01-01T12:00" } });
  await act(async () =>
    resolvePreferences({ revision: 1, preferences: { defaultEventDurationMinutes: 90 } }),
  );
  await waitFor(() => {
    if (editEnd) expect(end.value).toBe("2030-01-01T12:00");
    else expect(Date.parse(end.value) - Date.parse(start.value)).toBe(90 * 60_000);
  });
});
