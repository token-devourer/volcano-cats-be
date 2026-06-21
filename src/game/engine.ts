import { randomUUID } from "node:crypto";
import {
  Card,
  CardType,
  CARD_DEFINITIONS,
  GANG_TYPES,
  isGangCard,
  getCardDef,
} from "../types/cards.js";
import {
  GameState,
  Player,
  GameLogEntry,
  ClientGameState,
  ClientPlayer,
  TurnDirection,
} from "../types/game.js";

// ============================================================
// DECK BUILDER
// ============================================================
// Sebelumnya: deck SELALU pakai semua kartu non-bahaya dari CARD_DEFINITIONS
// (96 kartu), berapa pun jumlah pemainnya. Untuk 2 pemain itu artinya deck
// 87+ kartu dengan cuma 1 Lava Cat di dalamnya — terlalu encer, game jadi
// kebanyakan draw kartu aman dan deck bisa habis sebelum Lava Cat ditemukan.
//
// Sekarang: jumlah kartu non-bahaya yang dimasukkan scale dengan playerCount,
// supaya rasio "kartu berbahaya : total deck" tetap terasa di semua ukuran
// pemain. Setiap jenis kartu tetap proporsional terhadap definisi count
// aslinya (jadi variety kartu tidak berubah, cuma jumlah total yang disesuaikan).
function targetDeckSize(playerCount: number): number {
  // Baseline ala Exploding Kittens asli: total deck ~ (playerCount * 8) + slack kecil
  // supaya tiap pemain dapat beberapa kali kesempatan draw sebelum deck habis,
  // tapi tetap cukup tipis supaya Lava Cat punya peluang realistis muncul.
  return playerCount * 9 + 6;
}

export function buildDeck(playerCount: number): Card[] {
  const fullPool: Card[] = [];

  for (const def of CARD_DEFINITIONS) {
    if (def.type === "LAVA_CAT") continue; // dimasukkan terpisah
    if (def.type === "WATER_BUCKET") continue; // dibagi ke pemain dulu

    for (let i = 0; i < def.count; i++) {
      fullPool.push({ id: randomUUID(), type: def.type, name: def.name, description: def.description, emoji: def.emoji });
    }
  }

  const target = targetDeckSize(playerCount);

  // Kalau target lebih besar dari pool penuh (game dengan banyak pemain), pakai semua kartu yang ada.
  if (target >= fullPool.length) {
    return shuffle(fullPool);
  }

  // Ambil subset proporsional: shuffle pool penuh lalu potong sejumlah target.
  // Karena pool sudah berisi semua jenis kartu dengan rasio aslinya, subset acak
  // ini secara statistik tetap mempertahankan variety yang representatif tanpa
  // perlu hitung proporsi per-jenis secara manual.
  return shuffle(fullPool).slice(0, target);
}

export function buildLavaCats(count: number): Card[] {
  const def = getCardDef("LAVA_CAT");
  return Array.from({ length: count }, () => ({
    id: randomUUID(),
    type: "LAVA_CAT" as CardType,
    name: def.name,
    description: def.description,
    emoji: def.emoji,
  }));
}

export function makeCard(type: CardType): Card {
  const def = getCardDef(type);
  return { id: randomUUID(), type, name: def.name, description: def.description, emoji: def.emoji };
}

// ============================================================
// SHUFFLE
// ============================================================
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// SETUP GAME
// ============================================================
export function setupGame(state: GameState): GameState {
  const playerIds = [...state.turnOrder];
  const playerCount = playerIds.length;

  // Build base deck (tanpa lava cat & water bucket)
  let deck = buildDeck(playerCount);

  // Bagi 6 kartu + 1 water bucket ke tiap pemain
  const waterBucketDef = getCardDef("WATER_BUCKET");
  const players = new Map(state.players);

  for (const pid of playerIds) {
    const player = players.get(pid)!;
    const hand: Card[] = [];

    // 1 water bucket
    hand.push({
      id: randomUUID(),
      type: "WATER_BUCKET",
      name: waterBucketDef.name,
      description: waterBucketDef.description,
      emoji: waterBucketDef.emoji,
    });

    // 6 kartu dari deck
    for (let i = 0; i < 6; i++) {
      hand.push(deck.pop()!);
    }

    players.set(pid, { ...player, hand });
  }

  // Masukkan sisa water bucket ke deck.
  // Total Water Bucket di game = playerCount (1 per tangan awal) + extra di deck.
  // Extra di-cap supaya rasio Water:Lava tetap masuk akal di semua ukuran pemain —
  // sebelumnya pakai angka fixed (8 total) yang absurd untuk 2 pemain (8 Water vs 1 Lava).
  // Formula: 2 extra untuk game kecil (2-4 pemain), naik bertahap untuk game besar,
  // supaya game tetap solvable tapi tegang di skala berapa pun.
  const extraWaterBuckets = playerCount <= 4 ? 2 : playerCount <= 7 ? 3 : 4;
  for (let i = 0; i < extraWaterBuckets; i++) {
    deck.push({
      id: randomUUID(),
      type: "WATER_BUCKET",
      name: waterBucketDef.name,
      description: waterBucketDef.description,
      emoji: waterBucketDef.emoji,
    });
  }

  // Shuffle lagi setelah tambah water bucket
  deck = shuffle(deck);

  // Masukkan Lava Cat (playerCount - 1)
  const lavaCats = buildLavaCats(playerCount - 1);
  // Taruh lava cat di posisi random dalam deck (bukan di atas)
  for (const lc of lavaCats) {
    const pos = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(pos, 0, lc);
  }

  return {
    ...state,
    players,
    deck,
    discardPile: [],
    status: "playing",
    currentTurnIndex: 0,
    turnDirection: 1,
    pendingTurns: 1,
    pendingAction: null,
    peekResult: null,
    log: [addLog("Game dimulai! Semua pemain mendapat 6 kartu + 1 Water Bucket.", "system")],
  };
}

