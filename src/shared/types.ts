export interface Participant {
  id: string;
  name: string;
  appearance: string;
  isBot: boolean;
  position: number;
  money: number;
  bankruptedAt: string | null;
  debtTo: string | null;
  connectivity: 'stable' | 'unstable' | 'disconnected';
  connectivityKickAt: string | null;
  timedVotekickAt: string | null;
  votekickedAt: string | null;
}

export type BlockType = 'city' | 'airport' | 'company' | 'corner' | 'bonus' | 'tax';
export type CornerType = 'go' | 'prison' | 'vacation' | 'go_to_prison';
export type BonusType = 'treasure' | 'surprise';

export interface CityBlock {
  type: 'city';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
  countryId: string;
  rentPrices: Record<'0' | '1' | '2' | '3' | '4' | '5', number>;
  level: number;
  housePrice: number;
  hotelPrice: number;
}

export interface AirportBlock {
  type: 'airport';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
  rentPrices: [number, number, number, number];
}

export interface CompanyBlock {
  type: 'company';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
}

export interface CornerBlock {
  type: 'corner';
  name: string;
  cornerType: CornerType;
}

export interface BonusBlock {
  type: 'bonus';
  name: string;
  bonusType: BonusType;
}

export interface TaxBlock {
  type: 'tax';
  name: string;
}

export type Block =
  | CityBlock
  | AirportBlock
  | CompanyBlock
  | CornerBlock
  | BonusBlock
  | TaxBlock;

export interface BoardConfig {
  goReward: { land: number; pass: number };
  prisonBlockIndex: number;
  goToPrisonBlockIndex: number;
  vacationBlockIndex: number;
}

export interface GameSettings {
  maxPlayers: number;
  canBotsJoin: boolean;
  isPrivate: boolean;
  onlyUsers: boolean;
  payDoubleRentWhenOwnFullSet: boolean;
  vacationCash: boolean;
  auction: boolean;
  noRentPaymentsWhileInPrison: boolean;
  mortgage: boolean;
  startingCash: number;
  evenBuild: boolean;
  shufflePlayerOrder: boolean;
}

export interface GameStats {
  turnsCount: number;
  startedAt: string | null;
  endedAt: string | null;
  doublesCount: number;
  chatMessagesCount: number;
  tradesCount: number;
  leaderboard: Record<string, number>;
  heatMap: Record<string, number>;
  netWorths: Record<string, number>;
  prisonVisits: Record<string, number>;
  allParticipants: Participant[];
}

export interface Auction {
  blockIndex: number;
  bids: Record<string, number>;
  endAt: string;
}

export interface TradeOffer {
  money: number;
  blockIndexes: number[];
}

export interface Trade {
  id: string;
  fromId: string;
  toId: string;
  offer: TradeOffer;
  request: TradeOffer;
}

export interface BonusCard {
  id: string;
  type: BonusType;
  effect: string;
}

export interface GameState {
  id: string;
  phase: 'lobby' | 'playing' | 'ended';
  participants: Participant[];
  currentPlayerIndex: number;
  mapId: string;
  blocks: Block[];
  boardConfig: BoardConfig;
  dice: [number, number];
  cubesRolledInTurn: boolean;
  canPerformTurnActions: boolean;
  doublesInARow: number;
  auction: Auction | null;
  trades: Trade[];
  bonusCards: BonusCard[];
  vacationCash: number;
  settings: GameSettings;
  hostId: string;
  winnerId: string | null;
  stats: GameStats;
}

export interface RootStoreState {
  state: GameState;
  selfParticipantId: string;
  isReady: boolean;
  isOnline: boolean;
  logs: string[];
  animation: { phase: string };
  setInitialState: Function;
  applyServerAction: Function;
  syncState: Function;
  setOnlineStatus: Function;
  addLog: Function;
  resetLogs: Function;
}

export interface ZustandStore {
  getState: () => RootStoreState;
  subscribe: (
    listener: (state: RootStoreState, prev: RootStoreState) => void,
  ) => () => void;
  setState: Function;
  getInitialState: Function;
}

export interface RUESettings {
  overlaysEnabled: boolean;
  showInfoMenu: boolean;
  showLandingChips: boolean;
  showLandingChipsForCurrentTurn: boolean;
  bindSpaceToRoll: boolean;
  overlayOpacity: number;
}
