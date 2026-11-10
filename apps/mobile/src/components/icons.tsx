import { Image, type ImageSourcePropType } from "react-native";

export const icons = {
  reply: require("../../assets/navigation/Reply.png"),
  project: require("../../assets/navigation/Project.png"),
  search: require("../../assets/navigation/Search.png"),
  location: require("../../assets/navigation/MapPin.png"),
  send: require("../../assets/navigation/CircleArrowUp.png"),
  categoryTags: require("../../assets/navigation/Tags.png"),
  categoryLayers: require("../../assets/navigation/Layers.png"),
  categoryCircleHelp: require("../../assets/navigation/CircleHelp.png"),
  categoryGroceryCart: require("../../assets/navigation/GroceryCart.png"),
  categoryDining: require("../../assets/navigation/Dining.png"),
  categoryTransport: require("../../assets/navigation/Transport.png"),
  categoryTravel: require("../../assets/navigation/Travel.png"),
  categoryHealth: require("../../assets/navigation/Health.png"),
  categoryMerchant: require("../../assets/navigation/Merchant.png"),
  categoryDollar: require("../../assets/navigation/Dollar.png"),
  categoryEducation: require("../../assets/navigation/Education.png"),
  categoryGift: require("../../assets/navigation/Gift.png"),
  categoryEntertainment: require("../../assets/navigation/Entertainment.png"),
  categorySparkles: require("../../assets/navigation/Sparkles.png"),

  info: require("../../assets/navigation/Info.png"),
  edit: require("../../assets/navigation/Edit.png"),
  home: require("../../assets/navigation/House.png"),
  star: require("../../assets/navigation/Star.png"),
  people: require("../../assets/navigation/Users.png"),
  cancel: require("../../assets/navigation/X.png"),
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
  project: require("../../assets/navigation/ProjectFilled.png"),
  send: require("../../assets/navigation/CircleArrowUpFilled.png"),
  receipt: require("../../assets/navigation/ReceiptFilled.png"),
  star: require("../../assets/navigation/StarFilled.png"),
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

// Full-color assets for SwiftUI menus, whose UIImage path does not apply template tint.
export const menuIcons = {
  trash: {
    Light: require("../../assets/navigation/TrashMenuLight.png"),
    Dark: require("../../assets/navigation/TrashMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/TrashMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/TrashMenuDestructiveDark.png"),
  },
  archive: {
    Light: require("../../assets/navigation/ArchiveMenuLight.png"),
    Dark: require("../../assets/navigation/ArchiveMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/ArchiveMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/ArchiveMenuDestructiveDark.png"),
  },
  cancel: {
    Light: require("../../assets/navigation/XMenuLight.png"),
    Dark: require("../../assets/navigation/XMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/XMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/XMenuDestructiveDark.png"),
  },
  pin: {
    Light: require("../../assets/navigation/PinMenuLight.png"),
    Dark: require("../../assets/navigation/PinMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/PinMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/PinMenuDestructiveDark.png"),
  },
  settings: {
    Light: require("../../assets/navigation/SettingsMenuLight.png"),
    Dark: require("../../assets/navigation/SettingsMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/SettingsMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/SettingsMenuDestructiveDark.png"),
  },
  check: {
    Light: require("../../assets/navigation/CircleCheckMenuLight.png"),
    Dark: require("../../assets/navigation/CircleCheckMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/CircleCheckMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/CircleCheckMenuDestructiveDark.png"),
  },
  history: {
    Light: require("../../assets/navigation/HistoryMenuLight.png"),
    Dark: require("../../assets/navigation/HistoryMenuDark.png"),
    DestructiveLight: require("../../assets/navigation/HistoryMenuDestructiveLight.png"),
    DestructiveDark: require("../../assets/navigation/HistoryMenuDestructiveDark.png"),
  },
} as const;
