// Lumi Dungeons battles (src/lumi/dungeon/lumibattle.js), ported at spec level from erinne tests/test_lumibattle.py:
// the turn rules, scaling, rewards (paid in SGC through sgc.pay), skills, mods and the Outfitters (sgc.spend).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  env, B, P, save, T0, TREES, BANK, OUTFITTERS, player, coins, Script, Seeded, makePet, fightOf, setPet, petOf, tx,
  startFight, turn, shop, refused,
} from "./dungeon_helpers.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));                                   // a deep copy
const price = (key, native) => env.tuning.scalePrice("battle", key, native);           // what the Outfitters charge
const balanceOf = (id) => env.eco.getBalance(id);                                      // any account

// ------------------------------------------------------------------ the catalog
test("the shipped roster is twenty originals across five tiers with six trees", () => {
  const enemies = B.CATALOG.enemies;                                                   // the creatures
  assert.equal(enemies.length, 20);                                                    // twenty
  assert.deepEqual(Object.keys(B.TIERS).map((t) => enemies.filter((e) => e.tier === t).length), [7, 5, 4, 3, 1]); // per tier
  assert.deepEqual(B.CATALOG.trees.map((t) => t.id), ["fighter", "thief", "monk", "mage", "cleric", "paladin"]); // six trees
  assert.ok(Object.values(TREES).every((nodes) => nodes.length === 8));                // eight skills each
  assert.equal(B.NODE_COSTS.reduce((a, b) => a + b, 0), 22);                           // 22 points a tree
  assert.ok(B.CATALOG.mods.filter((m) => m.tek === "magitek").length >= 2 && B.CATALOG.mods.filter((m) => m.tek === "cybertek").length >= 3); // enough mods
  assert.equal(B.MOD_SLOTS.filter(([tek]) => tek === "magitek").length, 2);            // two magitek slots
  assert.equal(B.MOD_SLOTS.filter(([tek]) => tek === "cybertek").length, 3);           // three cybertek slots
});

