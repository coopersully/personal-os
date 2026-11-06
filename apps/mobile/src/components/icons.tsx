import { Image, type ImageSourcePropType } from "react-native";

export const icons = {
  home: require("../../assets/navigation/House.png"),
  star: require("../../assets/navigation/Star.png"),
  people: require("../../assets/navigation/Users.png"),
  trash: require("../../assets/navigation/Trash.png"),
  save: require("../../assets/navigation/Check.png"),
  add: require("../../assets/navigation/Plus.png"),
  views: require("../../assets/navigation/ListTodo.png"),
  pin: require("../../assets/navigation/Pin.png"),
  history: require("../../assets/navigation/History.png"),
  inbox: require("../../assets/navigation/Inbox.png"),
  grid: require("../../assets/navigation/Grid.png"),
  wallet: require("../../assets/navigation/Wallet.png"),
  settings: require("../../assets/navigation/Settings.png"),
  target: require("../../assets/navigation/Target.png"),

  today: require("../../assets/navigation/Sun.png"),
  mail: require("../../assets/navigation/Mail.png"),
  tasks: require("../../assets/navigation/ListChecks.png"),
  calendar: require("../../assets/navigation/Calendar.png"),
  finances: require("../../assets/navigation/Bank.png"),
  clock: require("../../assets/navigation/Clock.png"),
  check: require("../../assets/navigation/CircleCheck.png"),
  attention: require("../../assets/navigation/CircleAlert.png"),
  chevron: require("../../assets/navigation/ChevronRight.png"),
  receipt: require("../../assets/navigation/Receipt.png"),
  archive: require("../../assets/navigation/Archive.png"),
  profile: require("../../assets/navigation/User.png"),
  disconnected: require("../../assets/navigation/LinkOff.png"),
} satisfies Record<string, ImageSourcePropType>;

export type IconName = keyof typeof icons;
export const selectedIcons = {
  profile: require("../../assets/navigation/UserFilled.png"),
  views: require("../../assets/navigation/ListTodoFilled.png"),
  pin: require("../../assets/navigation/PinFilled.png"),
  history: require("../../assets/navigation/HistoryFilled.png"),
  inbox: require("../../assets/navigation/InboxFilled.png"),
  grid: require("../../assets/navigation/GridFilled.png"),
  wallet: require("../../assets/navigation/WalletFilled.png"),
  settings: require("../../assets/navigation/SettingsFilled.png"),
  target: require("../../assets/navigation/TargetFilled.png"),

  today: require("../../assets/navigation/SunFilled.png"),
  mail: require("../../assets/navigation/MailFilled.png"),
  tasks: require("../../assets/navigation/ListChecksFilled.png"),
  calendar: require("../../assets/navigation/CalendarFilled.png"),
  finances: require("../../assets/navigation/BankFilled.png"),
} satisfies Record<string, ImageSourcePropType>;
export function Icon({
  name,
  color,
  size = 20,
  filled = false,
}: {
  name: IconName;
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <Image
      accessible={false}
      source={
        filled && name in selectedIcons
          ? selectedIcons[name as keyof typeof selectedIcons]
          : icons[name]
      }
      style={{ width: size, height: size, tintColor: color }}
    />
  );
}