// ============================================================
// TURN HELPERS
// ============================================================
export function getCurrentPlayer(state: GameState): Player | null {
  const id = state.turnOrder[state.currentTurnIndex];
  return state.players.get(id) ?? null;
}

export function getNextAliveIndex(state: GameState, fromIndex: number, direction: TurnDirection): number {
  const total = state.turnOrder.length;
  let idx = (fromIndex + direction + total) % total;
  let attempts = 0;
  while (!state.players.get(state.turnOrder[idx])?.isAlive && attempts < total) {
    idx = (idx + direction + total) % total;
    attempts++;
  }
  return idx;
}

export function advanceTurn(state: GameState): GameState {
  // Kurangi pending turns
  const newPending = state.pendingTurns - 1;

  if (newPending > 0) {
    // Masih ada sisa turn (kena Eruption), tetap giliran orang yang sama
    return { ...state, pendingTurns: newPending };
  }

  // Advance ke pemain berikutnya
  const nextIndex = getNextAliveIndex(state, state.currentTurnIndex, state.turnDirection);
  return {
    ...state,
    currentTurnIndex: nextIndex,
    pendingTurns: 1,
    pendingAction: null,
    peekResult: null,
  };
}

// ============================================================
// DRAW CARD
// ============================================================
export function drawCard(state: GameState, playerId: string): {
  state: GameState;
  drawnCard: Card;
  exploded: boolean;
} {
  if (state.deck.length === 0) {
    throw new Error("Deck kosong!");
  }

  const drawnCard = state.deck[state.deck.length - 1];
  const newDeck = state.deck.slice(0, -1);

  const player = state.players.get(playerId)!;

  if (drawnCard.type === "LAVA_CAT") {
    // Cek bunker dulu
    if (player.hasBunker) {
      const newPlayers = new Map(state.players);
      newPlayers.set(playerId, { ...player, hasBunker: false });
      const newDiscard = [...state.discardPile, drawnCard];
      return {
        state: {
          ...state,
          deck: newDeck,
          discardPile: newDiscard,
          players: newPlayers,
          log: [...state.log, addLog(`${player.username} kena Lava Cat! Tapi Bunker melindungi mereka! 🛡️`, "action")],
        },
        drawnCard,
        exploded: false,
      };
    }

    // Cek water bucket di tangan
    const waterBucketIdx = player.hand.findIndex((c) => c.type === "WATER_BUCKET");
    if (waterBucketIdx !== -1) {
      // Player punya water bucket — akan trigger WATER_BUCKET_PLACE pending action
      const newHand = player.hand.filter((_, i) => i !== waterBucketIdx);
      const newPlayers = new Map(state.players);
      newPlayers.set(playerId, { ...player, hand: newHand });

      return {
        state: {
          ...state,
          deck: newDeck,
          players: newPlayers,
          pendingAction: {
            type: "WATER_BUCKET_PLACE",
            initiatorId: playerId,
            data: { lavaCatCard: drawnCard },
          },
          log: [...state.log, addLog(`${player.username} draw Lava Cat! 🌋 Water Bucket digunakan! Pilih posisi untuk taruh Lava Cat.`, "action")],
        },
        drawnCard,
        exploded: false,
      };
    }

    // Tidak punya water bucket → MATI
    const newPlayers = new Map(state.players);
    newPlayers.set(playerId, { ...player, isAlive: false, hand: [] });
    const newDiscard = [...state.discardPile, drawnCard];

    const alivePlayers = [...newPlayers.values()].filter((p) => p.isAlive);
    const isGameOver = alivePlayers.length === 1;

    let newState: GameState = {
      ...state,
      deck: newDeck,
      discardPile: newDiscard,
      players: newPlayers,
      log: [...state.log, addLog(`${player.username} meledak! 💀 Tidak punya Water Bucket!`, "death")],
    };

    if (isGameOver) {
      const winner = alivePlayers[0];
      newState = {
        ...newState,
        status: "finished",
        winner: winner.sessionId,
        log: [...newState.log, addLog(`${winner.username} menang! 🏆`, "win")],
      };
    } else {
      newState = advanceTurn(newState);
    }

    return { state: newState, drawnCard, exploded: true };
  }

  // Kartu normal — masuk ke tangan
  const newHand = [...player.hand, drawnCard];
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: newHand });

  let newState: GameState = {
    ...state,
    deck: newDeck,
    players: newPlayers,
    log: [...state.log, addLog(`${player.username} draw 1 kartu.`, "action")],
  };

  newState = advanceTurn(newState);

  return { state: newState, drawnCard, exploded: false };
}

