import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { IconProps } from "reicon-react";
import ActivitySource from "reicon-react/icons/Activity";
import CircleAlertSource from "reicon-react/icons/AlertCircle";
import AlertTriangleSource from "reicon-react/icons/AlertTriangle";
import ArchiveSource from "reicon-react/icons/Archive";
import ArrowDownSource from "reicon-react/icons/ArrowDown";
import ArrowLeftSource from "reicon-react/icons/ArrowLeft";
import ArrowRightSource from "reicon-react/icons/ArrowRight";
import ArrowUpSource from "reicon-react/icons/ArrowUp";
import ExternalLinkSource from "reicon-react/icons/ArrowUpRightSquare";
import BankSource from "reicon-react/icons/Bank";
import BanknoteSource from "reicon-react/icons/Banknote";
import CalendarSource from "reicon-react/icons/Calendar";
import CalendarPlusSource from "reicon-react/icons/CalendarAdd";
import CheckSource from "reicon-react/icons/Check";
import CircleCheckSource from "reicon-react/icons/CheckCircle";
import CheckSquareSource from "reicon-react/icons/CheckSquare";
import ChevronDownSource from "reicon-react/icons/ChevronDown";
import ChevronLeftSource from "reicon-react/icons/ChevronLeft";
import ChevronRightSource from "reicon-react/icons/ChevronRight";
import ChevronUpSource from "reicon-react/icons/ChevronUp";
import ClipboardSource from "reicon-react/icons/Clipboard";
import ClockSource from "reicon-react/icons/Clock";
import CloudSource from "reicon-react/icons/Cloud";
import CloudRainSource from "reicon-react/icons/CloudRain";
import CommandSource from "reicon-react/icons/Command";
import CompassSource from "reicon-react/icons/Compass";
import CopySource from "reicon-react/icons/Copy";
import AgentSource from "reicon-react/icons/Cpu";
import CopyPlusSource from "reicon-react/icons/DocumentCopy";
import DollarSource from "reicon-react/icons/Dollar";
import DownloadSource from "reicon-react/icons/Download";
import EditSource from "reicon-react/icons/Edit";
import MailSource from "reicon-react/icons/Envelope";
import EyeSource from "reicon-react/icons/Eye";
import EyeOffSource from "reicon-react/icons/EyeSlash";
import FileTextSource from "reicon-react/icons/FileText";
import LocationFixedSource from "reicon-react/icons/Gps";
import GridSource from "reicon-react/icons/Grid";
import ColumnsSource from "reicon-react/icons/Grid3";
import ApprovalHandSource from "reicon-react/icons/Hand";
import CircleHelpSource from "reicon-react/icons/HelpCircle";
import HouseSource from "reicon-react/icons/Home";
import ImageSource from "reicon-react/icons/Image";
import InboxSource from "reicon-react/icons/Inbox";
import InfoSource from "reicon-react/icons/InfoCircle";
import KeySource from "reicon-react/icons/Key";
import LayersSource from "reicon-react/icons/Layers";
import ListChecksSource from "reicon-react/icons/ListCheck";
import LoaderSource from "reicon-react/icons/Loader";
import MapPinSource from "reicon-react/icons/Location";
import LockSource from "reicon-react/icons/Lock";
import LogOutSource from "reicon-react/icons/Logout";
import MenuSource from "reicon-react/icons/Menu";
import MinusSource from "reicon-react/icons/Minus";
import MonitorSource from "reicon-react/icons/Monitor";
import MoonSource from "reicon-react/icons/Moon";
import MoreHorizontalSource from "reicon-react/icons/MoreH";
import PaintBrushSource from "reicon-react/icons/Paintbrush";
import PinSource from "reicon-react/icons/PinTack";
import PlugSource from "reicon-react/icons/Plug";
import PlusSource from "reicon-react/icons/Plus";
import PulseSource from "reicon-react/icons/Pulse";
import ReceiptSource from "reicon-react/icons/Receipt";
import CircleSource from "reicon-react/icons/Record";
import RefreshSource from "reicon-react/icons/Refresh";
import ReplySource from "reicon-react/icons/Reply";
import ScissorsSource from "reicon-react/icons/Scissors";
import SearchSource from "reicon-react/icons/Search";
import SettingsSource from "reicon-react/icons/Settings";
import ShieldCheckSource from "reicon-react/icons/ShieldCheck";
import PanelLeftSource from "reicon-react/icons/Sidebar";
import PanelTopSource from "reicon-react/icons/SidebarTop";
import SideProfileSource from "reicon-react/icons/SideProfile";
import SliderHorizontalSource from "reicon-react/icons/Sliders";
import SortSource from "reicon-react/icons/SortV";
import SparklesSource from "reicon-react/icons/Sparkles";
import StarSource from "reicon-react/icons/Star";
import SunSource from "reicon-react/icons/Sun";
import TargetSource from "reicon-react/icons/Target";
import ListTodoSource from "reicon-react/icons/Task";
import TrashSource from "reicon-react/icons/Trash2";
import UserSource from "reicon-react/icons/User";
import UserCircleSource from "reicon-react/icons/UserCircle";
import UsersSource from "reicon-react/icons/Users";
import VideoAddSource from "reicon-react/icons/VideoAdd";
import WalletSource from "reicon-react/icons/Wallet";
import WifiOffSource from "reicon-react/icons/WifiOff";
import XSource from "reicon-react/icons/X";
import ErrorSource from "reicon-react/icons/XCircle";

