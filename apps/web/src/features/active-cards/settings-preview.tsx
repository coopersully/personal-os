import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckIcon,
  ListChecksIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
} from "@/components/icons";
import { Field } from "@/components/settings-field";
import { Button } from "@/components/ui/button";
import { FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "../settings/settings-layout";
import "./settings-preview.css";

export const initialCardPreferences = {
  enabled: true,
  defaultTasks: false,
  defaultReminders: true,
  returnCards: true,
  shake: true,
  sensitivity: "medium",
  snap: true,
  guides: true,
  autoLock: false,
  anchor: "top-right",
  monitor: "primary",
  dock: "bottom",
  spacing: 12,
  magnet: "eager",
  remember: true,
  sounds: true,
  volume: 35,
  arrivalVolume: 100,
  completionVolume: 100,
  interactionVolume: 45,
  reduced: false,
  textScale: "standard",
  titleLines: "one",
  countdown: "minutes",
  focus: "show",
  sharing: "hide",
};
export type CardPreferences = typeof initialCardPreferences;
export type PreferenceKey = keyof CardPreferences;
type KeysOfType<T> = {
  [K in PreferenceKey]: CardPreferences[K] extends T ? K : never;
}[PreferenceKey];

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: string;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" controlWidth="compact" data-disabled={disabled}>
      <FieldContent className="active-card-field-copy">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </Field>
  );
}

