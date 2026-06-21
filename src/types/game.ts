import { Card, CardType } from "./cards.js";

// ============================================================
// PLAYER
// ============================================================
export interface Player {
  sessionId: string;
  username: string;
  hand: Card[];
  isAlive: boolean;
  hasBunker: boolean;       // Bunker card di depan player
  isLocked: boolean;        // kena Lockdown, skip main kartu
  connected: boolean;
  // Status AFK manual — pemain sendiri yang toggle ini ("aku away sebentar").
  // Berbeda dari `connected: false` (terdeteksi otomatis dari disconnect).
  // Baik away maupun disconnected memicu auto-play untuk giliran pemain ini.
  away: boolean;
}

// ============================================================
// PENDING ACTION — untuk kartu yang butuh input tambahan
// ============================================================
export type PendingActionType =
  | "WATER_BUCKET_PLACE"    // pilih posisi taruh Lava Cat
  | "BRIBE_WAITING"         // nunggu target kasih kartu
  | "SNIPER_TARGET"         // pilih target sniper
  | "PEEK_AND_SWAP_DECIDE"  // decide swap atau tidak
  | "PICKPOCKET_TARGET"     // pilih target pickpocket
  | "GANG_PAIR_TARGET"      // pilih target steal
  | "GANG_TRIPLE_TARGET"    // pilih target + kartu spesifik
  | "GANG_QUAD_EXECUTING"   // steal dari semua
  | "GANG_RAINBOW_TARGET"   // pilih target swap tangan
  | "FLOOD_WAITING"         // nunggu semua buang kartu
  | "AWAITING_FREEZE";      // window waktu untuk Freeze sebelum efek kartu dieksekusi

// Deskripsi efek kartu yang ditunda selama window Freeze. Disimpan sebagai data
// serializable (bukan closure function) supaya bisa dikirim ke client untuk
// ditampilkan ("Budi memainkan Eruption... 3 2 1") dan supaya state tetap
// plain-object (gampang di-log/debug).
export interface DeferredEffect {
  cardType: string;       // CardType dari kartu yang dimainkan
  initiatorId: string;
  targetId?: string;
  targetCardId?: string;
  cardIds?: string[];     // untuk gang combo (multi-card)
}

export interface PendingAction {
  type: PendingActionType;
  initiatorId: string;
  targetId?: string;
  data?: Record<string, unknown>;
  // untuk FLOOD: track siapa yang sudah buang
  floodDiscarded?: string[];
  // untuk AWAITING_FREEZE: efek yang akan dieksekusi setelah window selesai
  deferredEffect?: DeferredEffect;
  // untuk AWAITING_FREEZE: timestamp (ms epoch) kapan window berakhir —
  // dikirim ke client supaya bisa render countdown yang akurat
  freezeWindowEndsAt?: number;
  // untuk FREEZE window
  frozenActionType?: string;
  frozenPayload?: unknown;
}

// ============================================================
// GAME LOG
// ============================================================
export interface GameLogEntry {
  timestamp: number;
  message: string;
  type: "action" | "death" | "system" | "win";
}

// ============================================================
// GAME STATE
// ============================================================
export type GameStatus = "lobby" | "playing" | "finished";
export type TurnDirection = 1 | -1;

export interface GameState {
  roomId: string;
  status: GameStatus;
  hostId: string;

  players: Map<string, Player>;
  turnOrder: string[];           // sessionId[] sesuai urutan
  currentTurnIndex: number;
  turnDirection: TurnDirection;
  pendingTurns: number;          // berapa turn wajib draw (efek Eruption)

  deck: Card[];
  discardPile: Card[];

  pendingAction: PendingAction | null;

  // Spy Cat / Peek result (hanya visible ke pemain bersangkutan)
  peekResult: { sessionId: string; cards: Card[] } | null;

  winner: string | null;
  log: GameLogEntry[];
}

// ============================================================
// MESSAGES — Client → Server
// ============================================================
export type ClientMessage =
  | { type: "PLAY_CARD"; cardId: string; targetId?: string }
  | { type: "PLAY_GANG"; cardIds: string[]; targetId?: string; targetCardId?: string }
  | { type: "DRAW_CARD" }
  | { type: "USE_WATER_BUCKET"; insertPosition: number }
  | { type: "BRIBE_GIVE_CARD"; cardId: string }
  | { type: "PEEK_SWAP_DECISION"; swap: boolean; cardId?: string }
  | { type: "FLOOD_DISCARD"; cardId: string }
  | { type: "FREEZE_PLAY" }    // main Freeze sebagai respons
  | { type: "START_GAME" }
  | { type: "GANG_RAINBOW_CONFIRM"; targetId: string }
  | { type: "TOGGLE_AWAY"; away: boolean };

// ============================================================
// MESSAGES — Server → Client
// ============================================================
export type ServerMessage =
  | { type: "GAME_STATE_UPDATE"; state: ClientGameState }
  | { type: "PEEK_RESULT"; cards: Card[] }
  | { type: "YOUR_HAND"; cards: Card[] }
  | { type: "ERROR"; message: string }
  | { type: "FREEZE_WINDOW"; action: string; timeoutMs: number }
  | { type: "ACTION_REQUIRED"; action: PendingAction };

// ============================================================
// CLIENT GAME STATE — versi state yang aman dikirim ke client
// (hand pemain lain di-hide, deck hanya jumlahnya)
// ============================================================
export interface ClientPlayer {
  sessionId: string;
  username: string;
  handCount: number;       // jumlah kartu, bukan isi kartu!
  hand?: Card[];           // hanya diisi untuk pemain itu sendiri
  isAlive: boolean;
  hasBunker: boolean;
  isLocked: boolean;
  connected: boolean;
  away: boolean;
}

export interface ClientGameState {
  roomId: string;
  status: GameStatus;
  hostId: string;
  players: ClientPlayer[];
  turnOrder: string[];
  currentTurnIndex: number;
  turnDirection: TurnDirection;
  pendingTurns: number;
  deckCount: number;       // jumlah kartu di deck
  discardPile: Card[];     // discard pile visible
  pendingAction: PendingAction | null;
  winner: string | null;
  log: GameLogEntry[];
}