/**
 * The single icon vocabulary for the web application.
 *
 * Every glyph in ilo comes from reicon-react and is reached through this module. Importing an icon
 * package directly, or importing `reicon-react` anywhere else, fails `scripts/check-icon-contract.mjs`.
 * See `docs/design/system.md` for the icon contract.
 *
 * Icons are imported from per-icon subpaths rather than the package barrel, which re-exports 2,674
 * modules and would slow every bundle and cold dev start. Each glyph is re-exported as `Icon`
 * rather than re-exported directly, so the props the contract forbids are a type error at the call
 * site instead of a review comment.
 */

/**
 * Icon color comes from semantic `text-*` tokens, never a prop, so `color` is removed. In
 * reicon-react 1.2.0 `strokeWidth` only affects the 1,111 of 2,674 icons whose markup carries a
 * `stroke-width` attribute, and `secondaryColor` is accepted and then discarded; both are removed
 * rather than left as props that silently do nothing. Size comes from CSS, so `size` is removed:
 * reicon emits `width`/`height` attributes that a `size-*` class always overrides, making the prop
 * a silent no-op wherever a primitive sizes its icons. `children` is removed because reicon renders
 * through `dangerouslySetInnerHTML` and discards them, so a nested `<title>` never reaches the DOM.
 */
export type Icon = ForwardRefExoticComponent<
  Omit<IconProps, "children" | "color" | "secondaryColor" | "size" | "strokeWidth"> &
    RefAttributes<SVGSVGElement>
>;