test("bad battle catalogs are refused", () => {
  const broken = (change) => {                                                         // break a copy and load it
    const data = clone(B.CATALOG);                                                     // a copy
    change(data);                                                                      // break it
    assert.throws(() => B.loadCatalog(data), /Lumi Pet's battles/);                    // refused
  };
  broken((d) => d.trees[0].nodes.pop());                                               // seven skills
  broken((d) => { d.trees[0].nodes[0].id = d.trees[1].nodes[0].id; });                // a repeated id
  broken((d) => { d.trees[0].nodes[0].effect = "explode"; });                          // an unknown effect
  broken((d) => { d.trees[0].nodes[1].bonus = { luck: 5 }; });                         // an unknown bonus
  broken((d) => { d.enemies[0].weak = ["wind"]; d.enemies[0].resist = ["wind"]; });    // weak and resistant at once
  broken((d) => { d.enemies[0].tier = "mythic"; });                                    // an unknown tier
  broken((d) => { d.enemies[0].moves[0].level = 5; });                                 // nothing at level 1
  broken((d) => { d.enemies[0].shape.hp = 9; });                                       // a silly shape
  broken((d) => { d.enemies = d.enemies.filter((e) => e.tier !== "legendary"); });     // a tier nobody can fight
  broken((d) => { d.mods[0].tek = "steamtek"; });                                      // an unknown kind
  assert.ok(B.loadCatalog(clone(B.CATALOG)));                                          // the real one loads
});

// ------------------------------------------------------------------ the formula
test("damage is Touhou Trader's formula times the pace", () => {
  const state = fightOf(makePet({ level: 10 }), "dust-bunny");                         // a fight
  const { player: lumi, enemy } = state;                                               // both sides
  const before = enemy.hp;                                                             // its health
  B._strike(state, lumi, enemy, lumi.moves[0], Script([], 0.999999));                  // a hit at the top of the roll, no crit
  const expected = Math.floor(Math.floor((((2 * 10 / 5 + 2) * 50 * lumi.stats.attack / enemy.stats.defense) / 50 + 2) * B.PACE) * (0.85 + 0.999999 * 0.15)); // erinne's sum
  assert.equal(before - enemy.hp, expected);                                           // exactly
  assert.match(state.log.at(-1), /Pounce/);                                            // said so
});

test("weak, resisted, immune and glow-matched elements", () => {
  const mage = makePet({ level: 20, skills: TREES.mage, glow: "lagoon", moves: ["frost-shard", "ember", "shadow-bolt", "glow-spark"] }); // an ice mage
  const hit = (enemyId, move) => {                                                     // one spell at a creature
    const state = fightOf(mage, enemyId);                                              // a fight
    B._strike(state, state.player, state.enemy, state.player.moves[move], Script([0.0, 0.999999], 0.999999)); // a hit, top roll
    return [state.enemy.hpMax - state.enemy.hp, state.log.at(-1)];                     // damage + words
  };
  const [weak, words] = hit("cinder-mite", 0);                                         // ice into a fire bug
  const plain = hit("dust-bunny", 0)[0];                                               // ice into nothing special
  const [resisted, said] = hit("frost-moth", 0);                                       // ice into ice
  assert.match(words, /super effective/);                                              // weak
  assert.match(said, /resisted/);                                                      // resisted
  assert.ok(weak > plain && plain > resisted);                                         // in that order
  assert.deepEqual(hit("comet-drake", 1), [0, "Lumi used Ember. It has no effect on Comet Drake!"]); // immune
  assert.equal(hit("void-jelly", 2)[0], 0);                                            // immune to dark
  const state = fightOf(mage, "dust-bunny");                                           // her own glow
  assert.equal(B._multiplier(state.player, state.enemy, state.player.moves[0]), B.GLOW_MATCH); // matched
  assert.equal(B._multiplier(state.player, state.enemy, state.player.moves[1]), 1.0);  // not matched
});

test("physical and magic use different defences", () => {
  const brawler = makePet({ level: 20, moves: ["pounce", "glow-spark"] });             // a brawler
  const slime = fightOf(brawler, "puddle-slime");                                      // soaks claws
  const jelly = fightOf(brawler, "void-jelly");                                        // soaks spells
  assert.ok(slime.enemy.stats.defense > 2 * slime.enemy.stats.ward);                   // hates spells
  assert.ok(jelly.enemy.stats.ward > 1.9 * jelly.enemy.stats.defense);                 // the other way round
});

test("her glow decides what hurts her and the Prism Shard copies it", () => {
  for (const [glow, element] of Object.entries(B.GLOW_ELEMENT)) {
    const state = fightOf(makePet({ level: 30, glow }), "prism-shard");                // the mirror
    const { player: lumi, enemy: shard } = state;                                      // both
    assert.equal(lumi.element, element);                                               // her glow
    assert.equal(shard.element, element);                                              // copied
    assert.deepEqual(shard.resist, [element]);                                         // resists itself
    assert.deepEqual(shard.weak, lumi.weak);                                           // breaks to what beats her
    assert.equal(lumi.weak.length, 1);                                                 // one weakness
    assert.equal(B.WHEEL[lumi.weak[0]][element], 1.5);                                 // by the wheel
  }
});

test("guarding halves a hit and gathers MP", () => {
  const state = fightOf(makePet({ level: 10 }), "moss-golem");                         // a fight
  state.player.mp = 0;                                                                 // empty
  B.resolve(state, "defend", Script([], 0.5));                                         // brace
  const guarded = state.player.hpMax - state.player.hp;                                // what got through
  const plain = fightOf(makePet({ level: 10 }), "moss-golem");                         // the same hit, unguarded
  B._strike(plain, plain.enemy, plain.player, plain.enemy.moves[0], Script([], 0.5));  // straight in
  assert.equal(guarded, Math.max(1, Math.floor((plain.player.hpMax - plain.player.hp) / 2))); // halved
  assert.equal(state.player.mp, B.DEFEND_MP);                                          // MP gathered
  assert.match(state.log.at(-1), /\(guarded\)/);                                       // said so
});

test("speed decides who goes first and a first move jumps the queue", () => {
  const slow = fightOf(makePet({ level: 10, skills: TREES.thief.slice(0, 1), moves: ["pounce", "quick-swipe"] }), "clockwork-owl"); // a fast owl
  B.resolve(slow, "move0", Script());                                                  // she is slower
  assert.ok(slow.log[0].startsWith("Clockwork Owl used"));                             // the owl first
  B.resolve(slow, "move1", Script());                                                  // Quick Swipe goes first
  assert.ok(slow.log[2].startsWith("Lumi used Quick Swipe"));                          // her first
});

test("poison bites at the end of each turn, then wears off, and a ward fades", () => {
  const pet = makePet({ level: 20, skills: [...TREES.thief.slice(0, 3), ...TREES.fighter.slice(0, 5)], moves: ["poison-thorn", "parry"] }); // poison + ward
  const state = fightOf(pet, "moss-golem");                                            // a fight
  B.resolve(state, "move0", Script());                                                 // poison it
  assert.deepEqual(state.enemy.status, { poison: B.STATUS_TURNS - 1 });                // bit once
  assert.ok(state.log.some((line) => line.includes("from the poison")));               // said so
  B.resolve(state, "move1", Script());                                                 // Parry: a ward
  assert.deepEqual(state.player.status, { ward: 2 });                                  // two turns left
  const hurt = state.player.hp;                                                        // her health
  B.resolve(state, "defend", Script());                                                // a turn
  B.resolve(state, "defend", Script());                                                // another
  assert.ok(!("poison" in state.enemy.status) && state.player.hp < hurt);              // worn off; she was hit
  B.resolve(state, "defend", Script());                                                // the ward fades
  assert.deepEqual(state.player.status, {});                                           // nothing left
});

test("a stun costs one action, and thorns prick claws but not spells", () => {
  const state = fightOf(makePet({ level: 10 }), "bell-phantom");                       // a fight
  state.enemy.status.stun = 1;                                                         // stunned
  const hp = state.player.hp;                                                          // her health
  B.resolve(state, "move0", Script());                                                 // a turn
  assert.equal(state.player.hp, hp);                                                   // it couldn't act
  assert.match(state.log.join(" "), /stunned and can't move/);                         // said so
  assert.ok(!("stun" in state.enemy.status));                                          // used up
  const thorny = fightOf(makePet({ level: 10 }), "thornling");                         // a thorny one
  B._strike(thorny, thorny.player, thorny.enemy, thorny.player.moves[0], Script());    // claws
  assert.ok(thorny.player.hp < thorny.player.hpMax);                                   // pricked
  assert.match(thorny.log.at(-1), /thorns prick/);                                     // said so
  const full = thorny.player.hp;                                                       // her health now
  B._strike(thorny, thorny.player, thorny.enemy, thorny.player.moves[1], Script());    // a spell
  assert.equal(thorny.player.hp, full);                                                // no prick
});

test("heals never overfill and multi-hit moves hit each time", () => {
  const monk = makePet({ level: 30, skills: TREES.monk, moves: ["meditate", "hundred-paws"] }); // a monk
  const state = fightOf(monk, "moss-golem");                                           // a fight
  state.player.hp = state.player.hpMax - 3;                                            // nearly full
  B._strike(state, state.player, state.player, state.player.moves[0], Script());       // Meditate
  assert.equal(state.player.hp, state.player.hpMax);                                   // full, not over
  B._strike(state, state.player, state.enemy, state.player.moves[1], Script());        // Hundred Paws
  assert.equal(state.log.filter((line) => line.includes("Hundred Paws")).length, 4);   // four hits
});

test("running works three times in four and a failed run costs a hit", () => {
  const away = fightOf(makePet({ level: 5 }), "dust-bunny");                           // a fight
  B.resolve(away, "run", Script([0.74]));                                              // under 0.75
  assert.equal(away.outcome, "ran");                                                   // away
  const stuck = fightOf(makePet({ level: 5 }), "dust-bunny");                          // another
  B.resolve(stuck, "run", Script([0.75]));                                             // not under
  assert.equal(stuck.outcome, null);                                                   // still there
  assert.ok(stuck.player.hp < stuck.player.hpMax);                                     // and hit
});

// ------------------------------------------------------------------ scaling
test("enemies scale with Lumi by tier and grow tougher as she learns", () => {
  const e = (id, level, lumiLevel) => B._enemy(B._ENEMIES[id], level, lumiLevel, "fire"); // a scaled enemy
  const low = e("dust-bunny", 5, 5);                                                   // early
  const high = e("dust-bunny", 45, 45);                                                // late
  assert.ok(high.hp > 5 * low.hp && high.stats.attack > 3 * low.stats.attack);         // much tougher
  const early = e("dust-bunny", 30, 1);                                                // her level 1
  const late = e("dust-bunny", 30, 50);                                                // her level 50
  assert.ok(Math.abs(late.hp / (2 * early.hp) - 1) < 0.02);                            // health keeps pace with her points
  const common = e("dust-bunny", 30, 30);                                              // a common
  const legend = e("comet-drake", 30, 30);                                             // a legendary
  assert.ok(legend.hp > 2 * common.hp && legend.stats.attack > common.stats.attack);   // tougher
  assert.deepEqual([1, 10, 20, 30, 40].map((level) => e("comet-drake", level, level).moves.length), [1, 2, 3, 4, 5]); // moves by level
});

test("an enemy appears within two levels and never outside one to fifty", () => {
  const uid = player();                                                                // a player
  for (const [level, pick, expected] of [[1, 0, 1], [20, 0, 18], [20, 4, 22], [50, 4, 50]]) {
    setPet(uid, { level });                                                            // her level
    const fight = startFight(uid, "common", Script([], 0.5, pick));                    // a fight
    assert.equal(fight.enemy.level, expected);                                         // its level
    turn(uid, fight, "run", Script([0.1]));                                            // run away
  }
});

// ------------------------------------------------------------------ fights, saved
test("one fight at a time, that waits, and refuses stale buttons", () => {
  const uid = player();                                                                // a player
  const fight = startFight(uid);                                                       // a fight
  assert.equal(fight.turn, 0);                                                         // turn 0
  assert.equal(fight.status, "active");                                                // under way
  assert.deepEqual(fight.log, [`A wild ${fight.enemy.name} appears!`]);                // its first line
  refused(() => startFight(uid), /already in a fight/);                                // one at a time
  const later = tx(() => { save.load(uid, { now: T0 + 30 * 24 * 3_600_000 }); return B.current(uid); }); // a month later
  assert.equal(later.id, fight.id);                                                    // still waiting
  const after = turn(uid, fight, "defend");                                            // a turn
  assert.equal(after.turn, 1);                                                         // counted
  refused(() => turn(uid, fight, "move0"), /already happened/);                        // the old page's button
  refused(() => turn(uid, after, "move3"), /doesn't have that move/);                  // no fourth move
  const bob = player();                                                                // someone else
  refused(() => tx(() => P.fightAct(bob, fight.id, 1, "defend", T0)), /isn't Lumi's/); // not hers
});

test("a win pays EXP and SGC once, by the fight's id, and can level her up", () => {
  const uid = player();                                                                // a player with 1000 SGC
  setPet(uid, { level: 30 });                                                          // level 30
  let fight = startFight(uid, "common", Script([], 0.5, 2));                           // same level, third common
  while (fight.status === "active") fight = turn(uid, fight, "move0", Script([], 0.01)); // hit every time
  const gained = 15 + 30 * 3;                                                          // EXP
  const sgcWon = env.tuning.scalePayout("battle", "win", Math.floor(gained * 0.6));    // the native prize, scaled
  assert.equal(fight.status, "victory");                                               // won
  assert.deepEqual(fight.reward, { exp: gained, coins: sgcWon, sgc: sgcWon, level: 30, levels: 0 }); // the reward
  assert.equal(coins(uid), 1000 + sgcWon);                                             // paid
  assert.match(fight.log.at(-1), new RegExp(`Victory! \\+${gained} EXP, \\+${sgcWon} SGC\\.`)); // said in SGC
  const pet = petOf(uid);                                                              // her save
  assert.equal(pet.exp, gained);                                                       // EXP kept
  assert.equal(pet.wins, 1);                                                           // a win
  assert.equal(B.current(uid), null);                                                  // no fight waiting
  const ref = env.eco.getEconomyDb().prepare("SELECT amount FROM lumi_coin_refs WHERE ref = ?").get(`lumi-battle:${fight.id}`); // the pay-once ref
  assert.equal(ref.amount, sgcWon);                                                    // paid by the fight's id
  const ledger = env.eco.getEconomyDb().prepare("SELECT from_user_id, amount FROM transactions WHERE type = 'lumi_battle_win'").get(); // the ledger row
  assert.deepEqual({ ...ledger }, { from_user_id: BANK, amount: sgcWon });             // from Lumi-Town Bank
  refused(() => turn(uid, fight, "move0"), /is over/);                                 // finished
  assert.equal(tx(() => env.sgc.pay(uid, "x", 500, "battle", "win", `lumi-battle:${fight.id}`)).duplicate, true); // never pays again
});

test("levels follow the curve and stop at fifty; gamble, luck and the coin bonus multiply", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 1 });                                                           // level 1
  let fight = startFight(uid);                                                         // a fight
  while (fight.status === "active") fight = turn(uid, fight, "move0", Script([], 0.01)); // win it
  assert.equal(fight.reward.level, 1);                                                 // 18 of the 35 needed
  assert.equal(B.levelThreshold(1), 35);                                               // the curve
  const pet = makePet({ level: 49 });                                                  // nearly there
  pet.exp = B.levelThreshold(49) - 1;                                                  // one short
  const state = { enemy: { level: 50, tier: "legendary" }, choice: "gamble", boost: "luck", player: { stats: { coins: 20 } }, log: [], dungeon: true }; // a dungeon win: native coins
  B._reward(uid, pet, state, 999);                                                     // the reward
  const gained = Math.floor(Math.floor((15 + 150 + 50) * 1.2) * 1.25);                 // gamble, then luck
  assert.deepEqual([pet.level, pet.exp], [50, 0]);                                     // capped at 50
  assert.equal(state.reward.exp, gained);                                              // EXP
  assert.equal(state.reward.coins, Math.floor(Math.floor(Math.floor(Math.floor(215 * 0.6) * 1.2) * 1.25) * 1.2)); // gamble, lucky treat, Lucky Whiskers (native, for the satchel)
});