// ============================================================
// PLACE LAVA CAT BACK (after water bucket)
// ============================================================
export function placeLavaCat(state: GameState, lavaCatCard: Card, position: number): GameState {
  const clampedPos = Math.max(0, Math.min(position, state.deck.length));
  const newDeck = [...state.deck];
  newDeck.splice(clampedPos, 0, lavaCatCard);

  const newState: GameState = {
    ...state,
    deck: newDeck,
    pendingAction: null,
    log: [...state.log, addLog(`Lava Cat ditaruh balik di posisi ${clampedPos} dalam deck. 🌋`, "action")],
  };

  return advanceTurn(newState);
}

// ============================================================
// FREEZE WINDOW DURATION
// ============================================================
// Berapa lama (ms) pemain lain punya kesempatan menekan tombol Freeze
// sebelum efek kartu benar-benar dieksekusi. Cukup singkat supaya game
// tetap terasa cepat, tapi cukup panjang untuk bisa di-react secara manual.
export const FREEZE_WINDOW_MS = 4000;

// Kartu-kartu yang efeknya langsung terjadi tanpa pending action sendiri
// (tidak menunggu input tambahan dari pemain lain) — kartu ini butuh
// freeze window eksplisit karena kalau langsung resolve instan, tidak ada
// jeda sama sekali bagi pemain lain untuk sempat menekan Freeze.
//
// Kartu seperti Bribe/Flood/Water Bucket Place TIDAK butuh window terpisah
// karena mereka sudah secara alami menunggu input (pendingAction lain) —
// jeda menunggu itu sendiri sudah jadi kesempatan untuk Freeze.
const INSTANT_EFFECT_CARDS = new Set([
  "NAP_TIME", "ERUPTION", "SPY_CAT", "EARTHQUAKE", "REVERSE",
  "SNIPER", "BUNKER", "TIME_WARP", "LOCKDOWN", "PICKPOCKET",
]);

// ============================================================
// PLAY CARD — entry point. Keluarkan kartu dari tangan, lalu:
//   - kalau kartu termasuk INSTANT_EFFECT_CARDS → masuk freeze window dulu,
//     efek sebenarnya baru dieksekusi lewat resolveDeferredEffect() setelah
//     window habis (dipanggil dari room timer) atau di-skip semua pemain.
//   - kalau kartu punya pending action sendiri (Bribe, Flood, dst) → tetap
//     pakai jalur lama, karena sudah otomatis kasih jeda lewat menunggu input.
// ============================================================
export function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  targetId?: string
): GameState {
  const player = state.players.get(playerId)!;
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) throw new Error("Kartu tidak ditemukan di tangan!");

  const card = player.hand[cardIdx];

  // Keluarkan kartu dari tangan
  const newHand = player.hand.filter((_, i) => i !== cardIdx);
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: newHand });
  let newState: GameState = { ...state, players: newPlayers };

  // Tambah ke discard pile
  newState = { ...newState, discardPile: [...newState.discardPile, card] };

  if (INSTANT_EFFECT_CARDS.has(card.type)) {
    // Validasi syarat target di awal (sebelum masuk window), supaya error
    // muncul cepat kalau memang invalid, bukan setelah nunggu 4 detik percuma.
    if ((card.type === "SNIPER" || card.type === "PICKPOCKET" || card.type === "LOCKDOWN") && !targetId) {
      throw new Error(`${card.name} butuh target!`);
    }

    const player2 = state.players.get(playerId)!;
    return {
      ...newState,
      pendingAction: {
        type: "AWAITING_FREEZE",
        initiatorId: playerId,
        targetId,
        deferredEffect: { cardType: card.type, initiatorId: playerId, targetId },
        freezeWindowEndsAt: Date.now() + FREEZE_WINDOW_MS,
      },
      log: [...newState.log, addLog(`${player2.username} memainkan ${card.name}... (bisa di-Freeze)`, "action")],
    };
  }

  // Kartu dengan pending action sendiri — jalur lama, eksekusi langsung
  // (jeda menunggu input dari pendingAction itu sendiri sudah jadi window react).
  switch (card.type) {
    case "BRIBE":
      if (!targetId) throw new Error("Bribe butuh target!");
      newState = applyBribe(newState, playerId, targetId);
      break;
    case "PEEK_AND_SWAP":
      newState = applyPeekAndSwap(newState, playerId);
      break;
    case "FLOOD":
      newState = applyFlood(newState, playerId);
      break;
    default:
      throw new Error(`Kartu ${card.type} tidak bisa dimainkan sendiri!`);
  }

  return newState;
}

