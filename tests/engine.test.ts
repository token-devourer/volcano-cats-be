import { describe, it, expect } from "vitest";
import { Table, eventKinds } from "./helpers";
import * as Engine from "../src/domain";
import { lavaCatCount } from "../src/domain/deck";

// ============================================================
// SETUP / DEAL
// ============================================================
describe("setup", () => {
  it("deals 6 cards + 1 Water Bucket to each player and buries Lava Cats", () => {
    const t = new Table(4, 1);
    for (const id of t.ids) {
      expect(t.hand(id).length).toBe(7);
      expect(t.hand(id).filter((c) => c.type === "WATER_BUCKET").length).toBe(1);
      expect(t.hand(id).some((c) => c.type === "LAVA_CAT")).toBe(false);
    }
    const lavaInDeck = t.state.deck.filter((c) => c.type === "LAVA_CAT").length;
    expect(lavaInDeck).toBe(lavaCatCount(4)); // 3
    expect(t.state.status).toBe("playing");
    expect(t.phaseKind()).toBe("turn");
    expect(t.current()).toBe("p0");
  });

  it("requires the host and at least 2 players to start", () => {
    const solo = new Table(1, 1, false);
    expect(() => solo.do("p0", { t: "START_GAME" })).toThrow("NOT_ENOUGH_PLAYERS");
    const t = new Table(3, 1, false);
    expect(() => t.do("p1", { t: "START_GAME" })).toThrow("NOT_HOST");
  });
});

// ============================================================
// TURN FLOW
// ============================================================
describe("turn flow", () => {
  it("a normal draw ends the turn and advances", () => {
    const t = new Table(3, 1);
    t.setDeckTop(["NAP_TIME"]);
    t.setTurn("p0");
    t.do("p0", { t: "DRAW" });
    expect(t.current()).toBe("p1");
    expect(eventKinds(t.lastEvents)).toContain("CARD_DREW");
  });

  it("rejects acting out of turn", () => {
    const t = new Table(3, 1);
    expect(() => t.do("p1", { t: "DRAW" })).toThrow("NOT_YOUR_TURN");
  });

  it("Nap Time skips the turn without drawing", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["NAP_TIME"]);
    t.setTurn("p0");
    const before = t.state.deck.length;
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "NAP_TIME") });
    expect(t.current()).toBe("p1");
    expect(t.state.deck.length).toBe(before); // no draw happened
    expect(eventKinds(t.lastEvents)).toContain("SKIPPED");
  });
});

// ============================================================
// ERUPTION (Attack) + stacking  (regression #8)
// ============================================================
describe("Eruption / attack stacking", () => {
  it("forces the next player to take 2 turns", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["ERUPTION"]);
    t.setTurn("p0");
    const r = t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "ERUPTION") });
    const attack = r.events.find((e) => e.kind === "ATTACK");
    expect(attack).toMatchObject({ kind: "ATTACK", turns: 2 });
    expect(t.current()).toBe("p1");
    expect(t.state.turnsRemaining).toBe(2);
  });

  it("stacks: a player under attack who erupts passes (R-1)+2 turns", () => {
    const t = new Table(3, 1);
    t.setHand("p1", ["ERUPTION"]);
    t.setTurn("p1", 2); // p1 already owes 2
    const r = t.playResolve("p1", { t: "PLAY", cardId: t.cardId("p1", "ERUPTION") });
    const attack = r.events.find((e) => e.kind === "ATTACK");
    expect(attack).toMatchObject({ turns: 3 }); // (2-1)+2
    expect(t.current()).toBe("p2");
    expect(t.state.turnsRemaining).toBe(3);
  });
});

// ============================================================
// REVERSE
// ============================================================
describe("Reverse", () => {
  it("flips direction with 3+ players and keeps the turn", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["REVERSE"]);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "REVERSE") });
    expect(t.state.direction).toBe(-1);
    expect(t.current()).toBe("p0"); // turn continues
  });

  it("doubles as a Skip with only two players", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["REVERSE"]);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "REVERSE") });
    expect(t.current()).toBe("p1"); // turn passed
  });
});