test("a defeat is a free ten-minute nap, or a paid wake from the Outfitters", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 1 });                                                           // level 1
  let fight = startFight(uid, "legendary");                                            // far too much
  while (fight.status === "active") fight = turn(uid, fight, "defend", Script([], 0.01)); // she braces until she drops
  assert.equal(fight.status, "defeat");                                                // beaten
  assert.match(fight.log.at(-1), new RegExp(`nap for ten minutes, or wake now for ${price("heal", 50)} SGC`)); // said in SGC
  assert.equal(coins(uid), 1000);                                                      // nothing paid
  refused(() => startFight(uid, "common", null, T0 + B.FAINT_MS - 1), /still napping/); // still asleep
  assert.equal(startFight(uid, "common", null, T0 + B.FAINT_MS).status, "active");     // free once the nap is over
  env.eco.getEconomyDb().prepare("DELETE FROM lumi_battles").run();                    // clear the fights
  setPet(uid, { faint_until: T0 + 5000 });                                             // asleep again
  const shopBefore = balanceOf(OUTFITTERS);                                            // the shop's till
  assert.deepEqual(shop(uid, "heal").said, { bought: "heal", count: 1, paid: price("heal", 50) }); // woken for SGC
  assert.equal(coins(uid), 1000 - price("heal", 50));                                  // charged
  assert.equal(balanceOf(OUTFITTERS) - shopBefore, price("heal", 50));                 // into Dungeon Outfitters
  assert.equal(startFight(uid).status, "active");                                      // up and fighting
  refused(() => shop(uid, "heal"), /already up/);                                      // awake already
});

