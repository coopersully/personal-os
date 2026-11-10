import { Host, HStack, Image, Menu, Picker, RNHostView, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  disabled,
  frame,
  pickerStyle,
  resizable,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { useAssets } from "expo-asset";
import { useTheme } from "../../theme";
import { enumMenuIcons } from "../enum-menu-icons";
import { icons } from "../icons";
import { EnumChoiceLabel, type EnumChoiceProps } from "./enum-choice-label";

export type { EnumChoiceProps } from "./enum-choice-label";

/** SwiftUI owns popup placement, Liquid Glass, dismissal and platform selection marks. */
export function EnumChoice(props: EnumChoiceProps) {
  const t = useTheme();
  const [assets] = useAssets([
    ...props.options.map(
      (option) =>
        (option.icon ? enumMenuIcons[option.icon]?.[t.dark ? "dark" : "light"] : undefined) ??
        icons.settings,
    ),
  ]);
  const selected =
    props.valueLabel ??
    props.options.find((option) => option.value === props.value)?.label ??
    "None";
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={t.dark ? "dark" : "light"}
      style={{ width: "100%", opacity: props.disabled ? 0.4 : 1 }}
      ignoreSafeArea="all"
    >
      <Menu
        modifiers={[disabled(!!props.disabled), accessibilityLabel(`${props.label}, ${selected}`)]}
        label={
          <RNHostView matchContents={{ vertical: true }}>
            <EnumChoiceLabel {...props} />
          </RNHostView>
        }
      >
        <Picker
          label={props.label}
          selection={props.value}
          onSelectionChange={(value: string | null) => {
            if (
              !props.disabled &&
              value !== null &&
              value !== props.value &&
              props.options.some((option) => option.value === value)
            )
              props.onChange(value);
          }}
          modifiers={[pickerStyle("inline"), disabled(!!props.disabled)]}
        >
          {props.options.map((option, index) => (
            <HStack key={option.value} modifiers={[tag(option.value)]}>
              {option.icon && enumMenuIcons[option.icon] && assets?.[index]?.localUri && (
                <Image
                  uiImage={assets[index].localUri ?? undefined}
                  modifiers={[resizable(), frame({ width: 20, height: 20 })]}
                />
              )}
              <Text>{option.label}</Text>
            </HStack>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}
