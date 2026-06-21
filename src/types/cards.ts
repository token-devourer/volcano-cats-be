// ============================================================
// VOLCANO CATS — Card Definitions & Types
// ============================================================

export type CardType =
  // Danger cards
  | "LAVA_CAT"
  | "WATER_BUCKET"
  // Action cards (renamed from EK)
  | "NAP_TIME"        // Skip
  | "ERUPTION"        // Attack
  | "SPY_CAT"         // See the Future
  | "EARTHQUAKE"      // Shuffle
  | "FREEZE"          // Nope
  | "BRIBE"           // Favor
  // New mechanics
  | "REVERSE"
  | "SNIPER"
  | "PEEK_AND_SWAP"
  | "BUNKER"
  | "PICKPOCKET"
  | "FLOOD"
  | "TIME_WARP"
  | "LOCKDOWN"
  // Gang cards (cat cards)
  | "GANG_FIRE"
  | "GANG_ICE"
  | "GANG_STORM"
  | "GANG_EARTH"
  | "GANG_SHADOW";

export interface Card {
  id: string;
  type: CardType;
  name: string;
  description: string;
  emoji: string;
}

export interface CardDefinition {
  type: CardType;
  name: string;
  description: string;
  emoji: string;
  count: number; // jumlah kartu dalam deck
}

// ============================================================
// CARD DEFINITIONS — semua kartu beserta jumlahnya
// ============================================================
export const CARD_DEFINITIONS: CardDefinition[] = [
  // --- DANGER ---
  {
    type: "LAVA_CAT",
    name: "Lava Cat",
    emoji: "🌋",
    description: "Jika kamu draw ini tanpa Water Bucket, kamu MATI!",
    count: 0, // dimasukkan dinamis berdasarkan jumlah pemain
  },
  {
    type: "WATER_BUCKET",
    name: "Water Bucket",
    emoji: "💧",
    description: "Selamatkan diri dari Lava Cat. Taruh balik Lava Cat di posisi manapun dalam deck.",
    count: 0, // dimasukkan dinamis berdasarkan jumlah pemain — lihat WATER_BUCKET_EXTRA di setupGame
  },

  // --- ACTION (classic renames) ---
  {
    type: "NAP_TIME",
    name: "Nap Time",
    emoji: "😴",
    description: "Skip giliran tanpa draw kartu.",
    count: 6,
  },
  {
    type: "ERUPTION",
    name: "Eruption",
    emoji: "🌀",
    description: "Skip giliranmu. Pemain berikutnya kena 2 turn berturut-turut.",
    count: 6,
  },
  {
    type: "SPY_CAT",
    name: "Spy Cat",
    emoji: "🔭",
    description: "Lihat 3 kartu teratas deck secara rahasia.",
    count: 6,
  },
  {
    type: "EARTHQUAKE",
    name: "Earthquake",
    emoji: "🔀",
    description: "Acak ulang seluruh deck.",
    count: 5,
  },
  {
    type: "FREEZE",
    name: "Freeze",
    emoji: "❄️",
    description: "Batalkan aksi siapapun kapan saja. Bisa di-Freeze balik!",
    count: 7,
  },
  {
    type: "BRIBE",
    name: "Bribe",
    emoji: "🎁",
    description: "Paksa 1 pemain kasih 1 kartu ke kamu. Mereka pilih kartunya.",
    count: 5,
  },

  // --- NEW MECHANICS ---
  {
    type: "REVERSE",
    name: "Reverse",
    emoji: "🔄",
    description: "Balik arah urutan giliran.",
    count: 5,
  },
  {
    type: "SNIPER",
    name: "Sniper",
    emoji: "🎯",
    description: "Pilih 1 pemain — mereka harus draw 1 kartu sekarang, di luar giliran mereka.",
    count: 4,
  },
  {
    type: "PEEK_AND_SWAP",
    name: "Peek & Swap",
    emoji: "👁️",
    description: "Lihat 1 kartu teratas deck, lalu boleh swap dengan 1 kartu dari tanganmu.",
    count: 4,
  },
  {
    type: "BUNKER",
    name: "Bunker",
    emoji: "🛡️",
    description: "Pasang di depanmu. Batalkan efek negatif pertama yang kamu terima, lalu Bunker hancur.",
    count: 4,
  },
  {
    type: "PICKPOCKET",
    name: "Pickpocket",
    emoji: "💸",
    description: "Ambil 1 kartu ACAK dari tangan pemain pilihanmu.",
    count: 5,
  },
  {
    type: "FLOOD",
    name: "Flood",
    emoji: "🌊",
    description: "Semua pemain buang 1 kartu pilihan mereka ke discard pile.",
    count: 3,
  },
  {
    type: "TIME_WARP",
    name: "Time Warp",
    emoji: "🪄",
    description: "Ambil 1 kartu apapun dari discard pile ke tanganmu.",
    count: 3,
  },
  {
    type: "LOCKDOWN",
    name: "Lockdown",
    emoji: "🔒",
    description: "Pilih 1 pemain — giliran berikutnya mereka tidak bisa main kartu apapun.",
    count: 3,
  },

  // --- GANG CARDS (5 jenis × 6) ---
  {
    type: "GANG_FIRE",
    name: "Fire Gang",
    emoji: "🔥",
    description: "Gang card. Pair=steal random. Triple=steal random dari target pilihan. x4=steal dari semua. x5 rainbow=swap tangan!",
    count: 6,
  },
  {
    type: "GANG_ICE",
    name: "Ice Gang",
    emoji: "🧊",
    description: "Gang card. Pair=steal random. Triple=steal random dari target pilihan. x4=steal dari semua. x5 rainbow=swap tangan!",
    count: 6,
  },
  {
    type: "GANG_STORM",
    name: "Storm Gang",
    emoji: "⚡",
    description: "Gang card. Pair=steal random. Triple=steal random dari target pilihan. x4=steal dari semua. x5 rainbow=swap tangan!",
    count: 6,
  },
  {
    type: "GANG_EARTH",
    name: "Earth Gang",
    emoji: "🌿",
    description: "Gang card. Pair=steal random. Triple=steal random dari target pilihan. x4=steal dari semua. x5 rainbow=swap tangan!",
    count: 6,
  },
  {
    type: "GANG_SHADOW",
    name: "Shadow Gang",
    emoji: "🌑",
    description: "Gang card. Pair=steal random. Triple=steal random dari target pilihan. x4=steal dari semua. x5 rainbow=swap tangan!",
    count: 6,
  },
];

export const GANG_TYPES: CardType[] = [
  "GANG_FIRE",
  "GANG_ICE",
  "GANG_STORM",
  "GANG_EARTH",
  "GANG_SHADOW",
];

export function isGangCard(type: CardType): boolean {
  return GANG_TYPES.includes(type);
}

export function getCardDef(type: CardType): CardDefinition {
  const def = CARD_DEFINITIONS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown card type: ${type}`);
  return def;
}