test("running away costs and pays nothing", () => {
  const uid = player();                                                                // a player
  const fight = turn(uid, startFight(uid), "run", Script([0.1]));                      // run
  const pet = petOf(uid);                                                              // her save
  assert.equal(fight.status, "ran");                                                   // away
  assert.deepEqual([pet.wins, pet.losses, pet.faint_until, pet.exp], [0, 0, 0, 0]);    // nothing changed
  assert.equal(startFight(uid).status, "active");                                      // free to fight again
});

test("potions are bought between fights and only used when they help", () => {
  const uid = player();                                                                // a player
  assert.equal(shop(uid, "potions", { count: 3 }).coins, 1000 - 3 * price("potion", 20)); // three potions
  refused(() => shop(uid, "potions", { count: 8 }), /up to 10/);                       // too many
  let fight = startFight(uid, "rare");                                                 // a fight
  refused(() => turn(uid, fight, "potion"), /full health/);                            // no need yet
  fight = turn(uid, fight, "defend");                                                  // take a hit
  const hurt = fight.player.hp;                                                        // her health
  assert.ok(hurt < fight.player.hpMax);                                                // hurt
  fight = turn(uid, fight, "potion", Script([], 0.999));                               // drink (the reply misses)
  assert.equal(petOf(uid).potions, 2);                                                 // one used
  assert.ok(fight.player.hp > hurt);                                                   // better
  assert.match(fight.log.join(" "), /potion restores/);                                // said so
  setPet(uid, { potions: 0 });                                                         // none left
  refused(() => turn(uid, turn(uid, fight, "defend"), "potion"), /No potions left/);   // can't
});