// ============================================================
// RESOLVE DEFERRED EFFECT — dipanggil setelah freeze window habis
// (dari room timer) tanpa ada yang nge-Freeze. Mengeksekusi efek
// sebenarnya dari kartu yang sempat "ditahan" di AWAITING_FREEZE.
// ============================================================
export function resolveDeferredEffect(state: GameState): GameState {
  const pa = state.pendingAction;
  if (!pa || pa.type !== "AWAITING_FREEZE" || !pa.deferredEffect) {
    throw new Error("Tidak ada efek yang ditunda untuk di-resolve!");
  }

  const { cardType, initiatorId, targetId, targetCardId } = pa.deferredEffect;

  // Bersihkan pendingAction dulu sebelum eksekusi efek, supaya fungsi apply*
  // di bawah bisa set pendingAction baru sendiri kalau perlu (mis. gang rainbow target).
  let newState: GameState = { ...state, pendingAction: null };

  switch (cardType) {
    case "NAP_TIME":
      newState = applyNapTime(newState, initiatorId);
      break;
    case "ERUPTION":
      newState = applyEruption(newState, initiatorId);
      break;
    case "SPY_CAT":
      newState = applySpyCat(newState, initiatorId);
      break;
    case "EARTHQUAKE":
      newState = applyEarthquake(newState, initiatorId);
      break;
    case "REVERSE":
      newState = applyReverse(newState, initiatorId);
      break;
    case "SNIPER":
      newState = applySniper(newState, initiatorId, targetId!);
      break;
    case "BUNKER":
      newState = applyBunker(newState, initiatorId);
      break;
    case "TIME_WARP":
      newState = applyTimeWarp(newState, initiatorId);
      break;
    case "LOCKDOWN":
      newState = applyLockdown(newState, initiatorId, targetId!);
      break;
    case "PICKPOCKET":
      newState = applyPickpocket(newState, initiatorId, targetId!);
      break;
    case "GANG_PAIR":
      newState = executeGangPair(newState, initiatorId, targetId!);
      break;
    case "GANG_TRIPLE":
      newState = executeGangTriple(newState, initiatorId, targetId!, targetCardId);
      break;
    case "GANG_QUAD":
      newState = executeGangQuad(newState, initiatorId);
      break;
    default:
      throw new Error(`Tidak tahu cara resolve efek untuk: ${cardType}`);
  }

  return newState;
}

// ============================================================
// PLAY FREEZE (bisa dimainkan kapan saja sebagai interrupt)
// ============================================================
export function playFreeze(state: GameState, playerId: string, freezeCardId: string): GameState {
  const player = state.players.get(playerId)!;
  const cardIdx = player.hand.findIndex((c) => c.id === freezeCardId && c.type === "FREEZE");
  if (cardIdx === -1) throw new Error("Tidak punya kartu Freeze!");

  if (!state.pendingAction) {
    throw new Error("Tidak ada aksi yang sedang berjalan untuk di-Freeze!");
  }
  if (state.pendingAction.initiatorId === playerId) {
    throw new Error("Tidak bisa nge-Freeze aksimu sendiri!");
  }

  const card = player.hand[cardIdx];
  const newHand = player.hand.filter((_, i) => i !== cardIdx);
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: newHand });

  const initiator = state.players.get(state.pendingAction.initiatorId);

  // Batalkan pending action yang ada (termasuk efek kartu yang sedang ditahan
  // di AWAITING_FREEZE — kartu tetap masuk discard pile, tapi efeknya tidak
  // pernah dieksekusi karena pendingAction di-null-kan di sini).
  return {
    ...state,
    players: newPlayers,
    discardPile: [...state.discardPile, card],
    pendingAction: null,
    log: [...state.log, addLog(
      `${player.username} memainkan Freeze! ❄️ Aksi ${initiator?.username ?? "seseorang"} dibatalkan!`,
      "action"
    )],
  };
}

// ============================================================
// PLAY GANG CARDS
// ============================================================
export function playGang(
  state: GameState,
  playerId: string,
  cardIds: string[],
  targetId?: string,
  targetCardId?: string
): GameState {
  const player = state.players.get(playerId)!;

  // Validasi semua kartu ada di tangan
  const cards = cardIds.map((id) => {
    const card = player.hand.find((c) => c.id === id);
    if (!card) throw new Error(`Kartu ${id} tidak ditemukan!`);
    return card;
  });

  // Validasi gang logic
  const count = cards.length;
  if (count < 2) throw new Error("Gang butuh minimal 2 kartu!");

  const isRainbow = count === 5 && new Set(cards.map((c) => c.type)).size === 5
    && cards.every((c) => isGangCard(c.type));
  const isSameType = cards.every((c) => c.type === cards[0].type) && isGangCard(cards[0].type);

  if (!isRainbow && !isSameType) throw new Error("Gang card tidak valid!");

  // Keluarkan kartu dari tangan
  const usedIds = new Set(cardIds);
  const newHand = player.hand.filter((c) => !usedIds.has(c.id));
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: newHand });
  let newState: GameState = {
    ...state,
    players: newPlayers,
    discardPile: [...state.discardPile, ...cards],
  };

  if (isRainbow) {
    // x5 rainbow — swap tangan dengan target. Selalu butuh target (tidak ada
    // skenario rainbow tanpa target), jadi langsung masuk freeze window.
    if (!targetId) {
      throw new Error("Rainbow Gang butuh target!");
    }
    const player2 = state.players.get(playerId)!;
    newState = {
      ...newState,
      pendingAction: {
        type: "AWAITING_FREEZE",
        initiatorId: playerId,
        targetId,
        deferredEffect: { cardType: "GANG_RAINBOW", initiatorId: playerId, targetId },
        freezeWindowEndsAt: Date.now() + FREEZE_WINDOW_MS,
      },
      log: [...newState.log, addLog(`${player2.username} main Rainbow Gang! 🌈 (bisa di-Freeze)`, "action")],
    };
  } else if (count === 4) {
    // x4 — steal dari semua pemain hidup, tidak butuh target spesifik
    const player2 = state.players.get(playerId)!;
    newState = {
      ...newState,
      pendingAction: {
        type: "AWAITING_FREEZE",
        initiatorId: playerId,
        deferredEffect: { cardType: "GANG_QUAD", initiatorId: playerId },
        freezeWindowEndsAt: Date.now() + FREEZE_WINDOW_MS,
      },
      log: [...newState.log, addLog(`${player2.username} main Quad Gang! 🔥 (bisa di-Freeze)`, "action")],
    };
  } else if (count === 3) {
    if (!targetId) {
      throw new Error("Triple Gang butuh target!");
    }
    const player2 = state.players.get(playerId)!;
    newState = {
      ...newState,
      pendingAction: {
        type: "AWAITING_FREEZE",
        initiatorId: playerId,
        targetId,
        deferredEffect: { cardType: "GANG_TRIPLE", initiatorId: playerId, targetId, targetCardId },
        freezeWindowEndsAt: Date.now() + FREEZE_WINDOW_MS,
      },
      log: [...newState.log, addLog(`${player2.username} main Triple Gang! 🎯 (bisa di-Freeze)`, "action")],
    };
  } else {
    if (!targetId) {
      throw new Error("Pair Gang butuh target!");
    }
    const player2 = state.players.get(playerId)!;
    newState = {
      ...newState,
      pendingAction: {
        type: "AWAITING_FREEZE",
        initiatorId: playerId,
        targetId,
        deferredEffect: { cardType: "GANG_PAIR", initiatorId: playerId, targetId },
        freezeWindowEndsAt: Date.now() + FREEZE_WINDOW_MS,
      },
      log: [...newState.log, addLog(`${player2.username} main Pair Gang! 👥 (bisa di-Freeze)`, "action")],
    };
  }

  return newState;
}

