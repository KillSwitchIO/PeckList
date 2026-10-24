// Line icons a list can wear instead of an emoji, drawn in the list's color. Stored in the list's
// `icon` as `symbol:<name>`, so the schema needs no change.
import type { SvgIconComponent } from '@mui/icons-material';
import BeachAccessOutlined from '@mui/icons-material/BeachAccessOutlined';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CardGiftcardOutlined from '@mui/icons-material/CardGiftcardOutlined';
import CelebrationOutlined from '@mui/icons-material/CelebrationOutlined';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import CleaningServicesOutlined from '@mui/icons-material/CleaningServicesOutlined';
import CodeRounded from '@mui/icons-material/CodeRounded';
import ComputerOutlined from '@mui/icons-material/ComputerOutlined';
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined';
import DirectionsRunRounded from '@mui/icons-material/DirectionsRunRounded';
import DnsOutlined from '@mui/icons-material/DnsOutlined';
import FamilyRestroomRounded from '@mui/icons-material/FamilyRestroomRounded';
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded';
import FitnessCenterOutlined from '@mui/icons-material/FitnessCenterOutlined';
import FlightRounded from '@mui/icons-material/FlightRounded';
import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import InventoryOutlined from '@mui/icons-material/InventoryOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import LocalFloristOutlined from '@mui/icons-material/LocalFloristOutlined';
import LuggageOutlined from '@mui/icons-material/LuggageOutlined';
import MedicalServicesOutlined from '@mui/icons-material/MedicalServicesOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import OutlinedFlagRounded from '@mui/icons-material/OutlinedFlagRounded';
import ParkOutlined from '@mui/icons-material/ParkOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PetsOutlined from '@mui/icons-material/PetsOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import RestaurantOutlined from '@mui/icons-material/RestaurantOutlined';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import SmartphoneOutlined from '@mui/icons-material/SmartphoneOutlined';
import SportsEsportsOutlined from '@mui/icons-material/SportsEsportsOutlined';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import WorkOutlineRounded from '@mui/icons-material/WorkOutlineRounded';

export const SYMBOL_PREFIX = 'symbol:';

/** Name to icon, in the order the picker shows them. */
export const LIST_SYMBOLS: Readonly<Record<string, SvgIconComponent>> = {
  list: FormatListBulletedRounded,
  checklist: ChecklistRounded,
  star: StarBorderRounded,
  flag: OutlinedFlagRounded,
  idea: LightbulbOutlined,
  calendar: CalendarMonthOutlined,
  work: WorkOutlineRounded,
  home: HomeOutlined,
  family: FamilyRestroomRounded,
  cart: ShoppingCartOutlined,
  food: RestaurantOutlined,
  money: PaymentsOutlined,
  bills: ReceiptLongOutlined,
  books: MenuBookOutlined,
  school: SchoolOutlined,
  fitness: FitnessCenterOutlined,
  running: DirectionsRunRounded,
  health: MedicalServicesOutlined,
  heart: FavoriteBorderRounded,
  pets: PetsOutlined,
  garden: LocalFloristOutlined,
  outdoors: ParkOutlined,
  car: DirectionsCarOutlined,
  flight: FlightRounded,
  travel: LuggageOutlined,
  beach: BeachAccessOutlined,
  games: SportsEsportsOutlined,
  music: MusicNoteRounded,
  movies: MovieOutlined,
  gifts: CardGiftcardOutlined,
  party: CelebrationOutlined,
  tools: BuildOutlined,
  cleaning: CleaningServicesOutlined,
  boxes: InventoryOutlined,
  computer: ComputerOutlined,
  phone: SmartphoneOutlined,
  code: CodeRounded,
  server: DnsOutlined,
  printing: PrintOutlined,
};

/** The line icon a list's `icon` names, or null for an emoji, an unknown name or none. */
export function symbolOf(icon: string | null | undefined): SvgIconComponent | null {
  if (!icon?.startsWith(SYMBOL_PREFIX)) return null;
  return LIST_SYMBOLS[icon.slice(SYMBOL_PREFIX.length)] ?? null;
}