test("a treat's boost is used by the next fight", () => {
  const uid = player();                                                                // a player
  setPet(uid, { boost: "power" });                                                     // a power treat
  const fight = startFight(uid);                                                       // a fight
  assert.equal(petOf(uid).boost, null);                                                // used
  assert.equal(fight.boost, "power");                                                  // in the fight
  const plain = fightOf(makePet({ level: 10 }), "moss-golem");                         // no boost
  const boosted = fightOf(makePet({ level: 10 }), "moss-golem", null, "power");        // boosted
  for (const state of [plain, boosted]) B._strike(state, state.player, state.enemy, state.player.moves[0], Script()); // the same hit
  assert.ok(boosted.enemy.hp < plain.enemy.hp);                                        // harder
});

test("spells need MP", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 30, skills: TREES.mage, moves: ["starfall"] });                 // a mage with Starfall
  let fight = startFight(uid, "epic");                                                 // a fight
  const mp = fight.player.mp;                                                          // her MP
  for (let i = 0; i < Math.floor(mp / 14); i += 1) fight = turn(uid, fight, "move0", Script([], 0.999)); // every blow misses; only MP goes
  assert.equal(fight.player.mp, mp % 14);                                              // spent
  refused(() => turn(uid, fight, "move0"), /Not enough MP/);                           // can't cast
});