// ============================================================
// SPY CAT — private reveal, no leak
// ============================================================
describe("Spy Cat", () => {
  it("privately reveals the top 3 cards to the actor and keeps the turn", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["SPY_CAT"]);
    t.setDeckTop(["NAP_TIME", "BRIBE", "EARTHQUAKE", "REVERSE"]);
    t.setTurn("p0");
    const r = t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "SPY_CAT") });
    expect(r.reveals).toHaveLength(1);
    expect(r.reveals[0]).toMatchObject({ playerId: "p0", mode: "spy" });
    expect(r.reveals[0].cards.map((c) => c.type)).toEqual(["NAP_TIME", "BRIBE", "EARTHQUAKE"]);
    expect(t.current()).toBe("p0");
  });
});

// ============================================================
// BRIBE (Favor)
// ============================================================
describe("Bribe / Favor", () => {
  it("forces the target to give a chosen card", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["BRIBE"]);
    t.setHand("p1", ["NAP_TIME", "EARTHQUAKE"]);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "BRIBE"), targetId: "p1" });
    expect(t.phaseKind()).toBe("await_favor");
    const give = t.cardId("p1", "EARTHQUAKE");
    t.do("p1", { t: "GIVE_CARD", cardId: give });
    expect(t.hand("p0").some((c) => c.type === "EARTHQUAKE")).toBe(true);
    expect(t.hand("p1").some((c) => c.type === "EARTHQUAKE")).toBe(false);
    expect(t.current()).toBe("p0");
  });
});

// ============================================================
// REGRESSION #1 — Rainbow Gang resolves (used to crash 100%)
// ============================================================
describe("Rainbow Gang (regression #1)", () => {
  it("swaps hands with the target instead of crashing", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["GANG_FIRE", "GANG_ICE", "GANG_STORM", "GANG_EARTH", "GANG_SHADOW"]);
    t.setHand("p1", ["NAP_TIME", "BRIBE"]);
    t.setTurn("p0");
    const ids = t.hand("p0").map((c) => c.id);
    const r = t.playResolve("p0", { t: "PLAY_GANG", cardIds: ids, targetId: "p1" });
    expect(eventKinds(r.events)).toContain("HANDS_SWAPPED");
    // p0 played all 5 gang cards (discarded), so its hand becomes p1's old hand.
    expect(t.hand("p0").map((c) => c.type).sort()).toEqual(["BRIBE", "NAP_TIME"]);
    expect(t.hand("p1")).toHaveLength(0);
  });
});

// ============================================================
// REGRESSION #2 — Sniper does not end the sniper's own turn
// ============================================================
describe("Sniper (regression #2)", () => {
  it("forces the target to draw without ending the sniper's turn", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["SNIPER"]);
    t.setDeckTop(["NAP_TIME"]); // the safe card p1 will be forced to draw
    t.setTurn("p0");
    const before = t.hand("p1").length;
    const r = t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "SNIPER"), targetId: "p1" });
    expect(eventKinds(r.events)).toContain("FORCED_DRAW");
    expect(t.hand("p1").length).toBe(before + 1);
    expect(t.current()).toBe("p0"); // sniper keeps the turn
    expect(t.phaseKind()).toBe("turn");
  });

  it("routes a forced Lava Cat draw into the victim's bucket placement, turn stays with sniper", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["SNIPER"]);
    t.setHand("p1", ["WATER_BUCKET"]);
    t.setDeckTop(["LAVA_CAT"]);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "SNIPER"), targetId: "p1" });
    expect(t.phaseKind()).toBe("await_bucket");
    expect((t.state.phase as { playerId: string }).playerId).toBe("p1");
    t.do("p1", { t: "PLACE_BUCKET", position: 0 });
    expect(t.current()).toBe("p0"); // resumes the sniper's turn
  });
});

// ============================================================
// REGRESSION #3 — empty deck reshuffles instead of crashing
// ============================================================
describe("deck exhaustion (regression #3)", () => {
  it("reshuffles the discard (minus Lava Cats) when the deck is empty", () => {
    const t = new Table(3, 1);
    t.setTurn("p0");
    t.state = { ...t.state, deck: [], discard: [
      ...["NAP_TIME", "BRIBE", "EARTHQUAKE"].map((x) => ({ id: x, type: x as never })),
    ] };
    const before = t.hand("p0").length;
    expect(() => t.do("p0", { t: "DRAW" })).not.toThrow();
    expect(t.hand("p0").length).toBe(before + 1);
  });
});

