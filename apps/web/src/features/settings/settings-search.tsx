import { isTauri } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type Icon, SearchIcon } from "@/components/icons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { settingsPath } from "@/features/settings/settings-routes";
import { settingMatchScore, settingsFieldId, settingsFields } from "./settings-fields.js";

export const settingsDescriptions = {
  security: "Manage your password, signed-in devices, permissions, and approvals.",
  setup: "Choose your setup preferences or revisit the guided experience.",
  profile: "Your profile, connected accounts, and workspace attention.",
  "ritual-morning": "Configure your morning routine.",
  "ritual-evening": "Configure your evening routine.",
  "ritual-history": "Review past ritual entries.",
  rituals: "Shape your morning and evening routines.",
  "completed-outcomes": "Review outcomes you’ve finished.",
  goals: "Choose the outcomes you want to work toward.",
  motives: "Keep what matters to you close to your plans.",
  reviews: "Review decisions and requests that need your approval.",
  appearance: "Choose a comfortable color mode for nohmi.",
  wallpaper: "Create a daily desktop wallpaper from Pinterest.",
  desktop: "Install and manage nohmi on your computer.",
  pet: "Choose your desktop companion and how it appears.",
  notifications: "Control alerts and interruptions on this device.",
  activity: "See what changed, when, and who made it happen.",
  sessions: "Manage devices signed in to your account.",
  invitations: "Invite people and manage account invitations.",
  connections: "Connect accounts and check their sync health.",
  mail: "Manage mail accounts, rules, guidance, and permissions.",
  finances: "Manage financial guidance, preferences, and access.",
  calendar: "Choose visible calendars and manage Calendar access.",
  tasks: "Manage task guidance and permissions.",
  "agent-connections": "Connect assistants and manage their credentials.",
  "workspace-access": "Choose what connected agents can do in each workspace.",
  texting: "Connect a phone number to message your agents.",
} satisfies Record<string, string>;

const searchTerms: Record<keyof typeof settingsDescriptions, string> = {
  security: "password security access permissions sessions devices invitations approval policy",
  setup: "onboarding workspaces welcome getting started",
  profile:
    "password security time zone timezone workday first last name email address location logout",
  "ritual-morning": "morning routine checklist",
  "ritual-evening": "evening night routine checklist",
  "ritual-history": "past entries answers history",
  rituals:
    "checklist steps morning evening night schedule time zone timezone history tracking responses",
  goals: "priorities targets outcomes",
  "completed-outcomes": "finished goals history completed",
  motives: "values purpose motivation",
  reviews: "approvals pending requests",
  appearance: "theme light dark system color mode",
  wallpaper: "pinterest board collage background",
  desktop: "download mac windows install updates",
  pet: "companion animation",
  notifications: "alerts sound badge interruptions",
  activity: "audit history log search",
  sessions: "security devices revoke sign out",
  invitations: "invite people access",
  connections: "google icloud accounts sync reconnect bookmarks",
  mail: "email inbox rules sync",
  finances: "money budget currency guidance accounts",
  calendar: "calendars visibility events",
  tasks: "lists projects reminders",
  "agent-connections": "tokens credentials scopes assistant mcp api keys",
  "workspace-access": "permissions agents authority approvals automation",
  texting: "phone sms number messages",
};

export type SettingsSearchGroup = {
  label: string;
  items: Array<{ id: keyof typeof settingsDescriptions; label: string; icon: Icon }>;
};

export function SettingsSearch({ groups }: { groups: SettingsSearchGroup[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const words = query.toLocaleLowerCase().trim().split(/\s+/);
  const results = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const text =
          `${group.label} ${item.label} ${settingsDescriptions[item.id]} ${searchTerms[item.id]}`.toLocaleLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.items.length);
  const available = groups.flatMap((group) => group.items);
  const fieldResults = query.trim()
    ? settingsFields
        .flatMap((field) => {
          const section = available.find((item) => item.id === field.section);
          if (!section || (field.desktopOnly && !isTauri())) return [];
          const score = settingMatchScore(
            query,
            field.label,
            `${section.label} ${field.aliases ?? ""}`,
          );
          return score ? [{ field, section, score }] : [];
        })
        .sort((a, b) => b.score - a.score || a.field.label.localeCompare(b.field.label))
    : [];
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery("");
      }}
    >
      <PopoverAnchor asChild>
        <div className="workspace-finder settings-search">
          <InputGroup className="workspace-finder-input w-full rounded-full">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              aria-label="Search settings"
              aria-expanded={open}
              aria-controls={open ? "settings-search-results" : undefined}
              placeholder=""
              value={query}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                const links = resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
                const destination =
                  event.key === "ArrowDown" ? links?.[0] : links?.[links.length - 1];
                if (destination) {
                  event.preventDefault();
                  destination.focus();
                }
              }}
              type="search"
            />
          </InputGroup>
        </div>
      </PopoverAnchor>
      <PopoverContent
        aria-label="Settings search"
        className="settings-search-popover workspace-finder-results"
        align="center"
        collisionPadding={16}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target === inputRef.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <nav
          ref={resultsRef}
          id="settings-search-results"
          aria-label="Settings search results"
          className="settings-search-results"
        >
          {fieldResults.length ? (
            <div>
              <h2 className="px-2 py-2 text-xs font-medium text-muted-foreground">
                Settings fields
              </h2>
              {fieldResults.map(({ field, section }) => (
                <Link
                  key={settingsFieldId(field)}
                  to={`${settingsPath(field.section)}&field=${encodeURIComponent(settingsFieldId(field))}`}
                  className="settings-search-result"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <section.icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>
                    <span className="block text-sm font-medium">{field.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {section.label}
                      {field.reveal?.length ? " · Opens the relevant form" : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
          {results.length ? (
            results.map((group) => (
              <div key={group.label}>
                <h2 className="px-2 py-2 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h2>
                {group.items.map(({ id, label, icon: SectionIcon }) => (
                  <Link
                    key={id}
                    to={settingsPath(id)}
                    className="settings-search-result"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <SectionIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {settingsDescriptions[id]}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ))
          ) : fieldResults.length ? null : (
            <p className="p-4 text-sm text-muted-foreground" role="status">
              No settings found. Try a different name or topic.
            </p>
          )}
        </nav>
      </PopoverContent>
    </Popover>
  );
}
