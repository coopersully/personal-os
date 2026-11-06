import {
  GlassEffectContainer,
  Host,
  HStack,
  Image,
  Rectangle,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityHidden,
  animation,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  offset,
  padding,
  resizable,
} from "@expo/ui/swift-ui/modifiers";
import { useAssets } from "expo-asset";
import { useReducedMotion } from "react-native-reanimated";
import { useTheme, workspaceColor } from "../theme";
import { workspaceMenuAssets } from "./workspace-menu-assets";
import type { WorkspacePickerProps } from "./workspace-picker";

/** SwiftUI renders real system glass; the header owns accessible touch/drag routing. */
export function WorkspacePicker({ selected, options }: WorkspacePickerProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [assets] = useAssets(
    options.flatMap((option) =>
      [false, true].map((filled) => {
        const key = `${theme.dark ? "dark" : "light"}-${option.id}-${filled ? "filled" : "outline"}`;
        return workspaceMenuAssets[key as keyof typeof workspaceMenuAssets];
      }),
    ),
  );
  const selectedIndex = options.findIndex((option) => option.id === selected);
  return (
    <Host style={{ width: 256, height: options.length * 52 + 12 }} ignoreSafeArea="all">
      <ZStack alignment="topLeading" modifiers={[accessibilityHidden(true)]}>
        <Rectangle
          modifiers={[
            foregroundStyle("clear"),
            frame({ width: 256, height: options.length * 52 + 12 }),
            glassEffect({
              glass: { variant: "regular" },
              shape: "roundedRectangle",
              cornerRadius: 26,
            }),
          ]}
        />
        <GlassEffectContainer>
          <ZStack
            alignment="topLeading"
            modifiers={[
              frame({ width: 256, height: options.length * 52 + 12, alignment: "topLeading" }),
            ]}
          >
            {selectedIndex >= 0 && (
              <Rectangle
                modifiers={[
                  foregroundStyle("clear"),
                  frame({ width: 244, height: 48 }),
                  glassEffect({
                    glass: { variant: "regular", interactive: true },
                    shape: "capsule",
                  }),
                  offset({ x: 6, y: 8 + selectedIndex * 52 }),
                  ...(!reduceMotion
                    ? [animation(Animation.snappy({ duration: 0.14 }), selectedIndex)]
                    : []),
                ]}
              />
            )}
          </ZStack>
        </GlassEffectContainer>
        <VStack spacing={0} modifiers={[padding({ all: 6 })]}>
          {options.map((option, index) => (
            <HStack
              key={option.id}
              spacing={6}
              modifiers={[frame({ width: 244, height: 52, alignment: "leading" })]}
            >
              <Image
                uiImage={
                  assets?.[index * 2 + (selected === option.id ? 1 : 0)]?.localUri ?? undefined
                }
                modifiers={[
                  resizable(),
                  frame({ width: 23, height: 23 }),
                  frame({ width: 38, height: 52 }),
                ]}
              />
              <Text
                modifiers={[
                  font({ size: 17, weight: "medium" }),
                  foregroundStyle(
                    selected === option.id ? workspaceColor(theme, option.id) : theme.ink,
                  ),
                ]}
              >
                {option.label}
              </Text>
            </HStack>
          ))}
        </VStack>
      </ZStack>
    </Host>
  );
}
