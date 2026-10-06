import { scopeLabels, selectableScopes } from "./access-scopes.js";
/** Searchable preferences, never account values. Targets are control IDs or visible labels.
 * Keep this catalog beside settings navigation when adding a field. Reveal actions may
 * only open a form/disclosure or select a tab; they must never submit a mutation.
 */
export type SettingsField = {
  section: string;
  label: string;
  target: string;
  aliases?: string;
  reveal?: string[];
  desktopOnly?: boolean;
  fallbackTarget?: string;
};
const fields = (
  section: string,
  entries: Array<[string, string, string?]>,
  extra: Partial<SettingsField> = {},
): SettingsField[] =>
  entries.map(([label, target, aliases]) => ({
    section,
    label,
    target,
    ...extra,
    ...(aliases ? { aliases } : {}),
  }));

export const settingsFields: SettingsField[] = [
  ...fields("tasks", [
    [
      "Sort by",
      "taskSort",
      "recommended relevant date reserved priority newest oldest title estimate",
    ],
    ["Group by", "taskGroup", "date list project grouping"],
    ["List and project sorting", "taskContainerSort", "recent updated name target date"],
    ["Estimates", "task-details-estimate", "row details"],
    ["Tags", "task-details-tags", "row details"],
    ["Notes", "task-details-notes", "row details"],
  ]),
  ...fields("mail", [
    ["Conversation layout", "mail-conversation-layout", "split full width reading pane mobile"],
    [
      "Conversation density",
      "mail-list-density",
      "message list layout compact comfortable expanded",
    ],
    ["Conversation list width", "mail-list-width", "reader split layout percent"],
  ]),
  ...["calendar", "tasks", "mail", "finances"].flatMap((workspace) =>
    fields(workspace, [
      [
        "Include completed and archived items in search",
        `${workspace}-search-archived`,
        "search scope history",
      ],
    ]),
  ),
  ...fields("calendar", [
    ["Preferred view", "calendar-default-view", "default day week month automatic saved"],
    ["Automatically follow today", "calendar-auto-follow", "target current time midnight opening"],
    ["Snap back to Follow", "calendar-snap-follow", "target scroll snap enable disable"],
    [
      "Follow snap sensitivity",
      "calendar-snap-sensitivity",
      "precise balanced generous target scroll",
    ],
    ["Show weekends", "calendar-show-weekends", "saturday sunday work week"],
  ]),
  ...["mail", "tasks"].flatMap((domain) =>
    fields(domain, [
      ["Objective", `${domain}-objective`, "preferences guidance"],
      ["Guidance", `${domain}-instructions`, "instructions preferences"],
    ]),
  ),
  ...["tasks", "reminders", "calendar", "finances", "mail", "goals", "motives"].map(
    (workspace) => ({
      section: "desktop",
      label: `Widget: ${workspace}`,
      target: `widget-${workspace}`,
      aliases: "workspaces Today at a Glance",
      desktopOnly: true,
    }),
  ),
  ...["tasks", "reminders", "calendar", "finances", "mail", "goals", "motives"].map(
    (workspace) => ({
      section: "pet",
      label: `Quick access: ${workspace}`,
      target: `pet-${workspace}`,
      aliases: "pet workspace shortcuts",
    }),
  ),
  ...selectableScopes.map((scope) => ({
    section: "agent-connections",
    label: scopeLabels[scope],
    target: `scope-${scope}`,
    aliases: `${scope} permission scope`,
    reveal: ["Set up a local token", "Fine-tune permissions"],
  })),
  ...fields(
    "goals",
    [
      ["Outcome", "goal-title", "goal title"],
      ["Description", "goal-description", "goal context"],
      ["Target date", "goal-target-date", "deadline"],
    ],
    { reveal: ["Add goal"] },
  ),
  ...fields(
    "motives",
    [
      ["Motive", "motive-title", "values purpose"],
      ["Context", "motive-detail", "motivation details"],
    ],
    { reveal: ["Add motive"] },
  ),
  ...fields("calendar", [
    ["Calendar visibility", "Calendar sources", "selected visible calendars"],
    ["Local calendar", "Local calendar", "create calendar"],
  ]),
  ...fields(
    "calendar",
    [
      ["Calendar name", "Calendar name", "local calendar title"],
      ["Calendar color", "Color", "local calendar appearance"],
    ],
    { reveal: ["Local calendar"] },
  ),
  ...fields("profile", [
    ["First name", "profile-first-name", "given name identity"],
    ["Last name", "profile-last-name", "surname family name"],
    ["Email", "profile-email", "email address login"],
    ["Day start", "profile-workday-start", "working hours workday start time"],
    ["Day end", "profile-workday-end", "working hours workday end time"],
    ["Home Location", "profile-home-location", "city weather address"],
    ["Time zone", "profile-timezone", "timezone local time"],
  ]),
  ...fields(
    "profile",
    [
      ["Phone number", "texting-phone", "mobile verified texting contact"],
      ["Phone country", "texting-country", "country code"],
    ],
    { reveal: ["Add phone number", "Change number"] },
  ),
  ...fields("security", [["Change password", "Send link", "reset password security"]]),
  ...fields("setup", [
    ["Calendar workspace", "setup-calendar"],
    ["Tasks workspace", "setup-tasks"],
    ["Mail workspace", "setup-mail"],
    ["Finances workspace", "setup-finances"],
    ["Guided setup experience", "View setup experience", "onboarding welcome tour"],
  ]),
  ...fields("appearance", [["Color mode", "Color mode", "theme light dark system appearance"]]),
  ...["morning", "night"].flatMap((kind) =>
    fields(
      "rituals",
      [
        [
          `${kind === "morning" ? "Morning" : "Evening"} ritual enabled`,
          `${kind}-enabled`,
          "enable routine",
        ],
        [
          `${kind === "morning" ? "Morning" : "Evening"} available from`,
          `${kind}-time`,
          "schedule start time",
        ],
        [`${kind === "morning" ? "Morning" : "Evening"} time zone`, `${kind}-zone`, "timezone"],
        [
          `${kind === "morning" ? "Morning" : "Evening"} checklist prompt`,
          "Prompt",
          "steps routine question",
        ],
        [
          `${kind === "morning" ? "Morning" : "Evening"} response type`,
          "Response type",
          "checkbox short entry date number multiple choice",
        ],
        [
          `${kind === "morning" ? "Morning" : "Evening"} answer choices`,
          "Choices",
          "multiple choice options",
        ],
      ],
      { reveal: [kind === "morning" ? "Morning" : "Evening"], fallbackTarget: "Response type" },
    ),
  ),
  ...fields("wallpaper", [
    ["Public board URL", "pinterest-board-url", "pinterest board link"],
    ["Refresh every day", "pinterest-daily", "daily automatic wallpaper"],
    ["Layout", "Layout", "mosaic stacked collage"],
    ["Mosaic fit", "Mosaic fit", "crop contain cover"],
    ["Backdrop", "Backdrop", "background color match daily"],
    ["Image size", "pinterest-tile-size", "tile scale"],
    ["Rotation", "pinterest-rotation", "tilt angle"],
    ["Image gap", "pinterest-frame-spacing", "spacing"],
    ["Image corners", "pinterest-corner-radius", "round radius"],
    ["Link edge padding", "pinterest-padding-linked", "framing margins"],
    ["Top padding", "pinterest-padding-top", "framing margins"],

    ["Show desktop safe areas", "pinterest-desktop-overlay", "widget"],
  ]),
  ...fields(
    "wallpaper",
    [
      ["Bottom padding", "pinterest-padding-bottom", "framing margins"],
      ["Start padding", "pinterest-padding-start", "left framing margins"],
      ["End padding", "pinterest-padding-end", "right framing margins"],
    ],
    { fallbackTarget: "pinterest-padding-top" },
  ),
  ...fields("desktop", [["Custom API server", "desktop-server", "self hosted endpoint url"]], {
    desktopOnly: true,
    reveal: ["Advanced server settings"],
  }),
  ...fields(
    "desktop",
    [
      ["Open at login", "Open at login", "launch startup"],
      ["Widget workspaces", "Widget workspaces", "today glance"],
    ],
    { desktopOnly: true },
  ),
  ...fields("pet", [
    ["Show desktop pet", "Show desktop pet", "companion"],
    ["Pet color", "pet-color"],
    ["Show in quick access", "Show in quick access", "workspace shortcuts"],
  ]),
  ...fields("notifications", [
    ["Enable notifications", "Enable notifications", "alerts"],
    ["Tasks due", "Tasks due"],
    ["Reminders due", "Reminders due"],
    ["Upcoming events", "Upcoming events"],
    ["Minutes before an event", "event-notice", "advance notice lead time"],
    ["Calendar selection", "Calendar selection"],
    ["New mail", "New mail", "email"],
    ["Mail accounts", "Mail accounts"],
    ["Play notification sounds", "Play notification sounds", "audio mute"],
    ["Show message previews", "Show message previews", "privacy"],
    ["Quiet hours start", "quiet-start", "from do not disturb"],
    ["Quiet hours end", "quiet-end", "until do not disturb"],
  ]),
  ...fields("invitations", [["Expires after", "invite-expiry", "invitation expiry duration"]]),
  ...fields("texting", [
    ["Country", "Country", "phone dialing code"],
    ["Mobile number", "Mobile number", "phone sms"],

    ["Allow agent text messages", "texting-consent", "consent sms opt in"],
  ]),
  ...fields("texting", [["Verification code", "texting-code", "otp sms"]], {
    fallbackTarget: "Mobile number",
  }),
  ...fields("agent-connections", [["nohmi MCP URL", "nohmi MCP URL", "endpoint server assistant"]]),
  ...fields(
    "agent-connections",
    [
      ["Token name", "token-name", "local host credential"],
      ["Permission preset", "Permission preset", "scopes read write"],
    ],
    { reveal: ["Set up a local token"] },
  ),
  ...fields("workspace-access", [
    [
      "Apply eligible work without waiting in Review",
      "global-review-bypass",
      "global review bypass approval confirmation automatic reviews",
    ],
  ]),
  ...fields("finances", [
    ["Employer", "Employer"],
    ["Role", "Role", "job"],
    ["Employment type", "finance-employmentType"],
    ["Gross annual income", "Gross annual income", "salary earnings"],
    ["Expected net paycheck", "Expected net paycheck", "take home pay"],
    ["Pay frequency", "finance-payFrequency"],
    ["Next payday", "Next payday"],
    ["Pay account", "finance-payAccountId", "deposit bank"],
  ]),
  ...fields("finances", [
    ["Jurisdiction", "finance-config-jurisdiction", "country state region"],
    ["Income stability", "finance-config-incomeStability"],
    ["Household size", "finance-config-householdSize"],
    ["Dependents", "finance-config-dependents"],
    ["Expected monthly take-home", "finance-config-expectedMonthlyTakeHome", "net income earnings"],
    ["Liquid reserves", "finance-config-liquidReserves", "savings emergency fund"],
    ["Reserve target (months)", "finance-config-reserveMonths", "emergency savings"],
    ["Buffer target (USD)", "finance-config-bufferTarget", "cash cushion"],
    ["Debt priority", "finance-config-debtPriority", "repayment"],
    ["Planning notes", "finance-config-notes"],
    ["Reliable monthly income", "finance-config-reliable-income", "budget resources"],
    ["Next reliable payment", "finance-config-next-payment"],
    ["Bills and minimum payments", "Bills and minimum payments", "expenses obligations"],
    ["Other possible income", "Other possible income"],
    ["One-time resources", "One-time resources"],
    ["Goal contributions", "Goal contributions"],
    ["Spending priorities", "Spending priorities"],
    ["Debts", "Debts"],
  ]),
  ...fields(
    "connections",
    [
      ["Apple Account email", "icloud-email", "icloud apple id"],
      ["App-specific password", "icloud-app-password", "icloud apple credential"],
      ["Services to connect", "Services to connect", "mail calendar"],
    ],
    { reveal: ["Connect", "iCloud"] },
  ),
];

export function settingsFieldId(field: SettingsField): string {
  return `${field.section}:${field.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function settingMatchScore(query: string, label: string, context = ""): number {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const term = normalize(query);
  const name = normalize(label);
  const haystack = `${name} ${normalize(context)}`;
  if (term.length === 0) return 0;
  if (!term.split(/\s+/).every((word) => haystack.includes(word))) return 0;
  return name === term ? 100 : name.startsWith(term) ? 80 : name.includes(term) ? 60 : 20;
}