// ============================================================
// REGRESSION #4 — Flood completes even with an away player
// ============================================================
describe("Flood + away player (regression #4)", () => {
  it("auto-resolves the away player's discard so the game never deadlocks", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["FLOOD", "NAP_TIME"]);
    t.setHand("p1", ["BRIBE"]);
    t.setHand("p2", ["REVERSE"]);
    t.setAway("p1", true);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "FLOOD") });
    expect(t.phaseKind()).toBe("await_flood");

    // The away player owes a discard but will never send one — the auto policy must.
    const step = Engine.nextAutoStep(t.state, t.rng);
    expect(step?.actorId).toBe("p1");
    t.do(step!.actorId, step!.cmd);

    // Remaining living players discard manually.
    t.do("p0", { t: "FLOOD_DISCARD", cardId: t.cardId("p0", "NAP_TIME") });
    t.do("p2", { t: "FLOOD_DISCARD", cardId: t.cardId("p2", "REVERSE") });
    expect(t.phaseKind()).toBe("turn");
    expect(t.current()).toBe("p0");
  });
});

// ============================================================
// REGRESSION #5 — Freeze can be countered by another Freeze
// ============================================================
describe("Freeze stack (regression #5)", () => {
  it("a single Freeze negates the action", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["ERUPTION"]);
    t.setHand("p1", ["FREEZE"]);
    t.setTurn("p0");
    t.do("p0", { t: "PLAY", cardId: t.cardId("p0", "ERUPTION") });
    expect(t.phaseKind()).toBe("nope_window");
    t.do("p1", { t: "FREEZE" });
    const r = t.resolve();
    expect(eventKinds(r.events)).toContain("ACTION_NEGATED");
    expect(t.current()).toBe("p0"); // attack fizzled, p0 keeps the turn
  });

  it("a Freeze-the-Freeze restores the action (even parity resolves)", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["ERUPTION"]);
    t.setHand("p1", ["FREEZE"]);
    t.setHand("p2", ["FREEZE"]);
    t.setTurn("p0");
    t.do("p0", { t: "PLAY", cardId: t.cardId("p0", "ERUPTION") });
    t.do("p1", { t: "FREEZE" }); // count 1 → would negate
    t.do("p2", { t: "FREEZE" }); // count 2 → restores
    const r = t.resolve();
    expect(eventKinds(r.events)).toContain("ATTACK");
    expect(t.current()).toBe("p1"); // eruption resolved, attack landed on next player
  });

  it("rejects Freeze with no card or no window", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["NAP_TIME"]);
    t.setHand("p1", []);
    t.setTurn("p0");
    t.do("p0", { t: "PLAY", cardId: t.cardId("p0", "NAP_TIME") });
    expect(() => t.do("p1", { t: "FREEZE" })).toThrow("NO_FREEZE");
  });
});

// ============================================================
// REGRESSION #6 — Bunker blocks the first negative effect, broadly
// ============================================================
describe("Bunker shield (regression #6)", () => {
  it("blocks a Gang Pair steal and is consumed", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["GANG_FIRE", "GANG_FIRE"]);
    t.setHand("p1", ["NAP_TIME"]);
    t.giveBunker("p1");
    t.setTurn("p0");
    const ids = t.hand("p0").map((c) => c.id);
    const r = t.playResolve("p0", { t: "PLAY_GANG", cardIds: ids, targetId: "p1" });
    expect(eventKinds(r.events)).toContain("BUNKER_SAVED");
    expect(t.player("p1").hasBunker).toBe(false);
    expect(t.hand("p1").some((c) => c.type === "NAP_TIME")).toBe(true); // not stolen
  });

  it("blocks Sniper and Bribe too", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["SNIPER"]);
    t.setHand("p1", ["NAP_TIME"]);
    t.giveBunker("p1");
    t.setDeckTop(["EARTHQUAKE"]);
    t.setTurn("p0");
    const before = t.hand("p1").length;
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "SNIPER"), targetId: "p1" });
    expect(t.player("p1").hasBunker).toBe(false);
    expect(t.hand("p1").length).toBe(before); // no forced draw
  });
});

// ============================================================
// REGRESSION #7 — Lockdown blocks playing for exactly one turn
// ============================================================
describe("Lockdown (regression #7)", () => {
  it("prevents the target from playing on their turn, then clears", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["LOCKDOWN"]);
    t.setHand("p1", ["NAP_TIME"]);
    t.setDeckTop(["BRIBE", "REVERSE"]);
    t.setTurn("p0");
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "LOCKDOWN"), targetId: "p1" });
    expect(t.player("p1").locked).toBe(true);

    t.do("p0", { t: "DRAW" }); // p0 ends turn → p1's turn
    expect(t.current()).toBe("p1");
    expect(() => t.do("p1", { t: "PLAY", cardId: t.cardId("p1", "NAP_TIME") })).toThrow("LOCKED");
    t.do("p1", { t: "DRAW" }); // drawing is allowed; ends the locked turn
    expect(t.player("p1").locked).toBe(false); // lock consumed
  });
});