// ============================================================
// GANG EXECUTIONS
// ============================================================
function executeGangPair(state: GameState, initiatorId: string, targetId: string): GameState {
  const initiator = state.players.get(initiatorId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive || target.hand.length === 0) throw new Error("Target tidak valid!");

  const randIdx = Math.floor(Math.random() * target.hand.length);
  const stolenCard = target.hand[randIdx];
  const newTargetHand = target.hand.filter((_, i) => i !== randIdx);
  const newInitiatorHand = [...initiator.hand, stolenCard];

  const newPlayers = new Map(state.players);
  newPlayers.set(targetId, { ...target, hand: newTargetHand });
  newPlayers.set(initiatorId, { ...initiator, hand: newInitiatorHand });

  return {
    ...state,
    players: newPlayers,
    pendingAction: null,
    log: [...state.log, addLog(`${initiator.username} steal 1 kartu random dari ${target.username}! 💸`, "action")],
  };
}

function executeGangTriple(
  state: GameState,
  initiatorId: string,
  targetId: string,
  targetCardId?: string
): GameState {
  const initiator = state.players.get(initiatorId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive || target.hand.length === 0) throw new Error("Target tidak valid!");

  let cardIdx: number;
  if (targetCardId) {
    cardIdx = target.hand.findIndex((c) => c.id === targetCardId);
    if (cardIdx === -1) throw new Error("Kartu target tidak ditemukan!");
  } else {
    cardIdx = Math.floor(Math.random() * target.hand.length);
  }

  const stolenCard = target.hand[cardIdx];
  const newTargetHand = target.hand.filter((_, i) => i !== cardIdx);
  const newInitiatorHand = [...initiator.hand, stolenCard];

  const newPlayers = new Map(state.players);
  newPlayers.set(targetId, { ...target, hand: newTargetHand });
  newPlayers.set(initiatorId, { ...initiator, hand: newInitiatorHand });

  return {
    ...state,
    players: newPlayers,
    pendingAction: null,
    log: [...state.log, addLog(`${initiator.username} steal "${stolenCard.name}" dari ${target.username}! 🎯`, "action")],
  };
}

function executeGangQuad(state: GameState, initiatorId: string): GameState {
  const initiator = state.players.get(initiatorId)!;
  const newPlayers = new Map(state.players);
  const stolenCards: Card[] = [];

  for (const [pid, player] of state.players) {
    if (pid === initiatorId || !player.isAlive || player.hand.length === 0) continue;
    const randIdx = Math.floor(Math.random() * player.hand.length);
    stolenCards.push(player.hand[randIdx]);
    newPlayers.set(pid, { ...player, hand: player.hand.filter((_, i) => i !== randIdx) });
  }

  newPlayers.set(initiatorId, { ...initiator, hand: [...initiator.hand, ...stolenCards] });

  return {
    ...state,
    players: newPlayers,
    pendingAction: null,
    log: [...state.log, addLog(`${initiator.username} GANG RAID! Steal dari semua pemain! 🔥`, "action")],
  };
}

export function executeGangRainbow(state: GameState, initiatorId: string, targetId: string): GameState {
  const initiator = state.players.get(initiatorId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive) throw new Error("Target sudah mati!");

  const newPlayers = new Map(state.players);
  newPlayers.set(initiatorId, { ...initiator, hand: target.hand });
  newPlayers.set(targetId, { ...target, hand: initiator.hand });

  return {
    ...state,
    players: newPlayers,
    pendingAction: null,
    log: [...state.log, addLog(`${initiator.username} FULL RIOT! Swap tangan dengan ${target.username}! 🌈`, "action")],
  };
}