// ------------------------------------------------------------------ skills, moves and mods
test("skill points come one a level and trees are learned in order", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 5 });                                                           // four points
  refused(() => shop(uid, "learn", { item: "armor-break" }), /Armor Break needs Heavy Paw first/); // not yet
  const first = shop(uid, "learn", { item: "heavy-paw" });                             // the root
  assert.equal(first.progress.points, 3);                                              // one spent
  assert.deepEqual(first.pet.moves, ["pounce", "glow-spark", "heavy-paw"]);            // ready to use
  const out = shop(uid, "learn", { item: "armor-break" });                             // a branch
  assert.equal(out.progress.points, 1);                                                // two more
  assert.equal(out.pet.moves.length, 4);                                               // carried
  refused(() => shop(uid, "learn", { item: "parry" }), /Parry needs Tough Fur first/); // the other arm
  shop(uid, "learn", { item: "tough-fur" });                                           // learned
  for (const [item, why] of [["brawn", /Not enough skill points/], ["heavy-paw", /already knows/], ["apple", /isn't a skill/], ["constructor", /isn't a skill/]]) {
    refused(() => shop(uid, "learn", { item }), why);                                  // refused
  }
  assert.equal(B.points(makePet({ level: 50 })), 49);                                  // 49 at level 50
  assert.equal(B.points(makePet({ level: 50, skills: [...TREES.fighter, ...TREES.mage] })), 5); // two whole trees and change
});

test("passives and mods lift her numbers, and a respec hands points back for SGC", () => {
  const plain = B.stats(makePet({ level: 20 }));                                       // plain
  const built = B.stats(makePet({ level: 20, skills: TREES.fighter.slice(0, 6) }));    // with fighter passives
  assert.equal(built.attack, Math.floor(plain.attack * 1.10));                         // +10% attack
  assert.equal(built.defense, Math.floor(plain.defense * 1.10));                       // +10% defense
  assert.equal(built.hp, Math.floor(plain.hp * 1.12));                                 // +12% health
  const uid = player();                                                                // a player
  setPet(uid, { level: 20, skills: TREES.fighter.slice(0, 6), moves: ["heavy-paw"] }); // a fighter
  const out = shop(uid, "respec");                                                     // hand them back
  assert.equal(out.said.paid, price("respec", 100));                                   // charged in SGC
  assert.deepEqual(out.pet.skills, []);                                                // trees afresh
  assert.deepEqual(out.pet.moves, ["pounce", "glow-spark"]);                           // the basics
  assert.equal(out.progress.points, 19);                                               // all back
  refused(() => shop(uid, "respec"), /no skill points to hand back/);                  // nothing left
});

test("she carries up to four moves and at least one", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 30, skills: TREES.fighter, moves: ["pounce"] });                // one move
  refused(() => shop(uid, "equip", { item: "pounce" }), /at least one/);              // never empty-pawed
  for (const move of ["heavy-paw", "armor-break", "parry"]) shop(uid, "equip", { item: move }); // four now
  refused(() => shop(uid, "equip", { item: "whirl-claw" }), /Take one off/);           // full
  assert.deepEqual(shop(uid, "equip", { item: "pounce" }).pet.moves, ["heavy-paw", "armor-break", "parry"]); // put away
  refused(() => shop(uid, "equip", { item: "starfall" }), /hasn't learned/);           // not hers
});

