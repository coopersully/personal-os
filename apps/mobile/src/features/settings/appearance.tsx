import type { Theme } from "@personal-os/domain";
import { Choice, FormBody, Section } from "../tasks/ui";
import { useUserSettings } from "./data";
export function AppearanceSettingsScreen() {
  const { user, save, pending } = useUserSettings();
  if (!user) return null;
  return (
    <FormBody>
      <Section title="Appearance">
        <Choice
          label="Theme"
          value={user.theme}
          disabled={pending}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(theme) => void save({ theme: theme as Theme })}
        />
      </Section>
    </FormBody>
  );
}