export type ActiveCardSettingsSurface = {
  onMac: boolean;
  deviceDisabled: boolean;
  defaultsDisabled: boolean;
  displays?: Array<{ id: string; label: string; isPrimary: boolean }>;
  focusDetails?: ReactNode;
};
/** Shared controls and sample-only preview; the domain adapter owns persistence. */
export function ActiveCardsSettingsPreview({
  value,
  onChange,
  live,
}: {
  value?: CardPreferences;
  onChange?: (key: PreferenceKey, value: CardPreferences[PreferenceKey], commit?: boolean) => void;
  live?: ActiveCardSettingsSurface;
} = {}) {
  const [localPrefs, setPrefs] = useState(initialCardPreferences);
  const prefs = value ?? localPrefs;
  const [presence, setPresence] = useState("active");
  const [readyVersion, setReadyVersion] = useState(0);
  const ready = readyVersion > 0;
  const frame = useRef<HTMLIFrameElement>(null);
  const update = <K extends PreferenceKey>(key: K, value: CardPreferences[K], commit = true) => {
    if (onChange) onChange(key, value, commit);
    else setPrefs((old) => ({ ...old, [key]: value }));
  };
  const send = (command: string, extra: Record<string, unknown> = {}) =>
    frame.current?.contentWindow?.postMessage(
      { type: "nohmi:active-cards-preview", command, ...extra },
      window.location.origin,
    );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
        return;
      if (event.data?.type === "nohmi:active-cards-ready")
        setReadyVersion((version) => version + 1);
      if (
        event.data?.type === "nohmi:active-card-feedback" &&
        typeof event.data.message === "string"
      )
        toast(event.data.message.slice(0, 200));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (readyVersion > 0)
      frame.current?.contentWindow?.postMessage(
        {
          type: "nohmi:active-cards-preview",
          command: "preferences",
          prefs,
          presence,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        },
        window.location.origin,
      );
  }, [prefs, presence, readyVersion]);

  const toggle = (
    key: KeysOfType<boolean>,
    label: string,
    description?: string,
    disabled = false,
  ) => (
    <Toggle
      label={label}
      checked={Boolean(prefs[key])}
      onChange={(value) => update(key, value)}
      {...(description === undefined ? {} : { description })}
      disabled={Boolean(
        disabled ||
          (key === "defaultTasks" || key === "defaultReminders"
            ? live?.defaultsDisabled
            : live?.deviceDisabled),
      )}
    />
  );
  const select = (
    key: KeysOfType<string>,
    label: string,
    options: Array<[string, string]>,
    disabled = false,
  ) => (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={`cards-${key}`}>{label}</FieldLabel>
      <NativeSelect
        id={`cards-${key}`}
        value={String(prefs[key])}
        onChange={(event) => update(key, event.target.value)}
        disabled={Boolean(disabled || live?.deviceDisabled)}
      >
        {options.map(([value, text]) => (
          <NativeSelectOption key={value} value={value}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
  const range = (
    key: KeysOfType<number>,
    label: string,
    max = 100,
    disabled = false,
    unit = "%",
  ) => (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={`cards-${key}`}>
        {label}
        <span className="active-card-value">
          {String(prefs[key])}
          {unit}
        </span>
      </FieldLabel>
      <Slider
        id={`cards-${key}`}
        aria-label={label}
        min={0}
        max={max}
        step={1}
        value={[Number(prefs[key])]}
        onValueChange={(values) => update(key, values[0] ?? 0, false)}
        onValueCommit={(values) => update(key, values[0] ?? 0)}
        disabled={Boolean(disabled || live?.deviceDisabled)}
      />
    </Field>
  );

  return (
    <div
      className={live ? "active-card-settings active-card-settings--live" : "active-card-settings"}
    >
      <div className="active-card-preview-column">
        <SettingsSection
          title="Try your cards"
          description="Drag anywhere. Join edges, then click the divider to lock. Hold Shift for group actions."
          action={<span className="active-card-preview-badge">Browser preview</span>}
        >
          <div className="active-card-preview-toolbar">
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => send("add", { kind: "task" })}
            >
              <PlusIcon />
              Task
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!ready}
              onClick={() => send("add", { kind: "reminder" })}
            >
              <PlusIcon />
              Reminder
            </Button>
            <Button size="sm" variant="outline" disabled={!ready} onClick={() => send("gather")}>
              <ListChecksIcon />
              Gather
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Reset preview cards"
              disabled={!ready}
              onClick={() => {
                setPresence("active");
                send("reset");
              }}
            >
              <RefreshIcon />
            </Button>
          </div>
          <iframe
            ref={frame}
            title="Interactive active task and reminder preview"
            src="/active-cards-playground.html?embedded=1"
            className="active-card-preview-frame"
            onLoad={() => send("hello")}
          />
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="cards-presence">Try a situation</FieldLabel>
              <NativeSelect
                id="cards-presence"
                value={presence}
                onChange={(event) => setPresence(event.target.value)}
              >
                <NativeSelectOption value="active">At your Mac</NativeSelectOption>
                <NativeSelectOption value="away">Away</NativeSelectOption>
                <NativeSelectOption value="focus">Focus is on</NativeSelectOption>
                <NativeSelectOption value="sharing">Screen sharing</NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
          <p className="active-card-preview-note">
            {live
              ? live.onMac
                ? "Sample cards only. Settings save to your account and this Mac; preview actions never change real items."
                : "Creation defaults save to your account. Layout, sound and appearance controls are previews here; open nohmi on your Mac to save them on that device."
              : "Sample cards only. Changes stay in this preview; your account and Mac preferences are untouched."}
          </p>
        </SettingsSection>
        <div className="active-card-preview-principle">
          <CheckIcon />
          <p>
            Small to start. Persistent until done.
            <br />
            <span>Every unfinished card keeps its place.</span>
          </p>
        </div>
      </div>
      <div className="active-card-controls-column">
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="Defaults"
          description="Choose what starts active. Existing items keep their setting."
        >
          <FieldGroup>
            {toggle("defaultTasks", "New tasks")}
            {toggle("defaultReminders", "New reminders", undefined)}
          </FieldGroup>
        </SettingsSection>
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="On this Mac"
          description="Cards stay until completed. Manage availability here, not from a card’s menu."
        >
          <FieldGroup>
            {toggle("enabled", "Show active cards on this Mac")}
            {toggle(
              "returnCards",
              "Return with unfinished cards",
              "Show unfinished cards after returning; send normal notifications while away.",
              !prefs.enabled,
            )}
            {select(
              "focus",
              "When Focus is on",
              [
                ["show", "Keep cards visible"],
                ["hide", "Wait until Focus ends"],
              ],
              !prefs.enabled,
            )}
            {live?.focusDetails}
            {!live &&
              select(
                "sharing",
                "When screen sharing",
                [
                  ["hide", "Hide until sharing ends"],
                  ["show", "Keep cards visible"],
                ],
                !prefs.enabled,
              )}
          </FieldGroup>
        </SettingsSection>
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="Placement"
          description="Each card starts at its smallest size. Drag and resize it whenever you need."
        >
          <FieldGroup>
            {select(
              "monitor",
              "Start on",
              live
                ? [
                    ["pointer", "Display with the pointer"],
                    ["primary", "Main display"],
                    ...(live.displays ?? []).map((display): [string, string] => [
                      display.id,
                      display.label,
                    ]),
                  ]
                : [
                    ["primary", "Main display"],
                    ["external", "External display · preview"],
                  ],
              !prefs.enabled,
            )}
            {select(
              "anchor",
              "Starting position",
              [
                ["top-left", "Top left"],
                ["top-center", "Top center"],
                ["top-right", "Top right"],
                ["center", "Center"],
                ["bottom-left", "Bottom left"],
                ["bottom-center", "Bottom center"],
                ["bottom-right", "Bottom right"],
              ],
              !prefs.enabled,
            )}
            {select("dock", "Preview Dock position", [
              ["bottom", "Bottom"],
              ["left", "Left"],
              ["right", "Right"],
            ])}
            {range("spacing", "Edge spacing", 40, !prefs.enabled, " pt")}
            {toggle(
              "remember",
              "Remember card positions",
              "Keep your layout after returning to your Mac.",
              !prefs.enabled,
            )}
            {toggle("snap", "Snap to edges and other cards", undefined, !prefs.enabled)}
            {select(
              "magnet",
              "Snap strength",
              [
                ["gentle", "Gentle · near an edge"],
                ["eager", "Eager · when any part reaches a slot"],
              ],
              !prefs.enabled || !prefs.snap,
            )}
            {toggle("guides", "Show placement slots", undefined, !prefs.enabled || !prefs.snap)}
          </FieldGroup>
        </SettingsSection>
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="Grouping"
          description="Click a divider to lock a pair. Shift-click affects every connected card."
        >
          <FieldGroup>
            {toggle("autoLock", "Lock new joins automatically", undefined, !prefs.enabled)}
            {toggle(
              "shake",
              "Shake to gather",
              "Shake a held card to gather every active card into a movable stack.",
              !prefs.enabled,
            )}
            {select(
              "sensitivity",
              "Shake sensitivity",
              [
                ["low", "Low · deliberate shakes"],
                ["medium", "Medium · several clear shakes"],
                ["high", "High · smaller shakes"],
              ],
              !prefs.enabled || !prefs.shake,
            )}
          </FieldGroup>
          <Button
            className="self-start"
            variant="outline"
            size="sm"
            disabled={!ready || !prefs.enabled}
            onClick={() => send("join")}
          >
            <LockIcon />
            Try a connected pair
          </Button>
        </SettingsSection>
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="Sound & motion"
          description="Minimal Earshot cues from nohmi’s shared desktop sound pack."
        >
          <FieldGroup>
            {toggle("sounds", "Play card sounds")}
            {range("volume", "Overall volume", 100, !prefs.sounds)}
            {range("arrivalVolume", "New card", 100, !prefs.sounds)}
            {range("completionVolume", "Completion", 100, !prefs.sounds)}
            {range("interactionVolume", "Movement & grouping", 100, !prefs.sounds)}
            {toggle("reduced", "Reduce motion", "Keep transitions brief without pop or bounce.")}
          </FieldGroup>
          <div className="active-card-sound-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={!prefs.sounds || !ready}
              onClick={() => send("sound", { sound: "arrive" })}
            >
              <PlayIcon />
              Arrival
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!prefs.sounds || !ready}
              onClick={() => send("sound", { sound: "complete" })}
            >
              <CheckIcon />
              Completion
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!prefs.sounds || !ready}
              onClick={() => send("sound", { sound: "lock" })}
            >
              <LockIcon />
              Lock
            </Button>
          </div>
        </SettingsSection>
        <SettingsSection
          layout={live ? "rows" : "content"}
          title="Appearance"
          description="Uses nohmi’s theme. Exact due times remain visible in every format."
        >
          <FieldGroup>
            {select("textScale", "Text size", [
              ["small", "Small"],
              ["standard", "Standard"],
              ["large", "Large"],
            ])}
            {select("titleLines", "Title lines", [
              ["one", "One · compact"],
              ["two", "Up to two · when resized"],
            ])}
            {select("countdown", "Countdown detail", [
              ["minutes", "Minutes"],
              ["seconds", "Minutes and seconds"],
            ])}
          </FieldGroup>
        </SettingsSection>
        {!live && (
          <Button
            className="self-start"
            variant="ghost"
            onClick={() => {
              setPrefs(initialCardPreferences);
              setPresence("active");
              send("reset");
              toast("Preview preferences restored");
            }}
          >
            <RefreshIcon />
            Restore preview defaults
          </Button>
        )}
      </div>
    </div>
  );
}