test("mod slots open by level, take their own kind, and a mod is bought once", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 12 });                                                          // level 12
  const slots = B.summary(petOf(uid)).slots;                                           // her slots
  assert.deepEqual(slots.map((s) => s.open), [true, false, false, false, false]);      // one open
  refused(() => shop(uid, "mod", { item: "aether-coil", slot: 1 }), /opens at level 15/); // shut
  refused(() => shop(uid, "mod", { item: "aether-coil", slot: 0 }), /takes a cybertek mod/); // wrong kind
  const servo = B._MODS["servo-claws"].price;                                          // its native price
  const bought = shop(uid, "mod", { item: "servo-claws", slot: 0 });                   // buy and fit
  assert.equal(bought.said.paid, price("servo-claws", servo));                         // charged by its own key
  assert.equal(bought.coins, 1000 - price("servo-claws", servo));                      // out of her purse
  assert.equal(bought.progress.stats.attack, Math.floor(B.baseStats(12).attack * 1.06)); // +6% attack
  setPet(uid, { level: 30 });                                                          // more slots
  const moved = shop(uid, "mod", { item: "servo-claws", slot: 2 });                    // hers already: moving is free
  assert.equal(moved.said, null);                                                      // nothing bought
  assert.equal(moved.coins, 1000 - price("servo-claws", servo));                       // nothing charged
  assert.deepEqual(moved.pet.mods, [null, null, "servo-claws", null, null]);           // one mod, one slot
  assert.deepEqual(shop(uid, "mod", { item: null, slot: 2 }).pet.mods, [null, null, null, null, null]); // taken out
  refused(() => shop(uid, "mod", { item: "servo-claws", slot: 7 }), /Choose a mod slot/); // no such slot
  refused(() => shop(uid, "mod", { item: "glitch-fang", slot: 0 }), /dungeon vaults/); // a dungeon-only mod
});

test("five mods are worth about what the plan budgeted", () => {
  const fitted = makePet({ level: 50, mods: ["servo-claws", "aether-coil", "nano-plating", "ward-lattice", "neural-whiskers"] }); // all five
  assert.equal(B.stats(fitted).hp, Math.floor(B.baseStats(50).hp * 1.15));             // +15% health
  assert.equal(B.bonuses(fitted).attack, 6);                                           // +6% attack
  assert.equal(B.bonuses(fitted).crit, 6);                                             // +6% crit
  assert.equal(B.bonuses(makePet({ level: 9, mods: ["servo-claws"] })).attack, 0);     // a shut slot gives nothing
});

test("every enemy can be fought to a finish at every tenth level", () => {
  const rng = Seeded(4);                                                               // seeded dice
  for (const enemy of B.CATALOG.enemies) {
    for (const level of [1, 10, 20, 30, 40, 50]) {
      const state = fightOf(makePet({ level, glow: rng.choice(Object.keys(B.GLOW_ELEMENT)) }), enemy.id, level); // a fight
      let turns = 0;                                                                   // count turns
      while (!state.outcome && turns < 200) { B.resolve(state, rng.choice(["move0", "move1", "defend"]), rng); turns += 1; } // play it out
      assert.ok(["victory", "defeat"].includes(state.outcome), `${enemy.id} ${level}`);  // it ended
      assert.ok(state.log.length <= 8);                                                // the log stays short
      assert.equal(Math.min(state.player.hp, state.enemy.hp), 0);                      // someone is down
    }
  }
});

