import type { DomainProfile } from "@personal-os/domain";
import { expect, it, vi } from "vitest";
import { guidanceConfirmation, guidanceInput, validateGuidancePreferences } from "./workspaces";

vi.mock("sonner-native", () => ({ toast: { error: vi.fn() } }));
vi.mock("./preferences-hook", () => ({ useWorkspacePreferenceQueue: vi.fn() }));
vi.mock("./finance-settings", () => ({ FinanceConfigurationSettings: () => null }));
vi.mock("../tasks/preferences", () => ({ TaskPreferencesScreen: () => null }));
vi.mock("./settings-row", () => ({
  SettingsRow: () => null,
  SettingsActionRow: () => null,
  SettingsDetailRow: () => null,
}));
vi.mock("react-native", () => ({ Text: () => null, View: () => null }));
vi.mock("expo-router", () => ({ router: {}, Stack: {} }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: vi.fn() }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: vi.fn() }));
vi.mock("../auth/context", () => ({ useAuth: vi.fn() }));
vi.mock("../tasks/ui", () => ({}));
vi.mock("./data", () => ({}));
vi.mock("../../theme", () => ({}));
const profile: DomainProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  domain: "mail",
  version: 7,
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  categories: [],
  instructions: ["Existing instruction"],
  objective: "Existing objective",
  preferences: {
    hiddenPolicy: "preserve",
    inboxStyle: "conservative",
    noiseDisposition: "review_only",
    noiseRetentionDays: null,
  },
  sourceContexts: [
    {
      sourceId: "missing-current-source",
      sourceLabel: "Original source",
      purpose: "Inbox",
      notes: null,
    },
  ],
  status: "active",
  summary: "Existing summary",
};
it("keeps the reviewed version, unknown policy and source contexts in guidance writes", () => {
  const input = guidanceInput(
    profile,
    " New objective ",
    " First instruction\n\nSecond instruction ",
  );
  expect(input.expectedVersion).toBe(7);
  expect(input.objective).toBe("New objective");
  expect(input.instructions).toEqual(["First instruction", "Second instruction"]);
  expect(input.preferences).toEqual(profile.preferences);
  expect(input.sourceContexts).toEqual(profile.sourceContexts);
  expect(input.summary).toBe(profile.summary);
  expect(input.status).toBe("active");
  expect(input).not.toHaveProperty("id");
});
it("rejects empty objectives and overlong instructions before transport", () => {
  expect(() => guidanceInput(profile, " ", "instruction")).toThrow();
  expect(() => guidanceInput(profile, "objective", "x".repeat(1001))).toThrow();
});
it("validates paired mail disposition/retention without stripping hidden policy", () => {
  expect(validateGuidancePreferences(profile, profile.preferences)).toMatchObject({
    hiddenPolicy: "preserve",
  });
  expect(() =>
    validateGuidancePreferences(profile, {
      ...profile.preferences,
      noiseDisposition: "trash_after_days",
    }),
  ).toThrow();
  expect(() =>
    validateGuidancePreferences(profile, { ...profile.preferences, noiseRetentionDays: 30 }),
  ).toThrow();
});
it("preserves unknown calendar fields and does not fill missing draft authority", () => {
  const draft = { ...profile, domain: "calendar", status: "draft" } as DomainProfile;
  const preferences = { hiddenPolicy: "preserve", beforeBufferMinutes: 10 };
  expect(validateGuidancePreferences(draft, preferences)).toBe(preferences);
  expect(() => validateGuidancePreferences({ ...draft, status: "active" }, preferences)).toThrow();
});

it("names consequential Mail disposition and automatic Calendar event policy in confirmation", () => {
  expect(
    guidanceConfirmation(profile, {
      ...profile.preferences,
      noiseDisposition: "trash_after_days",
      noiseRetentionDays: 30,
    }),
  ).toContain("trash after 30 days");
  expect(
    guidanceConfirmation(
      { ...profile, domain: "calendar", preferences: { automaticEventCreation: false } },
      { automaticEventCreation: true },
    ),
  ).toContain("Automatic event creation will be enabled");
});

vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button
      type="button"
      aria-label="Save changes"
      data-floating-save
      disabled={disabled}
      onClick={onPress}
    />
  ),
}));

it("explains archival, return to review-only and disabling calendar automation using the actual proposed policy", () => {
  expect(
    guidanceConfirmation(profile, {
      ...profile.preferences,
      noiseDisposition: "archive_after_days",
      noiseRetentionDays: 14,
    }),
  ).toContain("archive after 14 days");
  const before = {
    ...profile,
    preferences: {
      ...profile.preferences,
      noiseDisposition: "trash_after_days",
      noiseRetentionDays: 30,
    },
  };
  const review = guidanceConfirmation(before, {
    ...profile.preferences,
    noiseDisposition: "review_only",
    noiseRetentionDays: null,
  });
  expect(review).toContain("review only");
  expect(review).not.toContain("after null days");
  expect(
    guidanceConfirmation(
      { ...profile, domain: "calendar", preferences: { automaticEventCreation: true } },
      { automaticEventCreation: false },
    ),
  ).toContain("Automatic event creation will be disabled");
});
