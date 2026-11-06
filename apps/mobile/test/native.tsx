import { type PropsWithChildren, type ReactNode, useState } from "react";

// Accessible event adapter for application behavior tests, not native layout/glass assertions.
type Props = PropsWithChildren<{
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { checked?: boolean; expanded?: boolean; selected?: boolean };
  testID?: string;
}>;
export const Platform = { OS: "web" };
export const StyleSheet = {
  create: <T,>(value: T) => value,
  hairlineWidth: 1,
  absoluteFillObject: {},
};
export const useColorScheme = () => "light";
export const useWindowDimensions = () => ({ width: 390, height: 844 });
export const View = ({ children, testID }: Props) => <div data-testid={testID}>{children}</div>;
export const Text = ({ children, accessibilityRole }: Props) =>
  accessibilityRole === "header" ? <h2>{children}</h2> : <span>{children}</span>;
export const ScrollView = View;
export const KeyboardAvoidingView = View;
export const ActivityIndicator = () => <span role="progressbar" />;
export const Image = ({ accessibilityLabel }: Props) => (
  <span role="img" aria-label={accessibilityLabel ?? "Image"} />
);
export function Pressable({
  children,
  onPress,
  onLongPress,
  onHoverIn,
  onHoverOut,
  disabled,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  style,
}: Props & {
  onPress?: () => void;
  onLongPress?: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  disabled?: boolean;
  style?: unknown;
}) {
  const [pressed, setPressed] = useState(false);
  if (typeof style === "function") style({ pressed });
  const semantics = {
    role: accessibilityRole ?? "button",
    ...(accessibilityRole === "checkbox" || accessibilityRole === "radio"
      ? { "aria-checked": accessibilityState?.checked ?? false }
      : {}),
  };
  return (
    <button
      type="button"
      aria-label={accessibilityLabel}
      {...semantics}
      aria-expanded={accessibilityState?.expanded}
      aria-pressed={accessibilityState?.selected}
      disabled={disabled}
      onClick={onPress}
      onContextMenu={(event) => {
        event.preventDefault();
        onLongPress?.();
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      {children}
    </button>
  );
}
export function TextInput({
  value,
  onChangeText,
  accessibilityLabel,
  placeholder,
  onBlur,
  onFocus,
  onSubmitEditing,
  editable,
  secureTextEntry,
}: {
  value?: string;
  onChangeText?: (value: string) => void;
  accessibilityLabel?: string;
  placeholder?: string;
  onBlur?: () => void;
  onFocus?: () => void;
  onSubmitEditing?: () => void;
  editable?: boolean;
  secureTextEntry?: boolean;
}) {
  return (
    <input
      aria-label={accessibilityLabel}
      placeholder={placeholder}
      value={value ?? ""}
      type={secureTextEntry ? "password" : "text"}
      disabled={editable === false}
      onChange={(event) => onChangeText?.(event.target.value)}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmitEditing?.();
      }}
    />
  );
}
export const Modal = ({ visible, children }: Props & { visible: boolean }) =>
  visible ? <div role="dialog">{children}</div> : null;
export const Switch = ({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) => (
  <input
    type="checkbox"
    role="switch"
    aria-checked={value}
    aria-label={accessibilityLabel}
    checked={value}
    disabled={disabled}
    onChange={(event) => onValueChange(event.target.checked)}
  />
);
export const RefreshControl = ({ onRefresh }: { onRefresh: () => void }) => (
  <button type="button" onClick={onRefresh}>
    Refresh list
  </button>
);
export function FlatList<T>({
  data,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  refreshControl,
}: {
  data: T[];
  renderItem: (entry: { item: T; index: number }) => ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  refreshControl?: ReactNode;
}) {
  return (
    <div>
      {ListHeaderComponent}
      {refreshControl}
      {data.length
        ? data.map((item, index) => (
            <div key={keyExtractor?.(item, index) ?? index}>{renderItem({ item, index })}</div>
          ))
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  );
}