test("every tree branches in its own shape and old builds still stand", () => {
  const shapes = new Set();                                                            // tree shapes
  for (const tree of B.CATALOG.trees) {
    const nodes = tree.nodes;                                                          // its skills
    assert.deepEqual(nodes[0].needs, []);                                              // one root
    assert.ok(nodes.slice(1).every((n) => n.needs.length));                            // the rest need something
    const seen = new Set();                                                            // earlier skills
    for (const node of nodes) { assert.ok(node.needs.every((need) => seen.has(need))); seen.add(node.id); } // no loops
    assert.ok(nodes.some((n) => n.needs.length > 1) || ["thief", "monk"].includes(tree.id)); // most trees join
    assert.equal(new Set(nodes.map((n) => n.at.join(","))).size, 8);                   // eight places
    assert.ok(nodes.some((n) => nodes.filter((o) => o.needs.includes(n.id)).length > 1), tree.id); // every tree forks
    shapes.add(JSON.stringify(nodes.map((n) => [n.needs.map((need) => nodes.findIndex((o) => o.id === need)), ...n.at]))); // its shape
  }
  assert.equal(shapes.size, 6);                                                        // no two alike
  const uid = player();                                                                // a player
  for (const tree of B.CATALOG.trees) {                                                // a tree top to bottom is still a build
    setPet(uid, { level: 50, skills: [], moves: ["pounce"] });                         // a fresh build
    for (const node of tree.nodes) shop(uid, "learn", { item: node.id });              // learn it all
  }
  const cheap = ["ember", "frost-shard", "gust", "shadow-bolt", "spirit-lance", "starfall"]; // the Mage's last spell without the middle
  setPet(uid, { level: 50, skills: [], moves: ["pounce"] });                           // afresh
  for (const item of cheap) shop(uid, "learn", { item });                              // learnable
  assert.equal(B.spent(makePet({ level: 50, skills: cheap })), 22 - 2 - 3);            // Deep Mind and Mana Well left
  for (const change of [(d) => { d.trees[0].nodes[1].needs = ["comet-cleave"]; }, (d) => { d.trees[0].nodes[1].needs = []; }, // a later skill; a second root
    (d) => { d.trees[0].nodes[1].at = [1, 0]; }, (d) => { d.trees[0].nodes[1].at = [3, 9]; }, (d) => { d.trees[0].nodes[1].at = [0, 0]; }]) { // a taken place; off the grid; beside
    const data = clone(B.CATALOG);                                                     // a copy
    change(data);                                                                      // break it
    assert.throws(() => B.loadCatalog(data), /Lumi Pet's battles/);                    // refused
  }
});

// ------------------------------------------------------------------ LumiBot: SGC details
test("the Outfitters charge every unit at its own key, and an admin override is exact", () => {
  const uid = player();                                                                // a player
  env.tuning.setGame("battle", "priceOverrides", { potion: 7, "x-speed": 3 }, "test"); // admin prices
  try {
    assert.equal(shop(uid, "potions", { count: 2 }).said.paid, 14);                    // 2 x 7
    assert.equal(shop(uid, "kit", { item: "x-speed", count: 3 }).said.paid, 9);        // 3 x 3
    assert.equal(shop(uid, "kit", { item: "ether", count: 1 }).said.paid, price("ether", 25)); // the default for others
    assert.equal(coins(uid), 1000 - 14 - 9 - price("ether", 25));                      // charged
    const types = env.eco.getEconomyDb().prepare("SELECT DISTINCT type, to_user_id FROM transactions WHERE from_user_id = ?").all(uid); // where it went
    assert.deepEqual(types.map((r) => ({ ...r })), [{ type: "lumi_battle_shop", to_user_id: OUTFITTERS }]); // Dungeon Outfitters
  } finally {
    env.tuning.setGame("battle", "priceOverrides", null, "test");                      // back to normal
  }
});

test("not enough SGC refuses with 402 and changes nothing", () => {
  const uid = player(3);                                                               // nearly broke
  setPet(uid, { potions: 0 });                                                         // she has a Lumi already
  const error = refused(() => shop(uid, "potions", { count: 2 }), /Not enough SGC/);   // two potions cost more
  assert.equal(error.status, 402);                                                     // payment required
  assert.equal(error.code, "not_enough_sgc");                                          // the code
  assert.equal(coins(uid), 3);                                                         // untouched
  assert.equal(petOf(uid).potions, 0);                                                 // none given
});

test("a closed bank owes a battle prize and says so", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 30 });                                                          // strong enough
  env.tuning.set("lumi.treasury.payoutsPaused", "true", "test");                       // admin pause
  try {
    let fight = startFight(uid, "common", Script([], 0.5, 2));                         // a fight
    while (fight.status === "active") fight = turn(uid, fight, "move0", Script([], 0.01)); // win it
    assert.equal(fight.reward.coins, 0);                                               // nothing paid now
    assert.ok(fight.reward.owed > 0);                                                  // but owed
    assert.match(fight.log.at(-1), /Lumi-Town Bank is closed for a moment, your prize is saved\./); // said so
    assert.equal(coins(uid), 1000);                                                    // purse unchanged
  } finally {
    env.tuning.set("lumi.treasury.payoutsPaused", "false", "test");                    // reopen
  }
});

test("a save from before stat points gets them placed by Auto, with a free reset (save.js hook)", () => {
  const uid = player();                                                                // a player
  setPet(uid, { level: 10 });                                                          // level 10
  const raw = petOf(uid);                                                              // her save
  delete raw.stat_points;                                                              // from before points
  tx(() => save.save(uid, raw));                                                       // stored like that
  const pet = tx(() => save.load(uid, { now: T0 }));                                   // loaded: migrated
  assert.equal(B.statPointsLeft(pet), 0);                                              // all placed
  assert.equal(pet.stat_reset_free, 1);                                                // one free reset
  const reset = shop(uid, "stats_reset");                                              // use it
  assert.deepEqual(reset.said, { bought: "stats_reset", count: 1, paid: 0 });          // free
  shop(uid, "stats_auto");                                                             // place them again
  assert.equal(shop(uid, "stats_reset").said.paid, price("reset", 100));               // the next one costs SGC
});
