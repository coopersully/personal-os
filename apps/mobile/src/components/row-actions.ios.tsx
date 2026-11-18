import { Button, Host, HStack, Image, Menu, Section, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  disabled,
  font,
  foregroundStyle,
  frame,
} from "@expo/ui/swift-ui/modifiers";
import { useAssets } from "expo-asset";
import { touchTarget, useTheme } from "../theme";
import { icons, menuIcons } from "./icons";
import { RowActionButton, type RowActionsProps } from "./row-action-button";
/** One direct action; multiple actions use the system dropdown. */
export function RowActions({ label, actions, placement }: RowActionsProps) {
  const t = useTheme();
  const ordered = [
    ...actions.filter((a) => !a.destructive),
    ...actions.filter((a) => a.destructive),
  ];
  const [assets] = useAssets(
    ordered.map((a) => {
      const tone = `${a.destructive ? "Destructive" : ""}${t.dark ? "Dark" : "Light"}` as
        | "Light"
        | "Dark"
        | "DestructiveLight"
        | "DestructiveDark";
      return a.icon in menuIcons
        ? menuIcons[a.icon as keyof typeof menuIcons][tone]
        : icons[a.icon];
    }),
  );
  if (!actions.length) return null;
  if (actions.length === 1) return <RowActionButton action={actions[0]} placement={placement} />;
  return (
    <Host
      colorScheme={t.dark ? "dark" : "light"}
      style={{ width: touchTarget, height: touchTarget, alignSelf: "flex-start" }}
      ignoreSafeArea="all"
    >
      <Menu
        modifiers={[accessibilityLabel(label)]}
        label={
          <Text
            modifiers={[
              font({ size: 26, weight: "semibold" }),
              foregroundStyle(t.ink),
              frame({
                width: touchTarget,
                height: touchTarget,
                alignment: placement === "header" ? "center" : "topTrailing",
              }),
            ]}
          >
            ⋮
          </Text>
        }
      >
        {[false, true].map((dangerous) => (
          <Section key={String(dangerous)}>
            {ordered.map((action, index) =>
              (action.destructive === true) === dangerous ? (
                <Button
                  key={action.id}
                  onPress={action.onPress}
                  role={action.destructive ? "destructive" : "default"}
                  modifiers={[disabled(!!action.disabled)]}
                >
                  <HStack>
                    <Text modifiers={[foregroundStyle(action.destructive ? t.destructive : t.ink)]}>
                      {action.label}
                    </Text>
                    {assets?.[index]?.localUri && (
                      <Image
                        uiImage={assets[index].localUri ?? undefined}
                        modifiers={[frame({ width: 20, height: 20 })]}
                      />
                    )}
                  </HStack>
                </Button>
              ) : null,
            )}
          </Section>
        ))}
      </Menu>
    </Host>
  );
}
