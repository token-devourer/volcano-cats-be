// ============================================================
// EFFECTS — resolve a card's effect after the freeze window closes
// ============================================================
// Called once an interruptible action survives the Nope/Freeze window.
// The played card(s) are already in the discard pile; this only applies
// the consequence. Every effect that harms a player routes through
// `tryShield` so Bunker behaves consistently. Effects either:
//   • continue the actor's turn      → resumeTurnPhase
//   • end / pass the turn            → consumeTurn / applyAttack
//   • open a follow-up input phase   → await_favor / await_flood / …
// ============================================================

import type { GameEvent } from "../shared/events";
import type { Card } from "../shared/protocol";
import type { CardType } from "../shared/cards";
import type { GameState, HeldAction, EngineResult, PrivateReveal } from "./state";
import { getPlayer, withPlayer, withPlayers, livingPlayers } from "./state";
import { peekTop } from "./deck";
import { drawForPlayer } from "./draw";
import {
  consumeTurn,
  applyAttack,
  resumeTurnPhase,
  nextLivingPlayerId,
  livingCount,
} from "./turn";
import { tryShield } from "./shield";
import { randInt, shuffle, type Rng } from "./rng";

function resume(state: GameState, events: GameEvent[] = [], reveals: PrivateReveal[] = []): EngineResult {
  return { state: resumeTurnPhase(state), events, reveals };
}

/** Move one random card from `fromId` to `toId`. */
function stealRandom(
  state: GameState,
  fromId: string,
  toId: string,
  rng: Rng,
): { state: GameState; card: Card | null } {
  const from = getPlayer(state, fromId);
  if (from.hand.length === 0) return { state, card: null };
  const idx = randInt(from.hand.length, rng);
  const card = from.hand[idx];
  const to = getPlayer(state, toId);
  const next = withPlayers(state, {
    [fromId]: { hand: from.hand.filter((_, i) => i !== idx) },
    [toId]: { hand: [...to.hand, card] },
  });
  return { state: next, card };
}

// ------------------------------------------------------------
// MAIN ENTRY
// ------------------------------------------------------------
export function resolveEffect(state: GameState, held: HeldAction, rng: Rng): EngineResult {
  switch (held.cardType) {
    case "NAP_TIME": {
      const r = consumeTurn(state);
      return { state: r.state, events: [{ kind: "SKIPPED", actorId: held.actorId }, ...r.events], reveals: [] };
    }

    case "ERUPTION": {
      const targetId = nextLivingPlayerId(state);
      const r = applyAttack(state);
      return {
        state: r.state,
        events: [{ kind: "ATTACK", actorId: held.actorId, targetId, turns: r.nextOwed }, ...r.events],
        reveals: [],
      };
    }

    case "REVERSE": {
      const direction = (state.direction === 1 ? -1 : 1) as 1 | -1;
      let s: GameState = { ...state, direction };
      const events: GameEvent[] = [{ kind: "REVERSED", actorId: held.actorId, direction }];
      // With only two players, Reverse would be a no-op, so it doubles as a Skip.
      if (livingCount(s) <= 2) {
        const r = consumeTurn(s);
        return { state: r.state, events: [...events, ...r.events], reveals: [] };
      }
      return resume(s, events);
    }

    case "EARTHQUAKE": {
      const s: GameState = { ...state, deck: shuffle(state.deck, rng) };
      return resume(s, [{ kind: "SHUFFLED", actorId: held.actorId }]);
    }

    case "SPY_CAT": {
      const cards = peekTop(state, 3);
      return resume(
        state,
        [{ kind: "SPIED", actorId: held.actorId }],
        [{ playerId: held.actorId, mode: "spy", cards }],
      );
    }

    case "BUNKER": {
      const s = withPlayer(state, held.actorId, { hasBunker: true });
      return resume(s, [{ kind: "BUNKER_SET", playerId: held.actorId }]);
    }

    case "SNIPER": {
      const targetId = held.targetId!;
      const shield = tryShield(state, targetId);
      if (shield.shielded) return resume(shield.state, shield.events);
      // Forced, out-of-turn draw that does NOT end the sniper's turn.
      const res = drawForPlayer(state, targetId, rng, "forced");
      return {
        state: res.state,
        events: [{ kind: "FORCED_DRAW", actorId: held.actorId, targetId }, ...res.events],
        reveals: res.reveals,
      };
    }

    case "BRIBE": {
      const targetId = held.targetId!;
      const target = getPlayer(state, targetId);
      const shield = tryShield(state, targetId);
      if (shield.shielded) return resume(shield.state, shield.events);
      if (!target.alive || target.hand.length === 0) return resume(state); // nothing to give
      return {
        state: { ...state, phase: { kind: "await_favor", fromId: targetId, toId: held.actorId } },
        events: [],
        reveals: [],
      };
    }

    case "PICKPOCKET": {
      const targetId = held.targetId!;
      const target = getPlayer(state, targetId);
      const shield = tryShield(state, targetId);
      if (shield.shielded) return resume(shield.state, shield.events);
      if (!target.alive || target.hand.length === 0) return resume(state);
      // Redesigned: the actor SEES the target's hand, then chooses a card to take.
      return {
        state: { ...state, phase: { kind: "await_pickpocket", playerId: held.actorId, targetId } },
        events: [],
        reveals: [{ playerId: held.actorId, mode: "pickpocket", cards: target.hand }],
      };
    }

    case "LOCKDOWN": {
      const targetId = held.targetId!;
      const shield = tryShield(state, targetId);
      if (shield.shielded) return resume(shield.state, shield.events);
      const s = withPlayer(state, targetId, { locked: true });
      return resume(s, [{ kind: "LOCKED", actorId: held.actorId, targetId }]);
    }

    case "FLOOD": {
      // Global effect (Bunker does not block it). Everyone with a card owes a discard.
      const pending = livingPlayers(state).filter((p) => p.hand.length > 0).map((p) => p.id);
      if (pending.length === 0) return resume(state, [{ kind: "FLOOD_STARTED", actorId: held.actorId }]);
      return {
        state: { ...state, phase: { kind: "await_flood", pending } },
        events: [{ kind: "FLOOD_STARTED", actorId: held.actorId }],
        reveals: [],
      };
    }

    case "TIME_WARP": {
      if (state.discard.length === 0) return resume(state); // nothing to retrieve
      return {
        state: { ...state, phase: { kind: "await_timewarp", playerId: held.actorId } },
        events: [],
        reveals: [],
      };
    }

    case "PEEK_AND_SWAP": {
      if (state.deck.length === 0) return resume(state);
      const top = peekTop(state, 1);
      return {
        state: { ...state, phase: { kind: "await_peek_swap", playerId: held.actorId } },
        events: [],
        reveals: [{ playerId: held.actorId, mode: "swap", cards: top }],
      };
    }

    // ---- GANG combos ----
    case "GANG_FIRE":
    case "GANG_ICE":
    case "GANG_STORM":
    case "GANG_EARTH":
    case "GANG_SHADOW":
      return resolveGang(state, held, rng);

    default:
      // Exhaustiveness guard — a new card type must be handled explicitly.
      return resume(state);
  }
}