export const ActivityIcon: Icon = ActivitySource;
export const CircleAlertIcon: Icon = CircleAlertSource;
export const AlertTriangleIcon: Icon = AlertTriangleSource;
export const ArchiveIcon: Icon = ArchiveSource;
export const ArrowDownIcon: Icon = ArrowDownSource;
export const ArrowLeftIcon: Icon = ArrowLeftSource;
export const ArrowRightIcon: Icon = ArrowRightSource;
export const ArrowUpIcon: Icon = ArrowUpSource;
export const ExternalLinkIcon: Icon = ExternalLinkSource;
export const BankIcon: Icon = BankSource;
export const BanknoteIcon: Icon = BanknoteSource;
export const CalendarIcon: Icon = CalendarSource;
export const CalendarPlusIcon: Icon = CalendarPlusSource;
export const CheckIcon: Icon = CheckSource;
export const CircleCheckIcon: Icon = CircleCheckSource;
export const CheckSquareIcon: Icon = CheckSquareSource;
export const ChevronDownIcon: Icon = ChevronDownSource;
export const ChevronLeftIcon: Icon = ChevronLeftSource;
export const ChevronRightIcon: Icon = ChevronRightSource;
export const ChevronUpIcon: Icon = ChevronUpSource;
export const ClipboardIcon: Icon = ClipboardSource;
export const ClockIcon: Icon = ClockSource;
export const CloudIcon: Icon = CloudSource;
export const CloudRainIcon: Icon = CloudRainSource;
export const CommandIcon: Icon = CommandSource;
export const CompassIcon: Icon = CompassSource;
export const CopyIcon: Icon = CopySource;
export const AgentIcon: Icon = AgentSource;
export const CopyPlusIcon: Icon = CopyPlusSource;
export const DollarIcon: Icon = DollarSource;
export const DownloadIcon: Icon = DownloadSource;
export const EditIcon: Icon = EditSource;
export const MailIcon: Icon = MailSource;
export const EyeIcon: Icon = EyeSource;
export const EyeOffIcon: Icon = EyeOffSource;
export const FileTextIcon: Icon = FileTextSource;
export const LocationFixedIcon: Icon = LocationFixedSource;
export const GridIcon: Icon = GridSource;
export const ColumnsIcon: Icon = ColumnsSource;
export const ApprovalHandIcon: Icon = ApprovalHandSource;
export const CircleHelpIcon: Icon = CircleHelpSource;
export const HouseIcon: Icon = HouseSource;
export const ImageIcon: Icon = ImageSource;
export const InboxIcon: Icon = InboxSource;
export const InfoIcon: Icon = InfoSource;
export const KeyIcon: Icon = KeySource;
export const LayersIcon: Icon = LayersSource;
export const ListChecksIcon: Icon = ListChecksSource;
export const LoaderIcon: Icon = LoaderSource;
export const MapPinIcon: Icon = MapPinSource;
export const LockIcon: Icon = LockSource;
export const LogOutIcon: Icon = LogOutSource;
export const MenuIcon: Icon = MenuSource;
export const MinusIcon: Icon = MinusSource;
export const MonitorIcon: Icon = MonitorSource;
export const MoonIcon: Icon = MoonSource;
export const MoreHorizontalIcon: Icon = MoreHorizontalSource;
export const PaintBrushIcon: Icon = PaintBrushSource;
export const PinIcon: Icon = PinSource;
export const PlugIcon: Icon = PlugSource;
export const PlusIcon: Icon = PlusSource;
export const PulseIcon: Icon = PulseSource;
export const ReceiptIcon: Icon = ReceiptSource;
export const CircleIcon: Icon = CircleSource;
export const RefreshIcon: Icon = RefreshSource;
export const ReplyIcon: Icon = ReplySource;
export const ScissorsIcon: Icon = ScissorsSource;
export const SearchIcon: Icon = SearchSource;
export const SettingsIcon: Icon = SettingsSource;
export const ShieldCheckIcon: Icon = ShieldCheckSource;
export const PanelLeftIcon: Icon = PanelLeftSource;
export const PanelTopIcon: Icon = PanelTopSource;
export const SideProfileIcon: Icon = SideProfileSource;
export const SliderHorizontalIcon: Icon = SliderHorizontalSource;
export const SortIcon: Icon = SortSource;
export const SparklesIcon: Icon = SparklesSource;
export const StarIcon: Icon = StarSource;
export const SunIcon: Icon = SunSource;
export const TargetIcon: Icon = TargetSource;
export const ListTodoIcon: Icon = ListTodoSource;
export const TrashIcon: Icon = TrashSource;
export const UserIcon: Icon = UserSource;
export const UserCircleIcon: Icon = UserCircleSource;
export const UsersIcon: Icon = UsersSource;
export const VideoAddIcon: Icon = VideoAddSource;
export const WalletIcon: Icon = WalletSource;
export const WifiOffIcon: Icon = WifiOffSource;
export const XIcon: Icon = XSource;
export const ErrorIcon: Icon = ErrorSource;