// ============================================================
// INDIVIDUAL CARD EFFECTS
// ============================================================
function applyNapTime(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  return {
    ...advanceTurn(state),
    log: [...state.log, addLog(`${player.username} main Nap Time — skip giliran! 😴`, "action")],
  };
}

function applyEruption(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  const nextIdx = getNextAliveIndex(state, state.currentTurnIndex, state.turnDirection);
  const nextPlayer = state.players.get(state.turnOrder[nextIdx])!;

  // Advance turn ke pemain berikutnya dengan 2 pending turns
  return {
    ...state,
    currentTurnIndex: nextIdx,
    pendingTurns: (state.pendingTurns - 1) + 2, // sisa turn sebelumnya + 2
    pendingAction: null,
    log: [...state.log, addLog(`${player.username} main Eruption! 🌀 ${nextPlayer.username} harus draw 2 kali!`, "action")],
  };
}

function applySpyCat(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  const top3 = state.deck.slice(-3).reverse(); // 3 kartu teratas

  return {
    ...state,
    peekResult: { sessionId: playerId, cards: top3 },
    log: [...state.log, addLog(`${player.username} main Spy Cat — melihat 3 kartu teratas deck! 🔭`, "action")],
  };
}

function applyEarthquake(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  return {
    ...state,
    deck: shuffle(state.deck),
    log: [...state.log, addLog(`${player.username} main Earthquake! 🔀 Deck dikocok ulang!`, "action")],
  };
}

function applyBribe(state: GameState, playerId: string, targetId: string): GameState {
  const player = state.players.get(playerId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive) throw new Error("Target sudah mati!");

  return {
    ...state,
    pendingAction: {
      type: "BRIBE_WAITING",
      initiatorId: playerId,
      targetId,
    },
    log: [...state.log, addLog(`${player.username} main Bribe! 🎁 ${target.username} harus kasih 1 kartu!`, "action")],
  };
}

export function resolveBribe(state: GameState, targetId: string, cardId: string): GameState {
  const pa = state.pendingAction;
  if (!pa || pa.type !== "BRIBE_WAITING") throw new Error("Tidak ada Bribe aktif!");

  const initiator = state.players.get(pa.initiatorId)!;
  const target = state.players.get(targetId)!;
  const cardIdx = target.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) throw new Error("Kartu tidak ditemukan!");

  const card = target.hand[cardIdx];
  const newPlayers = new Map(state.players);
  newPlayers.set(targetId, { ...target, hand: target.hand.filter((_, i) => i !== cardIdx) });
  newPlayers.set(pa.initiatorId, { ...initiator, hand: [...initiator.hand, card] });

  return {
    ...state,
    players: newPlayers,
    pendingAction: null,
    log: [...state.log, addLog(`${target.username} memberi "${card.name}" ke ${initiator.username}.`, "action")],
  };
}

function applyReverse(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  const newDir: TurnDirection = state.turnDirection === 1 ? -1 : 1;
  const dirText = newDir === 1 ? "searah jarum jam" : "berlawanan jarum jam";

  return {
    ...state,
    turnDirection: newDir,
    log: [...state.log, addLog(`${player.username} main Reverse! 🔄 Urutan giliran jadi ${dirText}!`, "action")],
  };
}

function applySniper(state: GameState, playerId: string, targetId: string): GameState {
  const player = state.players.get(playerId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive) throw new Error("Target sudah mati!");

  // Force target draw sekarang
  const result = drawCard(state, targetId);

  return {
    ...result.state,
    log: [...result.state.log, addLog(`${player.username} Sniper ${target.username}! 🎯 Mereka harus draw sekarang!`, "action")],
  };
}

function applyPeekAndSwap(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  if (state.deck.length === 0) throw new Error("Deck kosong!");

  const topCard = state.deck[state.deck.length - 1];

  return {
    ...state,
    peekResult: { sessionId: playerId, cards: [topCard] },
    pendingAction: {
      type: "PEEK_AND_SWAP_DECIDE",
      initiatorId: playerId,
      data: { topCard },
    },
    log: [...state.log, addLog(`${player.username} main Peek & Swap! 👁️ Melihat kartu teratas deck...`, "action")],
  };
}

export function resolvePeekAndSwap(
  state: GameState,
  playerId: string,
  doSwap: boolean,
  swapCardId?: string
): GameState {
  const player = state.players.get(playerId)!;

  if (!doSwap) {
    return {
      ...state,
      pendingAction: null,
      peekResult: null,
      log: [...state.log, addLog(`${player.username} memilih tidak swap.`, "action")],
    };
  }

  if (!swapCardId) throw new Error("Harus pilih kartu untuk di-swap!");
  const cardIdx = player.hand.findIndex((c) => c.id === swapCardId);
  if (cardIdx === -1) throw new Error("Kartu tidak ditemukan!");

  const topCard = state.deck[state.deck.length - 1];
  const handCard = player.hand[cardIdx];
  const newHand = [...player.hand];
  newHand[cardIdx] = topCard;
  const newDeck = [...state.deck.slice(0, -1), handCard];

  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: newHand });

  return {
    ...state,
    players: newPlayers,
    deck: newDeck,
    pendingAction: null,
    peekResult: null,
    log: [...state.log, addLog(`${player.username} swap "${handCard.name}" dengan kartu teratas deck! 👁️`, "action")],
  };
}

