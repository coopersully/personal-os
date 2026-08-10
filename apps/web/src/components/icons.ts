import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { IconProps } from "reicon-react";

/**
 * The single icon vocabulary for the web application.
 *
 * Every glyph in ilo comes from reicon-react and is reached through this module. Importing an icon
 * package directly, or importing `reicon-react` anywhere else, fails `scripts/check-icon-contract.mjs`.
 * See `docs/design/system.md` for the icon contract.
 *
 * Icons are imported from per-icon subpaths rather than the package barrel, which re-exports 2,674
 * modules and would slow every bundle and cold dev start.
 */

/**
 * Icon color comes from semantic `text-*` tokens, never a prop, so `color` is removed. In
 * reicon-react 1.2.0 `strokeWidth` only affects the 1,111 of 2,674 icons whose markup carries a
 * `stroke-width` attribute, and `secondaryColor` is accepted and then discarded; both are removed
 * rather than left as props that silently do nothing.
 */
export type Icon = ForwardRefExoticComponent<
  Omit<IconProps, "color" | "secondaryColor" | "strokeWidth"> & RefAttributes<SVGSVGElement>
>;

export { default as ActivityIcon } from "reicon-react/icons/Activity";
export { default as CircleAlertIcon } from "reicon-react/icons/AlertCircle";
export { default as AlertTriangleIcon } from "reicon-react/icons/AlertTriangle";
export { default as ArchiveIcon } from "reicon-react/icons/Archive";
export { default as ArrowDownIcon } from "reicon-react/icons/ArrowDown";
export { default as ArrowLeftIcon } from "reicon-react/icons/ArrowLeft";
export { default as ArrowRightIcon } from "reicon-react/icons/ArrowRight";
export { default as ArrowUpIcon } from "reicon-react/icons/ArrowUp";
export { default as ExternalLinkIcon } from "reicon-react/icons/ArrowUpRightSquare";
export { default as BankIcon } from "reicon-react/icons/Bank";
export { default as BanknoteIcon } from "reicon-react/icons/Banknote";
export { default as CalendarIcon } from "reicon-react/icons/Calendar";
export { default as CalendarPlusIcon } from "reicon-react/icons/CalendarAdd";
export { default as CheckIcon } from "reicon-react/icons/Check";
export { default as CircleCheckIcon } from "reicon-react/icons/CheckCircle";
export { default as CheckSquareIcon } from "reicon-react/icons/CheckSquare";
export { default as ChevronDownIcon } from "reicon-react/icons/ChevronDown";
export { default as ChevronLeftIcon } from "reicon-react/icons/ChevronLeft";
export { default as ChevronRightIcon } from "reicon-react/icons/ChevronRight";
export { default as ChevronUpIcon } from "reicon-react/icons/ChevronUp";
export { default as ClipboardIcon } from "reicon-react/icons/Clipboard";
export { default as ClockIcon } from "reicon-react/icons/Clock";
export { default as CloudIcon } from "reicon-react/icons/Cloud";
export { default as CloudRainIcon } from "reicon-react/icons/CloudRain";
export { default as CommandIcon } from "reicon-react/icons/Command";
export { default as CompassIcon } from "reicon-react/icons/Compass";
export { default as CopyIcon } from "reicon-react/icons/Copy";
export { default as AgentIcon } from "reicon-react/icons/Cpu";
export { default as CopyPlusIcon } from "reicon-react/icons/DocumentCopy";
export { default as DollarIcon } from "reicon-react/icons/Dollar";
export { default as DownloadIcon } from "reicon-react/icons/Download";
export { default as EditIcon } from "reicon-react/icons/Edit";
export { default as MailIcon } from "reicon-react/icons/Envelope";
export { default as EyeIcon } from "reicon-react/icons/Eye";
export { default as EyeOffIcon } from "reicon-react/icons/EyeSlash";
export { default as FileTextIcon } from "reicon-react/icons/FileText";
export { default as LocationFixedIcon } from "reicon-react/icons/Gps";
export { default as GridIcon } from "reicon-react/icons/Grid";
export { default as ColumnsIcon } from "reicon-react/icons/Grid3";
export { default as CircleHelpIcon } from "reicon-react/icons/HelpCircle";
export { default as HouseIcon } from "reicon-react/icons/Home";
export { default as ImageIcon } from "reicon-react/icons/Image";
export { default as InboxIcon } from "reicon-react/icons/Inbox";
export { default as InfoIcon } from "reicon-react/icons/InfoCircle";
export { default as KeyIcon } from "reicon-react/icons/Key";
export { default as LayersIcon } from "reicon-react/icons/Layers";
export { default as ListChecksIcon } from "reicon-react/icons/ListCheck";
export { default as LoaderIcon } from "reicon-react/icons/Loader";
export { default as MapPinIcon } from "reicon-react/icons/Location";
export { default as LockIcon } from "reicon-react/icons/Lock";
export { default as LogOutIcon } from "reicon-react/icons/Logout";
export { default as MenuIcon } from "reicon-react/icons/Menu";
export { default as MinusIcon } from "reicon-react/icons/Minus";
export { default as MonitorIcon } from "reicon-react/icons/Monitor";
export { default as MoonIcon } from "reicon-react/icons/Moon";
export { default as MoreHorizontalIcon } from "reicon-react/icons/MoreH";
export { default as PaintBrushIcon } from "reicon-react/icons/Paintbrush";
export { default as PinIcon } from "reicon-react/icons/Pin";
export { default as PlugIcon } from "reicon-react/icons/Plug";
export { default as PlusIcon } from "reicon-react/icons/Plus";
export { default as PulseIcon } from "reicon-react/icons/Pulse";
export { default as ReceiptIcon } from "reicon-react/icons/Receipt";
export { default as CircleIcon } from "reicon-react/icons/Record";
export { default as RefreshIcon } from "reicon-react/icons/Refresh";
export { default as ReplyIcon } from "reicon-react/icons/Reply";
export { default as ScissorsIcon } from "reicon-react/icons/Scissors";
export { default as SearchIcon } from "reicon-react/icons/Search";
export { default as SettingsIcon } from "reicon-react/icons/Settings";
export { default as ShieldCheckIcon } from "reicon-react/icons/ShieldCheck";
export { default as PanelLeftIcon } from "reicon-react/icons/Sidebar";
export { default as PanelTopIcon } from "reicon-react/icons/SidebarTop";
export { default as SideProfileIcon } from "reicon-react/icons/SideProfile";
export { default as SliderHorizontalIcon } from "reicon-react/icons/SliderHorizontal";
export { default as SortIcon } from "reicon-react/icons/Sort";
export { default as SparklesIcon } from "reicon-react/icons/Sparkles";
export { default as StarIcon } from "reicon-react/icons/Star";
export { default as StopIcon } from "reicon-react/icons/StopCircle";
export { default as SunIcon } from "reicon-react/icons/Sun";
export { default as TargetIcon } from "reicon-react/icons/Target";
export { default as ListTodoIcon } from "reicon-react/icons/Task";
export { default as TrashIcon } from "reicon-react/icons/Trash";
export { default as UserIcon } from "reicon-react/icons/User";
export { default as UserCircleIcon } from "reicon-react/icons/UserCircle";
export { default as UsersIcon } from "reicon-react/icons/Users";
export { default as WalletIcon } from "reicon-react/icons/Wallet";
export { default as WifiOffIcon } from "reicon-react/icons/WifiOff";
export { default as XIcon } from "reicon-react/icons/X";
