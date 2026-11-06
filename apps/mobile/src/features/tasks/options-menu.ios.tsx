import { Button, Host, Menu, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, font, foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { touchTarget, useTheme } from "../../theme";
import type { OptionsMenuProps } from "./options-menu";

export function OptionsMenu({ choices, onChange, onAdvanced, onReset }: OptionsMenuProps) {
  const t = useTheme();
  return (
    <Host style={{ width: touchTarget, height: touchTarget }} ignoreSafeArea="all">
      <Menu
        label={
          <Text
            modifiers={[
              font({ size: 26, weight: "semibold" }),
              foregroundStyle(t.ink),
              frame({ width: touchTarget, height: touchTarget }),
            ]}
          >
            …
          </Text>
        }
        modifiers={[accessibilityLabel("Task view options")]}
      >
        <Menu label="Filter">
          {choices
            .filter((choice) => choice.section === "filter")
            .map((choice) => (
              <Menu key={choice.key} label={choice.label}>
                {choice.options.map((option) => (
                  <Button
                    key={option.value}
                    label={`${option.value === choice.value ? "✓ " : ""}${option.label}`}
                    onPress={() => onChange(choice.key, option.value)}
                  />
                ))}
              </Menu>
            ))}
          <Button label="Dates & tags…" onPress={onAdvanced} />
        </Menu>
        {choices
          .filter((choice) => choice.section === "presentation")
          .map((choice) => (
            <Menu key={choice.key} label={choice.label}>
              {choice.options.map((option) => (
                <Button
                  key={option.value}
                  label={`${option.value === choice.value ? "✓ " : ""}${option.label}`}
                  onPress={() => onChange(choice.key, option.value)}
                />
              ))}
            </Menu>
          ))}
        <Button label="Reset view" onPress={onReset} />
      </Menu>
    </Host>
  );
}
