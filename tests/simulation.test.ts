import { describe, it, expect } from "vitest";
import { Table } from "./helpers";
import { CARD_SPECS, isPlayable, isGangType, type CardType } from "../src/shared/cards";

// ============================================================
// Full-game simulations — a legal-move bot plays to completion.
// Every command the bot issues must be legal, so any thrown error or
// failure to terminate exposes a real engine bug (crash or deadlock).
// ============================================================

const NO_TARGET_ACTIONS: CardType[] = [
  "NAP_TIME", "ERUPTION", "SPY_CAT", "EARTHQUAKE", "REVERSE", "BUNKER", "FLOOD", "PEEK_AND_SWAP",
];

function livingOthers(t: Table, me: string): string[] {
  return t.ids.filter((id) => id !== me && t.player(id).alive);
}

/** Pick a legal action for the player whose turn it is. */
function takeTurn(t: Table, me: string, roll: () => number) {
  const meP = t.player(me);
  if (meP.locked || roll() < 0.45) {
    t.do(me, { t: "DRAW" });
    return;
  }
  const hand = t.hand(me);
  const others = livingOthers(t, me);

  // Try a no-target action.
  const noTarget = hand.filter(
    (c) =>
      NO_TARGET_ACTIONS.includes(c.type) &&
      !(c.type === "FLOOD" && hand.length <= 1),
  );
  if (noTarget.length && roll() < 0.6) {
    t.do(me, { t: "PLAY", cardId: noTarget[Math.floor(roll() * noTarget.length)].id });
    return;
  }

  // Time Warp only when there's something to retrieve.
  const tw = hand.find((c) => c.type === "TIME_WARP");
  if (tw && t.state.discard.length > 0 && roll() < 0.4) {
    t.do(me, { t: "PLAY", cardId: tw.id });
    return;
  }

  // Targeted single action.
  const targeted = hand.find((c) => CARD_SPECS[c.type].target === "player" && isPlayable(c.type));
  if (targeted && others.length && roll() < 0.5) {
    t.do(me, { t: "PLAY", cardId: targeted.id, targetId: others[Math.floor(roll() * others.length)] });
    return;
  }

  // Gang pair, if available.
  const gangByType = new Map<CardType, string[]>();
  for (const c of hand) {
    if (!isGangType(c.type)) continue;
    gangByType.set(c.type, [...(gangByType.get(c.type) ?? []), c.id]);
  }
  const pair = [...gangByType.values()].find((ids) => ids.length >= 2);
  if (pair && others.length && roll() < 0.5) {
    t.do(me, {
      t: "PLAY_GANG",
      cardIds: pair.slice(0, 2),
      targetId: others[Math.floor(roll() * others.length)],
    });
    return;
  }

  t.do(me, { t: "DRAW" });
}

/** Drive whatever input the current phase requires (for any player). */
function step(t: Table, roll: () => number) {
  const phase = t.state.phase;
  switch (phase.kind) {
    case "turn":
      takeTurn(t, phase.playerId, roll);
      return;
    case "nope_window": {
      // Occasionally let a holder counter, exercising the freeze stack.
      if (roll() < 0.2) {
        const freezer = t.ids.find(
          (id) =>
            id !== phase.pending.actorId &&
            t.player(id).alive &&
            t.hand(id).some((c) => c.type === "FREEZE"),
        );
        if (freezer) {
          t.do(freezer, { t: "FREEZE" });
          return;
        }
      }
      t.resolve();
      return;
    }
    case "await_bucket":
      t.do(phase.playerId, { t: "PLACE_BUCKET", position: Math.floor(roll() * (t.state.deck.length + 1)) });
      return;
    case "await_favor": {
      const from = t.hand(phase.fromId);
      t.do(phase.fromId, { t: "GIVE_CARD", cardId: from[Math.floor(roll() * from.length)].id });
      return;
    }
    case "await_peek_swap":
      t.do(phase.playerId, { t: "PEEK_DECIDE", swap: false });
      return;
    case "await_flood": {
      const id = phase.pending[0];
      const hand = t.hand(id);
      t.do(id, { t: "FLOOD_DISCARD", cardId: hand[Math.floor(roll() * hand.length)].id });
      return;
    }
    case "await_timewarp":
      t.do(phase.playerId, { t: "TIMEWARP_PICK", cardId: t.state.discard[t.state.discard.length - 1].id });
      return;
    case "await_pickpocket": {
      const target = t.hand(phase.targetId);
      t.do(phase.playerId, { t: "PICKPOCKET_TAKE", cardId: target[Math.floor(roll() * target.length)].id });
      return;
    }
    case "lobby":
    case "finished":
      return;
  }
}

function playToEnd(numPlayers: number, seed: number): Table {
  const t = new Table(numPlayers, seed);
  // Deterministic per-game roll source independent of the engine's rng.
  let s = seed * 2654435761 + 1;
  const roll = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  let steps = 0;
  const MAX = 20000;
  while (t.state.status !== "finished" && steps < MAX) {
    step(t, roll);
    steps++;
  }
  expect(t.state.status).toBe("finished");
  return t;
}

describe("full-game simulation", () => {
  for (const n of [2, 3, 4, 6, 8]) {
    it(`completes a ${n}-player game without crashing or deadlocking`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const t = playToEnd(n, seed);
        const alive = t.ids.filter((id) => t.player(id).alive);
        expect(alive.length).toBe(1);
        expect(t.state.winnerId).toBe(alive[0]);
        // Invariant: every Lava Cat is accounted for (deck + discard), never in a hand.
        for (const id of t.ids) {
          expect(t.hand(id).some((c) => c.type === "LAVA_CAT")).toBe(false);
        }
      }
    });
  }
});
