import { Button, Host, Menu, Picker, Section, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { touchTarget, useTheme } from "../../theme";
import type { OptionsMenuProps } from "./options-menu";

/** Native view configuration; filter editing lives in one bounded sheet. */
export function OptionsMenu({ choices, onChange, onAdvanced, onReset }: OptionsMenuProps) {
  const t = useTheme();
  return (
    <Host style={{ width: touchTarget, height: touchTarget }} ignoreSafeArea="all">
      <Menu
        modifiers={[accessibilityLabel("Task view options")]}
        label={
          <Text
            modifiers={[
              font({ size: 26, weight: "semibold" }),
              foregroundStyle(t.ink),
              frame({ width: touchTarget, height: touchTarget, alignment: "topTrailing" }),
            ]}
          >
            ⋮
          </Text>
        }
      >
        <Section>
          <Button label="Filters…" onPress={onAdvanced} />
        </Section>
        <Section>
          {choices
            .filter((choice) => choice.section === "presentation")
            .map((choice) => (
              <Picker
                key={choice.key}
                label={choice.label}
                selection={choice.value}
                onSelectionChange={(value: string) => onChange(choice.key, value)}
                modifiers={[pickerStyle("menu")]}
              >
                {choice.options.map((option) => (
                  <Text key={option.value} modifiers={[tag(option.value)]}>
                    {option.label}
                  </Text>
                ))}
              </Picker>
            ))}
        </Section>
        <Section>
          <Button label="Reset view" onPress={onReset} />
        </Section>
      </Menu>
    </Host>
  );
}