function applyBunker(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  if (player.hasBunker) throw new Error("Sudah punya Bunker aktif!");

  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hasBunker: true });

  return {
    ...state,
    players: newPlayers,
    log: [...state.log, addLog(`${player.username} pasang Bunker! 🛡️`, "action")],
  };
}

function applyPickpocket(state: GameState, playerId: string, targetId: string): GameState {
  const player = state.players.get(playerId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive || target.hand.length === 0) throw new Error("Target tidak valid!");

  // Cek bunker target
  if (target.hasBunker) {
    const newPlayers = new Map(state.players);
    newPlayers.set(targetId, { ...target, hasBunker: false });
    return {
      ...state,
      players: newPlayers,
      log: [...state.log, addLog(`${player.username} Pickpocket ${target.username} tapi Bunker melindungi! 🛡️`, "action")],
    };
  }

  const randIdx = Math.floor(Math.random() * target.hand.length);
  const stolenCard = target.hand[randIdx];
  const newTargetHand = target.hand.filter((_, i) => i !== randIdx);
  const newInitiatorHand = [...player.hand, stolenCard];

  const newPlayers = new Map(state.players);
  newPlayers.set(targetId, { ...target, hand: newTargetHand });
  newPlayers.set(playerId, { ...player, hand: newInitiatorHand });

  return {
    ...state,
    players: newPlayers,
    log: [...state.log, addLog(`${player.username} Pickpocket "${stolenCard.name}" dari ${target.username}! 💸`, "action")],
  };
}

function applyFlood(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  const alivePlayers = [...state.players.values()].filter((p) => p.isAlive);

  return {
    ...state,
    pendingAction: {
      type: "FLOOD_WAITING",
      initiatorId: playerId,
      floodDiscarded: [],
      data: { totalAlive: alivePlayers.length },
    },
    log: [...state.log, addLog(`${player.username} main Flood! 🌊 Semua harus buang 1 kartu!`, "action")],
  };
}

export function resolveFloodDiscard(state: GameState, playerId: string, cardId: string): GameState {
  const pa = state.pendingAction;
  if (!pa || pa.type !== "FLOOD_WAITING") throw new Error("Tidak ada Flood aktif!");

  const player = state.players.get(playerId)!;
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) throw new Error("Kartu tidak ditemukan!");

  const card = player.hand[cardIdx];
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: player.hand.filter((_, i) => i !== cardIdx) });

  const floodDiscarded = [...(pa.floodDiscarded ?? []), playerId];
  const totalAlive = (pa.data?.totalAlive as number) ?? 0;

  const newState: GameState = {
    ...state,
    players: newPlayers,
    discardPile: [...state.discardPile, card],
    pendingAction: { ...pa, floodDiscarded },
    log: [...state.log, addLog(`${player.username} buang "${card.name}" karena Flood.`, "action")],
  };

  // Semua sudah buang
  if (floodDiscarded.length >= totalAlive) {
    return { ...newState, pendingAction: null };
  }

  return newState;
}

function applyTimeWarp(state: GameState, playerId: string): GameState {
  const player = state.players.get(playerId)!;
  if (state.discardPile.length === 0) throw new Error("Discard pile kosong!");

  return {
    ...state,
    pendingAction: {
      type: "FLOOD_WAITING", // reuse — sebenarnya player pilih dari discard
      initiatorId: playerId,
      data: { isTimeWarp: true },
    },
    log: [...state.log, addLog(`${player.username} main Time Warp! 🪄 Pilih kartu dari discard pile!`, "action")],
  };
}

export function resolveTimeWarp(state: GameState, playerId: string, cardId: string): GameState {
  const player = state.players.get(playerId)!;
  const cardIdx = state.discardPile.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) throw new Error("Kartu tidak ada di discard pile!");

  const card = state.discardPile[cardIdx];
  const newDiscard = state.discardPile.filter((_, i) => i !== cardIdx);
  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, hand: [...player.hand, card] });

  return {
    ...state,
    players: newPlayers,
    discardPile: newDiscard,
    pendingAction: null,
    log: [...state.log, addLog(`${player.username} ambil "${card.name}" dari discard pile! 🪄`, "action")],
  };
}

function applyLockdown(state: GameState, playerId: string, targetId: string): GameState {
  const player = state.players.get(playerId)!;
  const target = state.players.get(targetId)!;
  if (!target.isAlive) throw new Error("Target sudah mati!");

  // Cek bunker
  if (target.hasBunker) {
    const newPlayers = new Map(state.players);
    newPlayers.set(targetId, { ...target, hasBunker: false });
    return {
      ...state,
      players: newPlayers,
      log: [...state.log, addLog(`${player.username} Lockdown ${target.username} tapi Bunker melindungi! 🛡️`, "action")],
    };
  }

  const newPlayers = new Map(state.players);
  newPlayers.set(targetId, { ...target, isLocked: true });

  return {
    ...state,
    players: newPlayers,
    log: [...state.log, addLog(`${player.username} Lockdown ${target.username}! 🔒 Giliran berikutnya mereka tidak bisa main kartu!`, "action")],
  };
}