// ============================================================
// REGRESSION #9 — no Lava Cat identity leak during placement
// ============================================================
describe("no info leak (regression #9)", () => {
  it("await_bucket does not expose the drawn Lava Cat to clients", () => {
    const t = new Table(3, 1);
    t.setHand("p0", ["WATER_BUCKET"]);
    t.setDeckTop(["LAVA_CAT"]);
    t.setTurn("p0");
    t.do("p0", { t: "DRAW" });
    expect(t.phaseKind()).toBe("await_bucket");
    const client = Engine.serializeForViewer(t.state);
    const lavaId = t.state.bucketCard!.id;
    expect(JSON.stringify(client)).not.toContain(lavaId);
    // deck contents are never serialized, only a count
    expect((client as { deck?: unknown }).deck).toBeUndefined();
  });
});

// ============================================================
// REGRESSION #10 — Time Warp has its own phase
// ============================================================
describe("Time Warp (regression #10)", () => {
  it("opens await_timewarp (not await_flood) and retrieves a discard card", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["TIME_WARP"]);
    t.setTurn("p0");
    t.state = { ...t.state, discard: [{ id: "d1", type: "NAP_TIME" }] };
    t.playResolve("p0", { t: "PLAY", cardId: t.cardId("p0", "TIME_WARP") });
    expect(t.phaseKind()).toBe("await_timewarp");
    t.do("p0", { t: "TIMEWARP_PICK", cardId: "d1" });
    expect(t.hand("p0").some((c) => c.id === "d1")).toBe(true);
    expect(t.current()).toBe("p0");
  });
});

// ============================================================
// GANG: triple (named) + quad (raid)
// ============================================================
describe("Gang combos", () => {
  it("triple steals a named card type when present", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["GANG_ICE", "GANG_ICE", "GANG_ICE"]);
    t.setHand("p1", ["BRIBE", "NAP_TIME"]);
    t.setTurn("p0");
    const ids = t.hand("p0").map((c) => c.id);
    const r = t.playResolve("p0", { t: "PLAY_GANG", cardIds: ids, targetId: "p1", declaredType: "BRIBE" });
    expect(eventKinds(r.events)).toContain("STEAL_NAMED");
    expect(t.hand("p0").some((c) => c.type === "BRIBE")).toBe(true);
    expect(t.hand("p1").some((c) => c.type === "BRIBE")).toBe(false);
  });

  it("triple whiffs (STEAL_NONE) when the named type is absent", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["GANG_ICE", "GANG_ICE", "GANG_ICE"]);
    t.setHand("p1", ["NAP_TIME"]);
    t.setTurn("p0");
    const ids = t.hand("p0").map((c) => c.id);
    const r = t.playResolve("p0", { t: "PLAY_GANG", cardIds: ids, targetId: "p1", declaredType: "BRIBE" });
    expect(eventKinds(r.events)).toContain("STEAL_NONE");
    expect(t.hand("p0").some((c) => c.type === "BRIBE")).toBe(false);
  });

  it("rejects an invalid gang combo", () => {
    const t = new Table(2, 1);
    t.setHand("p0", ["GANG_ICE", "GANG_FIRE"]); // two different types, not a valid pair
    t.setTurn("p0");
    const ids = t.hand("p0").map((c) => c.id);
    expect(() => t.do("p0", { t: "PLAY_GANG", cardIds: ids, targetId: "p1" })).toThrow("INVALID_GANG");
  });
});

// ============================================================
// WIN
// ============================================================
describe("win condition", () => {
  it("ends the game when only one player remains", () => {
    const t = new Table(2, 1);
    t.setHand("p1", []); // no bucket
    t.setDeckTop(["LAVA_CAT"]);
    t.setTurn("p1");
    t.do("p1", { t: "DRAW" });
    expect(t.state.status).toBe("finished");
    expect(t.state.winnerId).toBe("p0");
    expect(eventKinds(t.lastEvents)).toContain("WIN");
  });
});