function resolveGang(state: GameState, held: HeldAction, rng: Rng): EngineResult {
  const combo = held.combo!;
  const actorId = held.actorId;

  if (combo === "rainbow") {
    const targetId = held.targetId!;
    const shield = tryShield(state, targetId);
    if (shield.shielded) return resume(shield.state, shield.events);
    const target = getPlayer(state, targetId);
    if (!target.alive) return resume(state);
    const me = getPlayer(state, actorId);
    const s = withPlayers(state, {
      [actorId]: { hand: target.hand },
      [targetId]: { hand: me.hand },
    });
    return resume(s, [{ kind: "HANDS_SWAPPED", actorId, targetId }]);
  }

  if (combo === "quad") {
    // Steal one random card from every other living player (each may Bunker-block).
    let s = state;
    const events: GameEvent[] = [];
    for (const p of livingPlayers(s)) {
      if (p.id === actorId || p.hand.length === 0) continue;
      const shield = tryShield(s, p.id);
      if (shield.shielded) {
        s = shield.state;
        events.push(...shield.events);
        continue;
      }
      const r = stealRandom(s, p.id, actorId, rng);
      s = r.state;
    }
    events.push({ kind: "RAID", actorId });
    return resume(s, events);
  }

  if (combo === "triple") {
    const targetId = held.targetId!;
    const declared = held.declaredType!;
    const shield = tryShield(state, targetId);
    if (shield.shielded) return resume(shield.state, shield.events);
    const target = getPlayer(state, targetId);
    const idx = target.hand.findIndex((c) => c.type === declared);
    if (idx === -1) {
      return resume(state, [{ kind: "STEAL_NONE", actorId, targetId, cardType: declared }]);
    }
    const card = target.hand[idx];
    const me = getPlayer(state, actorId);
    const s = withPlayers(state, {
      [targetId]: { hand: target.hand.filter((_, i) => i !== idx) },
      [actorId]: { hand: [...me.hand, card] },
    });
    return resume(s, [{ kind: "STEAL_NAMED", actorId, targetId, cardType: declared }]);
  }

  // pair
  const targetId = held.targetId!;
  const shield = tryShield(state, targetId);
  if (shield.shielded) return resume(shield.state, shield.events);
  const r = stealRandom(state, targetId, actorId, rng);
  if (!r.card) return resume(state);
  return resume(r.state, [{ kind: "STEAL_RANDOM", actorId, targetId }]);
}

export type { CardType };