// ============================================================
// AUTO-PLAY — untuk pemain yang sedang away/offline
// ============================================================
// Dipanggil dari room saat giliran jatuh ke pemain yang sedang away atau
// disconnected. Strategi auto-play sengaja dibuat MINIMAL (cuma draw),
// bukan mencoba "main pintar" — karena AI strategi penuh di luar scope,
// dan draw-only adalah perilaku paling aman/predictable: tidak akan
// merugikan pemain lain secara tidak terduga, dan kalau pemain kembali
// online, hand mereka masih utuh (tidak ada kartu strategis yang
// "terbuang" otomatis tanpa sepengetahuan mereka).
//
// Urutan auto-play untuk satu giliran:
//   1. Draw 1 kartu dari deck
//   2a. Kalau bukan Lava Cat → giliran otomatis lanjut (sudah ditangani drawCard)
//   2b. Kalau Lava Cat & punya Water Bucket → otomatis pakai, taruh balik
//       Lava Cat di POSISI ACAK dalam deck (sesuai permintaan: "menaruh
//       lava secara acak")
//   2c. Kalau Lava Cat & TIDAK punya Water Bucket → mati seperti biasa
//       (drawCard sudah handle ini)
//
// Catatan: kalau pemain away/offline kena pendingTurns > 1 (habis kena
// Eruption), fungsi ini cuma resolve SATU draw per pemanggilan — room
// yang bertanggung jawab memanggil ulang fungsi ini selama masih giliran
// pemain yang sama (pendingTurns belum habis) dan pemain itu masih away/offline.
export function executeAutoTurn(state: GameState, playerId: string): GameState {
  let newState = state;

  const drawResult = drawCard(newState, playerId);
  newState = drawResult.state;

  // Kalau drawCard menghasilkan pending Water Bucket placement untuk pemain
  // auto-play ini, langsung resolve dengan posisi ACAK dalam deck.
  if (
    newState.pendingAction?.type === "WATER_BUCKET_PLACE" &&
    newState.pendingAction.initiatorId === playerId
  ) {
    const lavaCatCard = newState.pendingAction.data?.lavaCatCard as Card;
    const randomPosition = Math.floor(Math.random() * (newState.deck.length + 1));
    newState = placeLavaCat(newState, lavaCatCard, randomPosition);
  }

  return newState;
}

// Cek apakah giliran sekarang harus di-auto-play (pemain away ATAU disconnected).
export function shouldAutoPlay(state: GameState): boolean {
  if (state.status !== "playing") return false;
  if (state.pendingAction) return false; // ada pending action lain yang nunggu resolve (mis. AWAITING_FREEZE dari pemain lain)
  const current = getCurrentPlayer(state);
  if (!current) return false;
  return current.away || !current.connected;
}


export function validatePlayCard(state: GameState, playerId: string, cardId: string): void {
  if (state.status !== "playing") throw new Error("Game belum mulai!");
  // Setiap pendingAction (termasuk AWAITING_FREEZE) memblokir kartu BIASA dimainkan —
  // Freeze sendiri punya jalur validasi terpisah lewat playFreeze(), tidak lewat sini,
  // jadi tidak perlu pengecualian apa pun di sini.
  if (state.pendingAction)
    throw new Error("Ada aksi yang menunggu penyelesaian!");

  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer || currentPlayer.sessionId !== playerId)
    throw new Error("Bukan giliran kamu!");

  const player = state.players.get(playerId)!;
  if (player.isLocked) throw new Error("Kamu terkena Lockdown! Tidak bisa main kartu giliran ini.");

  const card = player.hand.find((c) => c.id === cardId);
  if (!card) throw new Error("Kartu tidak ditemukan!");
  if (card.type === "LAVA_CAT") throw new Error("Tidak bisa main Lava Cat!");
  if (card.type === "WATER_BUCKET") throw new Error("Water Bucket hanya otomatis saat draw Lava Cat!");
}

// ============================================================
// SERIALIZE STATE FOR CLIENT
// ============================================================
export function serializeForClient(state: GameState, viewerId?: string): ClientGameState {
  const players: ClientPlayer[] = state.turnOrder.map((pid) => {
    const p = state.players.get(pid)!;
    return {
      sessionId: p.sessionId,
      username: p.username,
      handCount: p.hand.length,
      hand: viewerId === pid ? p.hand : undefined, // hanya kasih hand ke pemain itu sendiri
      isAlive: p.isAlive,
      hasBunker: p.hasBunker,
      isLocked: p.isLocked,
      connected: p.connected,
      away: p.away,
    };
  });

  return {
    roomId: state.roomId,
    status: state.status,
    hostId: state.hostId,
    players,
    turnOrder: state.turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    turnDirection: state.turnDirection,
    pendingTurns: state.pendingTurns,
    deckCount: state.deck.length,
    discardPile: state.discardPile.slice(-10), // kirim 10 kartu terakhir discard
    pendingAction: state.pendingAction,
    winner: state.winner,
    log: state.log.slice(-30), // kirim 30 log terakhir
  };
}

// ============================================================
// HELPERS
// ============================================================
function addLog(message: string, type: GameLogEntry["type"]): GameLogEntry {
  return { timestamp: Date.now(), message, type };
}
