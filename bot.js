#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const fs = require("node:fs");
const http = require("node:http");
const fsPath = require("node:path");
const World = require("./world.js");

if (typeof WebSocket !== "function") {
  console.error("Node.js 22 or newer is required (global WebSocket is missing).");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const cfg = {
  url: value(args.url, process.env.EV_WS_URL, "wss://ember-vale.onrender.com/ws"),
  user: value(args.user, process.env.EV_USER, ""),
  password: value(args.password, process.env.EV_PASSWORD, ""),
  token: value(args.token, process.env.EV_TOKEN, ""),
  register: bool(args.register),
  cls: value(args.class, process.env.EV_CLASS, "knight"),
  color: value(args.color, process.env.EV_COLOR, World.COLORS[0]),
  potAt: numberIn(value(args["pot-at"], process.env.EV_POT_AT, 0.45), 0.05, 0.95, "--pot-at"),
  levelGap: numberIn(value(args["level-gap"], process.env.EV_LEVEL_GAP, 4), 0, 30, "--level-gap"),
  targets: csv(value(args.targets, process.env.EV_TARGETS, "")),
  trash: csv(value(args.trash, process.env.EV_TRASH, "")).map(parseRarity),
  sell: csv(value(args.sell, process.env.EV_SELL, "")).map(parseRarity),
  keepRarity: value(args["keep-rarity"], process.env.EV_KEEP_RARITY, ""),
  useSkills: !bool(args["no-skills"]),
  autoEquip: !bool(args["no-auto-equip"]),
  autoSpend: bool(args["auto-spend"]) || bool(args["auto-build"]),
  autoBuild: bool(args["auto-build"]),
  autoRepair: !bool(args["no-auto-repair"]),
  discardOtherClass: bool(args["discard-other-class"]),
  zones: String(value(args.zones, process.env.EV_ZONES, "auto")).toLowerCase(),
  minPots: numberIn(value(args["min-pots"], process.env.EV_MIN_POTS, 3), 0, 999, "--min-pots"),
  buyPots: numberIn(value(args["buy-pots"], process.env.EV_BUY_POTS, 20), 0, 999, "--buy-pots"),
  minScrolls: numberIn(value(args["min-scrolls"], process.env.EV_MIN_SCROLLS, 1), 0, 99, "--min-scrolls"),
  buyScrolls: numberIn(value(args["buy-scrolls"], process.env.EV_BUY_SCROLLS, 3), 0, 99, "--buy-scrolls"),
  reserveGold: numberIn(value(args["reserve-gold"], process.env.EV_RESERVE_GOLD, 100), 0, 1e12, "--reserve-gold"),
  fleeAt: numberIn(value(args["flee-at"], process.env.EV_FLEE_AT, 0.18), 0.01, 0.8, "--flee-at"),
  dashboardPort: numberIn(value(args["dashboard-port"], process.env.EV_DASHBOARD_PORT, 3210), 1, 65535, "--dashboard-port"),
  dashboard: !bool(args["no-dashboard"]),
  webhook: value(args.webhook, process.env.EV_WEBHOOK_URL, ""),
  expeditionOnExit: bool(args["expedition-on-exit"]),
  xpRush: bool(args["xp-rush"]),
  verbose: bool(args.verbose),
};

if (!World.CLASS_IDS.includes(cfg.cls)) fail(`Unknown class: ${cfg.cls}. Use one of: ${World.CLASS_IDS.join(", ")}`);
if (!World.COLORS.includes(cfg.color)) fail(`Unknown colour: ${cfg.color}. Use one of: ${World.COLORS.join(", ")}`);
for (const type of cfg.targets) if (!World.MOB[type]) fail(`Unknown target monster id: ${type}`);
cfg.trash = [...new Set(cfg.trash)].filter(r => r <= 2);
cfg.sell = [...new Set(cfg.sell)];
if (cfg.keepRarity) {
  const keep = parseRarity(cfg.keepRarity);
  cfg.trash = [0, 1, 2].filter(r => r < keep);
}
if (cfg.xpRush) {
  cfg.autoEquip = true;
  cfg.autoSpend = true;
  cfg.autoBuild = true;
  cfg.useSkills = true;
  cfg.zones = "auto";
  cfg.potAt = Math.max(cfg.potAt, 0.5);
  cfg.fleeAt = Math.max(cfg.fleeAt, 0.2);
  cfg.minPots = Math.max(cfg.minPots, 10);
  cfg.buyPots = Math.max(cfg.buyPots, 80);
  if (args.trash == null && args["keep-rarity"] == null && !process.env.EV_TRASH && !process.env.EV_KEEP_RARITY) cfg.trash = [0, 1];
  if (args.sell == null && !process.env.EV_SELL) cfg.sell = [0, 1];
}
if (cfg.zones !== "auto" && cfg.zones !== "stay" && !/^\d+$/.test(cfg.zones)) fail("--zones must be auto, stay, or a map id");

const me = {
  inGame: false, dead: false, name: "", cls: cfg.cls, lv: 1,
  x: World.SPAWN.x, y: World.SPAWN.y, hp: 1, mh: 1, sp: 0, msp: 1,
  pot: 0, range: 1.5, points: 0, talents: { _bar: [] },
  cd: { basic: 600, s: {} }, buffs: [], map: 0, tp: 0, zones: 0,
  scrolls: 0, supplies: {}, cost: { pot: 12 }, gold: 0,
};

// Damage-first progression. Repeated entries create useful breakpoints before a skill is maxed.
// canLearn() still enforces hero-level and prerequisite requirements from world.js.
const XP_BUILD = {
  knight: [["cleave", 5], ["steeloath", 5], ["flamearc", 5], ["cleave", 10], ["steeloath", 10], ["fervor", 5], ["shieldrush", 10], ["flamearc", 10], ["fervor", 10], ["sunder", 10], ["bulwark", 10], ["warcry", 5], ["reckoning", 10], ["ironhide", 10], ["roar", 3], ["bastion", 5]],
  wizard: [["emberdart", 4], ["arcanestudy", 5], ["arclightning", 5], ["emberdart", 10], ["thunderhead", 5], ["arcanestudy", 10], ["flamewell", 5], ["arclightning", 10], ["thunderhead", 10], ["flamewell", 10], ["frostshard", 5], ["whiteout", 10], ["chainspark", 10], ["leyattune", 10], ["gravitywell", 10], ["starfall", 10], ["manaspring", 10], ["frostshard", 10]],
  hunter: [["twinshot", 5], ["hail", 5], ["keeneye", 5], ["twinshot", 10], ["longsight", 5], ["focus", 5], ["hail", 10], ["keeneye", 10], ["hawkdive", 10], ["piercing", 10], ["scattershot", 10], ["instinct", 10], ["blasttrap", 10], ["cometarrow", 10], ["longsight", 10], ["focus", 10]],
  priest: [["smite", 5], ["macetraining", 5], ["smite", 10], ["sacredward", 5], ["benediction", 3], ["mend", 5], ["macetraining", 10], ["hallowed", 5], ["dawnbreak", 10], ["judgement", 10], ["benediction", 10], ["serenity", 10], ["renewal", 10], ["choir", 10], ["mend", 10], ["sacredward", 10]],
  assassin: [["venomstrike", 5], ["twinblades", 5], ["thousandcuts", 5], ["venomstrike", 10], ["twinblades", 10], ["toxicedge", 5], ["thousandcuts", 10], ["shadowspikes", 10], ["plagueseed", 10], ["shadowstep", 10], ["killerinstinct", 10], ["deathlotus", 10], ["flurry", 10], ["toxicedge", 10]],
  blacksmith: [["coinsmash", 5], ["forgecraft", 5], ["coinsmash", 10], ["cartsweep", 5], ["quakehammer", 5], ["forgecraft", 10], ["wardrums", 3], ["temperededge", 5], ["overdrive", 10], ["goldrush", 10], ["cartsweep", 10], ["moltenstrike", 10], ["anvildrop", 10], ["hardhide", 10]],
};

let ws = null;
let peerId = -1;
let map = null;
let mobs = [];
let target = null;
let path = [];
let routeGoal = null;
let replanAt = 0;
let attackReadyAt = 0;
let potionReadyAt = 0;
let castUntil = 0;
let skillReady = Object.create(null);
let actionCounter = 0;
let lastState = "";
let lastStateAt = 0;
let lastTickAt = Date.now();
let lastThinkAt = 0;
let lastStatusAt = 0;
let retry = 0;
let stopped = false;
let authed = false;
let haveMe = false;
let haveBag = false;
let bagCount = 0;
let bagLimit = 24;
let bag = [];
let stash = [];
let stashLimit = 60;
let task = null;
let desiredMap = null;
let forceTown = false;
let townReason = "";
let refillTarget = 0;
let bagServiceTarget = -1;
let lastTownActionAt = 0;
let pendingEquip = null;
let pendingBuild = null;
let pendingExpedition = false;
const pendingDiscard = new Set();
let shutdownTimer = null;
let dashboardServer = null;
let eventSeq = 0;
const recentEvents = [];
const session = {
  startedAt: new Date().toISOString(), kills: 0, deaths: 0, xp: 0, gold: 0,
  loot: [0, 0, 0, 0], cards: 0, zones: 0, disconnects: 0, potionsUsed: 0,
};
const potionUseTimes = [];
const runtime = { paused: false, mode: "starting" };
let logDir = "";
let eventLogFile = "";
let summaryWritten = false;
const skipped = new Map();

if (bool(args["self-test"])) {
  runSelfTests();
} else {
  main().catch(err => fail(err && err.stack ? err.stack : String(err)));
}

async function main() {
  if (!cfg.token) {
    if (!cfg.user) cfg.user = await prompt("Hero name: ");
    if (!cfg.password) cfg.password = await promptSecret(cfg.register ? "New password: " : "Password: ");
  }
  if (!cfg.token && (!cfg.user || !cfg.password)) fail("A token, or hero name and password, is required.");

  console.log(`[bot] Ember Vale auto-hunt -> ${cfg.url}`);
  console.log(`[bot] ${cfg.token ? "resuming with EV_TOKEN" : cfg.register ? `registering ${cfg.user} (${cfg.cls})` : `signing in as ${cfg.user}`}`);
  if (cfg.targets.length) console.log(`[bot] targets: ${cfg.targets.map(t => World.MOB[t].name).join(", ")}`);
  if (cfg.xpRush) console.log("[bot] XP Rush: maximum XP/hour mode enabled");
  if (cfg.trash.length) console.log(`[bot] leaving rarity drops on ground: ${cfg.trash.join(", ")}`);
  if (cfg.sell.length) console.log(`[bot] selling rarity levels in town: ${cfg.sell.join(", ")}`);

  initLogs();
  if (cfg.dashboard) startDashboard();
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  setInterval(tick, 50).unref();
  connect();
}

function connect() {
  if (stopped) return;
  console.log(`[net] ${retry ? "reconnecting" : "connecting"}...`);
  try {
    ws = new WebSocket(cfg.url);
  } catch (err) {
    console.error(`[net] connect failed: ${err.message}`);
    return scheduleReconnect();
  }

  ws.addEventListener("open", () => {
    retry = 0;
    haveMe = false;
    haveBag = false;
    console.log("[net] connected");
    if (cfg.token) send({ t: "resume", token: cfg.token });
    else if (cfg.register) send({ t: "register", u: cfg.user, p: cfg.password, c: cfg.color, cls: cfg.cls });
    else send({ t: "login", u: cfg.user, p: cfg.password });
  });
  ws.addEventListener("message", event => {
    try { onMessage(JSON.parse(String(event.data))); }
    catch (err) { if (cfg.verbose) console.error(`[net] bad message: ${err.message}`); }
  });
  ws.addEventListener("error", event => {
    if (cfg.verbose) console.error("[net] WebSocket error", event.error || "");
  });
  ws.addEventListener("close", event => {
    if (authed) {
      session.disconnects += 1;
      notify("disconnect", `Connection closed (${event.code})`, true);
    }
    authed = false;
    me.inGame = false;
    haveMe = false;
    haveBag = false;
    peerId = -1;
    console.log(`[net] closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
    if (!stopped) scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (stopped) return;
  retry += 1;
  setTimeout(connect, Math.min(10_000, 800 * retry));
}

function requestShutdown(reason) {
  if (stopped) return;
  if (cfg.expeditionOnExit && authed && me.inGame && !me.dead && !pendingExpedition) {
    pendingExpedition = true;
    runtime.paused = true;
    runtime.mode = "planning expedition";
    console.log("\n[bot] planning expedition before exit...");
    send({ t: "expPlan" });
    shutdownTimer = setTimeout(() => shutdown(`${reason}: expedition timeout`), 7000);
    return;
  }
  shutdown(reason);
}

function shutdown(reason = "stopped") {
  if (stopped) return;
  stopped = true;
  console.log(`\n[bot] stopping (${reason})`);
  if (shutdownTimer) clearTimeout(shutdownTimer);
  try { send({ t: "autoTrash", on: false, r: cfg.trash }); } catch {}
  try { ws && ws.close(1000, "bot stopped"); } catch {}
  writeSessionSummary(reason);
  try { dashboardServer && dashboardServer.close(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
}

function onMessage(d) {
  if (!d || typeof d !== "object") return;
  if (cfg.verbose && !["snap", "mf", "me"].includes(d.t)) console.log("[recv]", JSON.stringify(d));

  switch (d.t) {
    case "welcome":
      peerId = d.id | 0;
      break;
    case "full":
      console.error("[net] server is full; retrying later");
      notify("server", "Server is full", true);
      break;
    case "auth_ok":
      authed = true;
      me.inGame = true;
      me.name = String(d.name || cfg.user || "hero");
      if (d.token) cfg.token = String(d.token);
      cfg.password = "";
      console.log(`[auth] signed in as ${me.name}`);
      send({ t: "autoTrash", on: true, r: cfg.trash });
      notify("auth", `Signed in as ${me.name}`);
      break;
    case "auth_err":
      console.error(`[auth] ${d.m || "authentication failed"}`);
      process.exitCode = 2;
      shutdown("authentication failed");
      break;
    case "kicked":
      console.error(`[auth] kicked: ${d.m || "session ended"}`);
      notify("kicked", d.m || "Session ended", true);
      process.exitCode = 3;
      shutdown("kicked");
      break;
    case "me":
      applyMe(d.s || {});
      break;
    case "map":
      loadMap(d.id | 0, +d.x, +d.y);
      send({ t: "view", w: 32, h: 24 });
      break;
    case "pos":
      if (Number.isFinite(+d.x) && Number.isFinite(+d.y)) {
        me.x = +d.x; me.y = +d.y; path = []; routeGoal = null;
      }
      break;
    case "mf":
      applyFast(d.v);
      break;
    case "snap":
      applySnapshot(d);
      break;
    case "kill": {
      const i = d.i | 0;
      if (mobs[i]) { mobs[i].dead = true; mobs[i].hp = 0; }
      if (Array.isArray(d.by) && d.by.includes(peerId)) session.kills += 1;
      if (target === i) clearTarget();
      break;
    }
    case "dmg":
      if (d.ev) {
        const i = d.i | 0;
        skipped.set(i, Date.now() + 10_000);
        if (target === i) clearTarget();
      }
      break;
    case "skillfail":
      if (d.s === "basic") attackReadyAt = 0;
      else if (d.s) skillReady[String(d.s)] = 0;
      castUntil = 0;
      if (cfg.verbose) console.log(`[skill] ${d.m || "failed"}`);
      break;
    case "potWait":
      potionReadyAt = Date.now() + Math.max(0, +d.left || 0);
      break;
    case "bag":
      bag = Array.isArray(d.items) ? d.items : [];
      bagCount = bag.filter(x => !x.eq).length;
      bagLimit = d.limit | 0 || 24;
      stash = Array.isArray(d.stash) ? d.stash : [];
      stashLimit = d.stashLimit | 0 || 60;
      haveBag = true;
      if (haveMe) onBagUpdate();
      break;
    case "gain":
      console.log(`[gain] +${d.xp | 0} xp, +${d.gold | 0} gold${d.lv ? ` -> level ${d.lv | 0}` : ""}`);
      session.xp += d.xp | 0;
      session.gold += d.gold | 0;
      logEvent("gain", { xp: d.xp | 0, gold: d.gold | 0, level: d.lv | 0 });
      break;
    case "loot": {
      const item = d.item || {};
      const rarity = Math.max(0, Math.min(3, item.rarity | 0));
      session.loot[rarity] += 1;
      if (d.card || item.slot === "card") session.cards += 1;
      logEvent("loot", { name: item.name || "item", rarity, card: !!d.card, trashed: !!d.trashed });
      if (rarity >= 3 || d.card) notify("loot", `${d.card ? "Card" : "Epic"}: ${item.name || "item"}`, true);
      else if (cfg.verbose) console.log(`[loot] ${d.trashed ? "left " : "got "}${item.name || "item"}`);
      break;
    }
    case "died":
      console.log(`[combat] defeated by ${d.by || "a monster"}${d.lost ? `; lost ${d.lost | 0} gold` : ""}`);
      session.deaths += 1;
      notify("death", `Defeated by ${d.by || "a monster"}`, true);
      logEvent("death", { by: d.by || "monster", lost: d.lost | 0 });
      break;
    case "note":
      if (cfg.verbose) console.log(`[note] ${d.m || ""}`);
      break;
    case "sold":
      logEvent("sold", { name: d.name || "item", gold: d.gold | 0 });
      break;
    case "bought":
      logEvent("bought", { item: d.item || "item" });
      break;
    case "expPlan":
      if (pendingExpedition) startBestExpedition(d);
      break;
    case "expGone":
      notify("expedition", `Expedition started: ${d.name || "zone"}`, true);
      shutdown("expedition started");
      break;
    case "expReport":
      notify("expedition", "Expedition report received", true);
      logEvent("expedition-report", d.r || {});
      break;
  }
}

function applyMe(s) {
  const wasDead = me.dead;
  me.name = String(s.n || me.name);
  me.cls = World.CLASSES[s.cls] ? s.cls : me.cls;
  for (const k of ["lv", "hp", "mh", "sp", "msp", "pot", "range", "points", "gold", "atk", "def", "tp", "zones", "scrolls", "warps"]) {
    if (Number.isFinite(+s[k])) me[k] = +s[k];
  }
  me.dead = !!s.dead;
  me.talents = s.talents && typeof s.talents === "object" ? s.talents : me.talents;
  if (!Array.isArray(me.talents._bar)) me.talents._bar = [];
  if (s.cd && typeof s.cd === "object") {
    me.cd = {
      basic: +s.cd.basic || 600,
      s: s.cd.s && typeof s.cd.s === "object" ? s.cd.s : {},
    };
  }
  me.buffs = Array.isArray(s.buffs) ? s.buffs : [];
  me.supplies = s.supplies && typeof s.supplies === "object" ? s.supplies : me.supplies;
  if (s.cost && typeof s.cost === "object") me.cost = { ...me.cost, ...s.cost };
  me.potCdMs = +s.potCd || me.potCdMs || 3000;
  haveMe = true;
  if (me.dead && !wasDead) clearTarget();
  if (!me.dead && wasDead) console.log("[combat] revived; resuming auto-hunt");
  if (haveBag) onBagUpdate();
  manageBuild();
}

function applyFast(raw) {
  const v = String(raw || "").split(",").map(Number);
  if (v.length >= 7 && v.every(Number.isFinite)) {
    [me.hp, me.mh, me.sp, me.msp, me.xp, me.gold, me.pot] = v;
  }
}

function loadMap(id, x, y) {
  map = World.MAPS[id] || World.MAPS[0];
  me.map = map.id;
  if (Number.isFinite(x)) me.x = x;
  if (Number.isFinite(y)) me.y = y;
  mobs = map.spawns.map(spawn => ({
    id: spawn.id,
    type: spawn.type,
    x: spawn.sx,
    y: spawn.sy,
    hp: spawn.slot ? 0 : World.MOB[spawn.type].hp,
    dead: !!spawn.slot,
    eff: 0,
  }));
  clearTarget();
  lastState = "";
  task = null;
  session.zones += 1;
  logEvent("map", { id: map.id, name: map.def.name });
  console.log(`[map] ${map.def.name} (${map.def.lv}) at ${me.x.toFixed(1)}, ${me.y.toFixed(1)}`);
}

function applySnapshot(d) {
  if (!map || d.map !== map.id || !Array.isArray(d.m)) return;
  if (d.mf) applyFast(d.mf);

  if (d.v === 2) {
    for (const row of d.m) {
      if (!Array.isArray(row)) continue;
      const mob = mobs[row[0] | 0];
      if (!mob) continue;
      const x = +row[1] / 10, y = +row[2] / 10, hp = +row[3];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(hp)) continue;
      mob.x = x; mob.y = y; mob.hp = Math.max(0, hp); mob.dead = hp <= 0; mob.tg = row[4] || null; mob.eff = row[5] | 0;
      if (Number.isFinite(+row[6])) mob.maxHp = +row[6];
    }
  } else if (d.m.length === mobs.length) {
    d.m.forEach((row, i) => {
      if (!Array.isArray(row) || !mobs[i]) return;
      const x = +row[0] / 10, y = +row[1] / 10, hp = +row[2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(hp)) return;
      Object.assign(mobs[i], { x, y, hp: Math.max(0, hp), dead: hp <= 0, tg: row[3] || null, eff: row[4] | 0 });
      if (Number.isFinite(+row[5])) mobs[i].maxHp = +row[5];
    });
  }
  if (target != null && (!mobs[target] || mobs[target].dead)) clearTarget();
}

function tick() {
  const now = Date.now();
  const dt = Math.min(0.2, Math.max(0, (now - lastTickAt) / 1000));
  lastTickAt = now;
  if (!authed || !me.inGame || !map || me.dead || !isOpen()) return;
  if (!haveMe || !haveBag) {
    runtime.mode = "syncing hero data";
    return;
  }

  if (runtime.paused) {
    runtime.mode = "paused";
    pushState(false);
    return;
  }

  for (const [id, until] of skipped) if (until <= now) skipped.delete(id);

  if (me.hp < me.mh * cfg.potAt && me.pot > 0 && now >= potionReadyAt) {
    potionReadyAt = now + (me.potCdMs || 3000);
    session.potionsUsed += 1;
    potionUseTimes.push(now);
    send({ t: "pot" });
  }

  if (me.hp <= me.mh * cfg.fleeAt) {
    runtime.mode = "fleeing";
    clearTarget();
    const clear = flee(now, dt);
    if (clear && forceTown) {
      if (map.id !== 0) returnToTown(now, dt);
      else handleTown(now, dt);
    }
    pushState(false);
    return;
  }

  if (needsTown()) {
    clearTarget();
    if (map.id !== 0) returnToTown(now, dt);
    else handleTown(now, dt);
    pushState(false);
    return;
  }

  desiredMap = chooseHuntMap();
  if (desiredMap != null && desiredMap !== map.id) {
    runtime.mode = `travelling to ${World.MAPS[desiredMap].def.name}`;
    clearTarget();
    travelToMap(desiredMap, now, dt);
    pushState(false);
    return;
  }

  runtime.mode = "hunting";

  if (now - lastThinkAt >= 250) {
    lastThinkAt = now;
    think(now);
  }

  if (target != null && mobs[target] && !mobs[target].dead) {
    const mob = mobs[target];
    if (inRange(mob, Math.max(1.6, me.range))) {
      path = [];
      routeGoal = null;
      fight(mob, now);
    } else {
      moveToward(mob, now, dt);
    }
  }

  pushState(false);
  if (now - lastStatusAt > 20_000) {
    lastStatusAt = now;
    const t = target != null && mobs[target] ? World.MOB[mobs[target].type].name : "none";
    console.log(`[status] Lv${me.lv} HP ${Math.round(me.hp)}/${Math.round(me.mh)} SP ${Math.round(me.sp)}/${Math.round(me.msp)} · target ${t}`);
  }
}

function think(now) {
  if (target != null && isWorth(mobs[target])) return;
  clearTarget();
  let best = null;
  let bestScore = -Infinity;
  for (const mob of mobs) {
    if (!isWorth(mob) || skipped.has(mob.id)) continue;
    const distance = Math.hypot(mob.x - me.x, mob.y - me.y);
    const spec = World.MOB[mob.type];
    const hp = Math.max(1, mob.hp || mob.maxHp || spec.hp || 1);
    const efficiency = farmEfficiency(spec, hp, distance);
    const attackingMe = mob.tg === peerId ? efficiency * 1.5 + 1 : 0;
    const elitePenalty = (mob.eff & 16) ? 0.55 : 1;
    const score = (efficiency + attackingMe) * elitePenalty;
    if (score > bestScore) { best = mob; bestScore = score; }
  }
  if (best) target = best.id;
}

function needsTown() {
  if (forceTown) return true;
  if (map && map.id === 0 && townReason) return true;
  if (bag.some(it => it.eq && it.broken)) {
    townReason = "broken equipment";
    return true;
  }
  if (me.pot <= cfg.minPots && cfg.buyPots > me.pot) {
    refillTarget = Math.max(refillTarget, cfg.buyPots);
    townReason = "low potions";
    return true;
  }
  if (map && map.id === 0 && (me.scrolls | 0) < cfg.minScrolls && cfg.buyScrolls > (me.scrolls | 0)) {
    townReason = "low return scrolls";
    return true;
  }
  if (bagCount >= bagLimit) {
    bagServiceTarget = Math.max(0, bagLimit - Math.max(4, Math.ceil(bagLimit * 0.25)));
    townReason = "bag full";
    return true;
  }
  return false;
}

function returnToTown(now, dt) {
  runtime.mode = `returning to town: ${townReason || "requested"}`;
  if (!task || task.kind !== "return-town") task = { kind: "return-town", since: now, scrollAt: 0 };
  if ((me.scrolls | 0) > 0 && !task.scrollAt) {
    task.scrollAt = now;
    send({ t: "scroll" });
    notify("town", `Returning to town: ${townReason || "requested"}`);
    return;
  }
  travelToMap(0, now, dt);
}

function handleTown(now, dt) {
  runtime.mode = `town: ${townReason || "supplies"}`;

  const broken = bag.filter(it => it.eq && it.broken);
  if (broken.length) {
    if (!cfg.autoRepair) return pauseForUser("Broken equipment needs repair");
    if (!moveToNpc(World.NPC, "forge", now, dt)) return;
    const item = broken.find(it => me.gold - (+it.repair || Infinity) >= cfg.reserveGold);
    if (!item) return pauseForUser("Not enough spare gold to repair equipped gear");
    if (now - lastTownActionAt > 1200) {
      lastTownActionAt = now;
      send({ t: "repair", id: item.id });
      notify("repair", `Repairing ${item.name || "equipment"}`);
    }
    return;
  }

  if (bagServiceTarget >= 0 && bagCount > bagServiceTarget) {
    const sellable = townSellables();
    if (sellable.length) {
      if (!moveToNpc(World.TRADER, "trader", now, dt)) return;
      if (now - lastTownActionAt > 700) {
        lastTownActionAt = now;
        send({ t: "sellMany", ids: sellable.map(it => it.id) });
        notify("sell", `Selling ${sellable.length} safe item(s)`);
      }
      return;
    }
    const store = townStashables();
    if (store.length && stash.length < stashLimit) {
      if (!moveToNpc(World.VAULT, "storage", now, dt)) return;
      runtime.mode = `town: storing valuables · bag ${bagCount}/${bagLimit} · storage ${stash.length}/${stashLimit}`;
      if (now - lastTownActionAt > 450) {
        lastTownActionAt = now;
        send({ t: "stash", id: store[0].id });
        notify("stash", `Storing ${store[0].name || "valuable item"}`);
      }
      return;
    }
    return pauseForUser(`Bag ${bagCount}/${bagLimit} and storage ${stash.length}/${stashLimit}; no safe space remains`);
  }
  if (bagServiceTarget >= 0 && bagCount <= bagServiceTarget) bagServiceTarget = -1;

  if (refillTarget > me.pot) {
    const cost = Math.max(0, +me.cost.pot || 0);
    const affordable = cost ? Math.floor(Math.max(0, me.gold - cfg.reserveGold) / cost) : 0;
    const count = Math.min(refillTarget - me.pot, affordable);
    if (count <= 0) {
      refillTarget = 0;
      if (me.pot <= cfg.minPots) return pauseForUser("Not enough spare gold to buy potions");
    } else {
      if (!moveToNpc(World.APOTHECARY, "apothecary", now, dt)) return;
      if (now - lastTownActionAt > 400) {
        const batch = potionBatch(count);
        lastTownActionAt = now;
        send({ t: "buy", item: "pot", n: batch });
        runtime.mode = `town: refilling potions ${me.pot}/${refillTarget} (+${batch})`;
        notify("shop", `Buying ${batch} potion(s); ${me.pot}/${refillTarget}`);
      }
      return;
    }
  }
  if (refillTarget && me.pot >= refillTarget) refillTarget = 0;

  if ((me.scrolls | 0) < cfg.minScrolls && cfg.buyScrolls > (me.scrolls | 0)) {
    const cost = Math.max(0, +me.cost.scroll || 0);
    if (!cost || me.gold - cost < cfg.reserveGold) return pauseForUser("Not enough spare gold to buy a return scroll");
    if (!moveToNpc(World.TRADER, "trader", now, dt)) return;
    if (now - lastTownActionAt > 1200) {
      lastTownActionAt = now;
      send({ t: "buy", item: "scroll" });
      notify("shop", "Buying a return scroll");
    }
    return;
  }

  forceTown = false;
  townReason = "";
  task = null;
}

function potionBatch(remaining) {
  if (remaining >= 10) return 10;
  if (remaining >= 5) return 5;
  return 1;
}

function townSellables() {
  return bag.filter(it => {
    if (it.eq || it.slot === "card" || (it.cards && it.cards.length)) return false;
    if (!cfg.sell.includes(it.rarity | 0)) return false;
    if (wearable(it)) {
      const current = equippedIn(it.slot);
      if (!current || itemPower(it) > itemPower(current)) return false;
    }
    return true;
  });
}

function townStashables() {
  const sell = new Set(townSellables().map(it => it.id));
  return bag.filter(it => !it.eq && it.id !== pendingEquip && !sell.has(it.id)).sort((a, b) => stashPriority(b) - stashPriority(a));
}

function stashPriority(item) {
  return (item.slot === "card" ? 1_000_000 : 0) + ((item.cards && item.cards.length) ? 500_000 : 0) + (item.rarity | 0) * 100_000 + (!wearable(item) ? 10_000 : 0) + itemPower(item);
}

function moveToNpc(npc, label, now, dt) {
  if (!npc || map.id !== npc.map) return false;
  const range = World.NPC_RANGE || 3;
  if (Math.hypot(me.x - npc.x, me.y - npc.y) < range - 0.25) return true;
  runtime.mode = `town: walking to ${label}`;
  moveToPoint(npc, `npc:${label}`, now, dt, false);
  return false;
}

function pauseForUser(message) {
  if (!runtime.paused) notify("attention", message, true);
  runtime.paused = true;
  runtime.mode = "paused: needs attention";
}

function flee(now, dt) {
  if (!task || task.kind !== "flee") task = { kind: "flee", since: now };
  const fleeSince = task.since;
  let ax = 0, ay = 0, close = 0;
  for (const mob of mobs) {
    if (mob.dead) continue;
    const dx = me.x - mob.x, dy = me.y - mob.y, distance = Math.max(0.3, Math.hypot(dx, dy));
    if (distance > 10) continue;
    ax += dx / (distance * distance);
    ay += dy / (distance * distance);
    close += 1;
  }
  if (close) {
    const length = Math.hypot(ax, ay) || 1;
    const speed = 4.6 * (1 + swiftBuff()) * dt / length;
    World.step(map, me, ax * speed, ay * speed, 0.28, false);
  }
  if (now - task.since > 3500 && me.pot <= 0) {
    forceTown = true;
    townReason = "dangerously low HP and no potions";
  }
  if (me.hp > me.mh * Math.max(cfg.potAt, cfg.fleeAt + 0.12)) task = null;
  return close === 0 || now - fleeSince > 8000;
}

function chooseHuntMap() {
  if (cfg.zones === "stay") return map.id;
  if (/^\d+$/.test(cfg.zones)) {
    const id = Number(cfg.zones);
    return World.MAPS[id] ? id : map.id;
  }
  const effectiveLevel = combatLevel();
  let best = map.id, bestScore = -Infinity;
  for (const candidate of World.MAPS) {
    const rows = candidate.spawns.map(spawn => ({ type: spawn.type, spec: World.MOB[spawn.type] })).filter(row => row.spec && !row.spec.boss && !row.spec.mini && !row.spec.rare);
    if (!rows.length || Math.min(...rows.map(row => row.spec.lvl)) > effectiveLevel + 1) continue;
    const suitable = rows.filter(row => row.spec.lvl <= effectiveLevel + cfg.levelGap && (!cfg.targets.length || cfg.targets.includes(row.type))).map(row => row.spec);
    if (!suitable.length) continue;
    const densityDistance = Math.max(1.2, candidate.N / Math.sqrt(Math.max(1, suitable.length)) * 0.32);
    const rates = suitable.map(spec => farmEfficiency(spec, spec.hp, densityDistance)).sort((a, b) => b - a);
    const take = rates.slice(0, Math.min(6, rates.length));
    const score = take.reduce((sum, rate) => sum + rate, 0) / take.length * (1 + Math.min(0.3, suitable.length / 100));
    if (score > bestScore) { bestScore = score; best = candidate.id; }
  }
  return best;
}

function estimatedDps(spec) {
  const attack = Math.max(1, +me.atk || combatLevel() * 4);
  const basicCd = Math.max(200, +me.cd.basic || 600) / 1000;
  const hit = Math.max(attack * 0.3, attack - (+spec.def || 0) * 0.45);
  let dps = hit / basicCd;
  if (cfg.useSkills) {
    for (const id of hotbar()) {
      const skill = World.SKILLS[id], level = id ? World.skillLv(me.talents, id) : 0;
      if (!skill || !level || skill.kind !== "active" || !skill.mult) continue;
      let mult = Math.max(0, World.sv(skill.mult, level));
      if (skill.dot) mult += Math.max(0, World.sv(skill.dot.dps, level)) * ((+skill.dot.dur || 0) / 1000);
      if (skill.zone) mult *= Math.max(1, (+skill.zone.dur || 0) / Math.max(1, +skill.zone.tick || 1000));
      const cooldown = Math.max(400, +(me.cd.s[id] || skill.cd || 1000)) / 1000;
      dps += attack * mult / cooldown;
    }
  }
  return Math.max(1, dps);
}

function farmEfficiency(spec, hp, distance) {
  const dps = estimatedDps(spec);
  const ttk = Math.max(0.2, hp / dps);
  const travel = Math.max(0, distance) / (4.6 * (1 + swiftBuff()));
  const incomingHit = Math.max(1, (+spec.atk || 1) - (+me.def || 0) * 0.5);
  const incomingDps = incomingHit / Math.max(0.4, +spec.cd || 1) * 1.55; // nearby adds often join the fight
  const surviveFor = Math.max(1, (+me.mh || 1) / incomingDps);
  const dangerRatio = ttk / surviveFor;
  const pressure = potionRatePerMinute();
  const danger = 1 / (1 + Math.pow(dangerRatio * 1.8, 2) * (1 + pressure / 8));
  const levelPenalty = spec.lvl > combatLevel() + cfg.levelGap ? 0 : 1;
  return (+spec.xp || 1) / Math.max(0.25, ttk + travel) * danger * levelPenalty;
}

function potionRatePerMinute() {
  const now = Date.now(), windowMs = 5 * 60_000;
  while (potionUseTimes.length && potionUseTimes[0] < now - windowMs) potionUseTimes.shift();
  const elapsed = Math.max(1 / 6, Math.min(5, (now - new Date(session.startedAt).getTime()) / 60_000));
  return potionUseTimes.length / elapsed;
}

function combatLevel() {
  const slots = ["weapon", "head", "body", "cloak", "shoes", "acc"];
  const levels = slots.map(slot => {
    const item = bag.find(it => it.eq && it.slot === slot && !it.broken);
    return item ? Math.max(me.lv, item.ilvl | 0) : me.lv;
  }).sort((a, b) => a - b);
  return Math.max(me.lv, levels[2] || me.lv);
}

function travelToMap(destination, now, dt) {
  if (map.id === destination) { task = null; return true; }
  const route = mapRoute(map.id, destination);
  if (!route || route.length < 2) {
    pauseForUser(`No route from ${map.def.name} to map ${destination}`);
    return false;
  }
  const next = route[1];
  const portal = map.def.portals.find(p => p.to === next);
  if (!portal) return false;
  moveToPoint(portal, `portal:${map.id}:${next}`, now, dt, true);
  return false;
}

function mapRoute(from, to) {
  const seen = new Map([[from, null]]), queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === to) break;
    for (const portal of World.MAPS[id].def.portals) {
      if (seen.has(portal.to)) continue;
      seen.set(portal.to, id);
      queue.push(portal.to);
    }
  }
  if (!seen.has(to)) return null;
  const result = [];
  for (let at = to; at != null; at = seen.get(at)) result.push(at);
  return result.reverse();
}

function moveToPoint(point, key, now, dt, allowPortal) {
  if (routeGoal !== key || now >= replanAt || !path.length) {
    const route = findRoute(map, me, point, allowPortal ? point : null);
    routeGoal = key;
    replanAt = now + 2500;
    if (!route) return false;
    path = route;
  }
  while (path.length && Math.hypot(path[0].x - me.x, path[0].y - me.y) < 0.7) path.shift();
  const goal = path[0] || point;
  const dx = goal.x - me.x, dy = goal.y - me.y, length = Math.hypot(dx, dy);
  if (!length) return true;
  const speed = 4.6 * (1 + swiftBuff()) * dt / length;
  const beforeX = me.x, beforeY = me.y;
  World.step(map, me, dx * speed, dy * speed, 0.28, false);
  if (me.x === beforeX && me.y === beforeY) { path = []; replanAt = 0; }
  return Math.hypot(point.x - me.x, point.y - me.y) < 0.6;
}

function isWorth(mob) {
  if (!mob || mob.dead) return false;
  const spec = World.MOB[mob.type];
  if (!spec || spec.boss || spec.mini || spec.rare) return false;
  if (spec.lvl > combatLevel() + cfg.levelGap) return false;
  if (World.inTown(map, mob.x, mob.y)) return false;
  return !cfg.targets.length || cfg.targets.includes(mob.type);
}

function fight(mob, now) {
  if (cfg.useSkills && now >= castUntil) {
    for (const id of hotbar()) {
      const skill = World.SKILLS[id];
      const level = id ? World.skillLv(me.talents, id) : 0;
      if (!skill || !level || skill.cls !== me.cls || skill.kind !== "active") continue;
      if (now < (skillReady[id] || 0)) continue;
      const cost = Math.max(0, Math.round(World.sv(skill.sp, level)));
      if (me.sp < cost) continue;
      const reach = World.sv(skill.range, level);
      if ((skill.target === "mob" || skill.target === "ground") && !inRange(mob, reach)) continue;
      pushState(true);
      send({ t: "skill", s: id, i: skill.target === "mob" || skill.target === "ground" ? mob.id : -1 });
      skillReady[id] = now + (+me.cd.s[id] || skill.cd || 1000);
      me.sp = Math.max(0, me.sp - cost);
      if (skill.cast) {
        castUntil = now + skill.cast;
        break;
      }
      actionCounter = (actionCounter + 1) % 1000;
    }
  }

  if (now >= attackReadyAt && inRange(mob, me.range)) {
    actionCounter = (actionCounter + 1) % 1000;
    pushState(true);
    send({ t: "atk", i: mob.id });
    attackReadyAt = now + (+me.cd.basic || 600);
  }
}

function moveToward(mob, now, dt) {
  if (routeGoal !== mob.id || now >= replanAt || !path.length) {
    const route = findRoute(map, me, mob);
    routeGoal = mob.id;
    replanAt = now + 2500;
    if (!route) {
      skipped.set(mob.id, now + 10_000);
      clearTarget();
      return;
    }
    path = route;
  }

  while (path.length && Math.hypot(path[0].x - me.x, path[0].y - me.y) < 1.1) path.shift();
  const goal = path[0] || mob;
  const dx = goal.x - me.x, dy = goal.y - me.y;
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const speed = 4.6 * (1 + swiftBuff()) * dt / len;
  const beforeX = me.x, beforeY = me.y;
  World.step(map, me, dx * speed, dy * speed, 0.28, false);
  if (me.x === beforeX && me.y === beforeY) {
    path = [];
    replanAt = 0;
  }
}

function findRoute(currentMap, from, to, allowedPortal = null) {
  const N = currentMap.N;
  const nearPortal = (x, y) =>
    Math.hypot(from.x - x - 0.5, from.y - y - 0.5) > 2.5 &&
    currentMap.def.portals.some(p => {
      if (allowedPortal && p.to === allowedPortal.to && p.x === allowedPortal.x && p.y === allowedPortal.y) return false;
      return Math.hypot(p.x - x - 0.5, p.y - y - 0.5) < 1.8;
    });
  const okay = (x, y) => World.canStand(currentMap, x + 0.5, y + 0.5, 0.32, false) && !nearPortal(x, y);
  const sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
  if (sx < 0 || sy < 0 || sx >= N || sy >= N) return null;
  const seen = new Int32Array(N * N).fill(-1);
  const start = sy * N + sx;
  const queue = [start];
  seen[start] = start;

  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head], cx = cell % N, cy = (cell - cx) / N;
    if (Math.abs(cx - tx) + Math.abs(cy - ty) <= 1) {
      const route = [];
      for (let k = cell; k !== seen[k]; k = seen[k]) {
        const x = k % N;
        route.push({ x: x + 0.5, y: (k - x) / N + 0.5 });
      }
      return route.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const next = ny * N + nx;
      if (seen[next] !== -1 || !okay(nx, ny)) continue;
      seen[next] = cell;
      queue.push(next);
    }
  }
  return null;
}

function pushState(force) {
  if (!isOpen() || !me.inGame || me.dead || !map) return;
  const state = {
    t: "st", m: map.id,
    x: Math.round(me.x * 100) / 100,
    y: Math.round(me.y * 100) / 100,
    a: actionCounter,
  };
  const encoded = JSON.stringify(state);
  const now = Date.now();
  if (!force && (encoded === lastState || now - lastStateAt < 66)) return;
  lastState = encoded;
  lastStateAt = now;
  ws.send(encoded);
}

function send(obj) {
  if (isOpen()) ws.send(JSON.stringify(obj));
}

function isOpen() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function inRange(mob, reach) {
  return Math.hypot(mob.x - me.x, mob.y - me.y) <= reach + World.MOB[mob.type].r;
}

function hotbar() {
  const bar = Array.isArray(me.talents._bar) ? me.talents._bar.slice(0, World.HOTBAR) : [];
  while (bar.length < World.HOTBAR) bar.push("");
  return bar;
}

function swiftBuff() {
  const buff = me.buffs.find(x => Array.isArray(x) && x[0] === "swift");
  return buff ? +buff[2] || 0 : 0;
}

function clearTarget() {
  target = null;
  path = [];
  routeGoal = null;
  replanAt = 0;
}

function onBagUpdate() {
  for (const id of [...pendingDiscard]) if (!bag.some(it => it.id === id)) pendingDiscard.delete(id);
  if (pendingEquip && (bag.some(it => it.id === pendingEquip.id && it.eq) || !bag.some(it => it.id === pendingEquip.id))) pendingEquip = null;

  if (cfg.discardOtherClass) {
    const wrong = bag.filter(it => !it.eq && it.slot !== "card" && !wearable(it) && !pendingDiscard.has(it.id));
    if (wrong.length) {
      wrong.forEach(it => pendingDiscard.add(it.id));
      send({ t: "discard", ids: wrong.map(it => it.id) });
      notify("loot-policy", `Discarding ${wrong.length} item(s) for other classes`);
      return;
    }
  }

  if (!cfg.autoEquip || pendingEquip) return;
  const upgrades = bag.filter(it => !it.eq && it.slot !== "card" && !it.broken && wearable(it)).map(it => {
    const current = equippedIn(it.slot);
    return { item: it, gain: itemPower(it) - (current ? itemPower(current) : 0) };
  }).filter(x => x.gain > 0.001).sort((a, b) => b.gain - a.gain);
  if (upgrades.length) {
    const pick = upgrades[0];
    pendingEquip = { id: pick.item.id, at: Date.now() };
    send({ t: "equip", id: pick.item.id });
    notify("equipment", `Equipping ${pick.item.name || pick.item.slot} (+${pick.gain.toFixed(1)} score)`);
  }
}

function equippedIn(slot) {
  return bag.find(it => it.eq && it.slot === slot);
}

function wearable(it) {
  return !(it.slot === "weapon" && it.wcls && normalizeClass(it.wcls) !== me.cls);
}

function normalizeClass(cls) {
  return World.CLASSES[cls] ? cls : (World.OLD_CLASS && World.OLD_CLASS[cls]) || cls;
}

function itemPower(it) {
  if (!it || it.broken) return 0;
  return (+it.atk || 0) * 2 + (+it.def || 0) * 2 + (+it.hp || 0) * 0.35 +
    (+it.crit || 0) * 3 + (+it.critd || 0) * 0.25 + (+it.aspd || 0) * 0.8 +
    (+it.cdr || 0) * 0.8 + (+it.leech || 0) * 2 + (+it.dodge || 0) + (+it.block || 0);
}

function manageBuild() {
  const now = Date.now();
  if (pendingBuild && now - pendingBuild < 900) return;
  if (cfg.autoSpend && me.points > 0) {
    pendingBuild = now;
    send({ t: "autospend" });
    return;
  }
  if (!cfg.autoBuild) return;
  if (me.tp > 0) {
    const skills = World.CLASSES[me.cls].skills;
    const plan = XP_BUILD[me.cls] || [];
    let planned = null;
    for (const [id, cap] of plan) {
      const skill = World.SKILLS[id];
      if (skill && World.skillLv(me.talents, id) < cap && !World.canLearn(me, skill)) { planned = skill; break; }
    }
    const learnable = skills.filter(skill => !World.canLearn(me, skill)).sort((a, b) => skillXpPriority(b) - skillXpPriority(a));
    if (planned) {
      const index = learnable.indexOf(planned);
      if (index >= 0) learnable.unshift(...learnable.splice(index, 1));
    }
    if (learnable.length) {
      pendingBuild = now;
      send({ t: "talent", id: learnable[0].id });
      notify("build", `Learning ${learnable[0].name}`);
      return;
    }
  }
  const learned = World.CLASSES[me.cls].skills.filter(s => s.kind === "active" && World.skillLv(me.talents, s.id) > 0).sort((a, b) => skillXpPriority(b) - skillXpPriority(a)).map(s => s.id);
  const current = hotbar();
  const next = [...current.filter(id => learned.includes(id)), ...learned.filter(id => !current.includes(id))].slice(0, World.HOTBAR);
  while (next.length < World.HOTBAR) next.push("");
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    pendingBuild = now;
    me.talents._bar = next;
    send({ t: "bar", bar: next });
    notify("build", "Hotbar updated");
  }
}

function skillXpPriority(skill) {
  const level = Math.max(1, World.skillLv(me.talents, skill.id));
  const cooldown = Math.max(400, +(me.cd.s[skill.id] || skill.cd || 1000)) / 1000;
  let score = 0;
  if (skill.mult) score += World.sv(skill.mult, level) / cooldown * 100;
  if (skill.dot) score += World.sv(skill.dot.dps, level) * ((+skill.dot.dur || 0) / 1000) / cooldown * 80;
  if (skill.zone) score *= Math.max(1.2, (+skill.zone.dur || 0) / Math.max(1, +skill.zone.tick || 1000));
  if (skill.target === "ground" || skill.target === "self") score *= 1.25;
  if (skill.buff) score += ((World.sv(skill.buff.atk, level) || 0) + (World.sv(skill.buff.haste, level) || 0) + (World.sv(skill.buff.crit, level) || 0)) * 120;
  if (skill.heal || skill.target === "party") score += 8;
  return score;
}

function startBestExpedition(d) {
  const zones = Array.isArray(d.zones) ? d.zones : [];
  const safe = zones.filter(z => !(z.risk | 0)).sort((a, b) => (+b.xph || 0) - (+a.xph || 0));
  const choice = safe[0] || zones.sort((a, b) => (+a.risk || 0) - (+b.risk || 0) || (+b.xph || 0) - (+a.xph || 0))[0];
  if (!choice) return shutdown("no expedition available");
  const pots = Math.max(0, d.pots | 0);
  console.log(`[expedition] ${choice.name || `map ${choice.map}`} · ${choice.xph | 0} xp/h · risk ${choice.risk | 0}% · ${pots} potions`);
  send({ t: "expStart", map: choice.map | 0, pots });
}

function initLogs() {
  logDir = fsPath.join(__dirname, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  eventLogFile = fsPath.join(logDir, `events-${day}.jsonl`);
  logEvent("session-start", { config: safeConfig() });
}

function logEvent(type, data = {}) {
  if (!eventLogFile) return;
  const row = { at: new Date().toISOString(), type, ...data };
  try { fs.appendFileSync(eventLogFile, JSON.stringify(row) + "\n", "utf8"); } catch (err) {
    if (cfg.verbose) console.error(`[log] ${err.message}`);
  }
}

function writeSessionSummary(reason) {
  if (summaryWritten || !logDir) return;
  summaryWritten = true;
  const file = fsPath.join(logDir, "sessions.csv");
  const exists = fs.existsSync(file);
  const ended = new Date();
  const seconds = Math.round((ended - new Date(session.startedAt)) / 1000);
  const fields = [session.startedAt, ended.toISOString(), seconds, csvCell(me.name), me.lv | 0, session.kills, session.deaths,
    session.xp, session.gold, ...session.loot, session.cards, session.zones, session.disconnects, csvCell(reason)];
  const header = "started_at,ended_at,seconds,hero,level,kills,deaths,xp,gold,common,uncommon,rare,epic,cards,zones,disconnects,reason\n";
  try { fs.appendFileSync(file, (exists ? "" : header) + fields.join(",") + "\n", "utf8"); } catch {}
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replaceAll('"', '""')}"`;
}

function notify(kind, message, important = false) {
  const event = { id: ++eventSeq, at: new Date().toISOString(), kind, message, important };
  recentEvents.push(event);
  if (recentEvents.length > 100) recentEvents.shift();
  console.log(`[${kind}] ${message}`);
  logEvent("notification", event);
  if (important && cfg.webhook) {
    fetch(cfg.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `[Ember Vale] ${message}`, text: `[Ember Vale] ${message}`, event }),
    }).catch(err => { if (cfg.verbose) console.error(`[webhook] ${err.message}`); });
  }
}

function safeConfig() {
  return {
    url: cfg.url, user: cfg.user, zones: cfg.zones, potAt: cfg.potAt, fleeAt: cfg.fleeAt,
    minPots: cfg.minPots, buyPots: cfg.buyPots, minScrolls: cfg.minScrolls, buyScrolls: cfg.buyScrolls, trash: cfg.trash, sell: cfg.sell,
    autoEquip: cfg.autoEquip, autoBuild: cfg.autoBuild, autoRepair: cfg.autoRepair, xpRush: cfg.xpRush,
  };
}

function startDashboard() {
  dashboardServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") return sendHttp(res, 200, "text/html; charset=utf-8", dashboardHtml());
    if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, dashboardState());
    if (req.method === "GET" && url.pathname === "/api/events") {
      const after = Number(url.searchParams.get("after") || 0);
      return sendJson(res, recentEvents.filter(e => e.id > after));
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch {}
      dashboardAction(data.action);
      return sendJson(res, { ok: true, state: dashboardState() });
    }
    sendHttp(res, 404, "text/plain; charset=utf-8", "Not found");
  });
  dashboardServer.on("error", err => console.error(`[dashboard] ${err.message}`));
  dashboardServer.listen(cfg.dashboardPort, "127.0.0.1", () => {
    console.log(`[dashboard] http://127.0.0.1:${cfg.dashboardPort}`);
  });
}

function dashboardState() {
  const mob = target != null ? mobs[target] : null;
  const hours = Math.max(1 / 3600, (Date.now() - new Date(session.startedAt).getTime()) / 3600000);
  return {
    connected: isOpen(), authed, ready: haveMe && haveBag, paused: runtime.paused, mode: runtime.mode,
    hero: me.name, class: me.cls, level: me.lv, hp: me.hp, maxHp: me.mh, sp: me.sp, maxSp: me.msp,
    gold: me.gold, potions: me.pot, map: map ? map.def.name : "-", x: me.x, y: me.y,
    target: mob ? World.MOB[mob.type].name : "-", bag: bagCount, bagLimit,
    skills: cfg.useSkills, xpRush: cfg.xpRush, xpPerHour: Math.round(session.xp / hours), killsPerHour: Math.round(session.kills / hours), potionsPerMinute: Math.round(potionRatePerMinute() * 10) / 10, stats: session, startedAt: session.startedAt,
  };
}

function dashboardAction(action) {
  switch (action) {
    case "pause": runtime.paused = true; clearTarget(); notify("control", "Paused from dashboard"); break;
    case "resume": runtime.paused = false; notify("control", "Resumed from dashboard"); break;
    case "town": forceTown = true; townReason = "dashboard request"; runtime.paused = false; notify("control", "Returning to town"); break;
    case "skills": cfg.useSkills = !cfg.useSkills; notify("control", `Skills ${cfg.useSkills ? "enabled" : "disabled"}`); break;
    case "expedition":
      if (!pendingExpedition && authed && !me.dead) {
        pendingExpedition = true; runtime.paused = true; runtime.mode = "planning expedition"; send({ t: "expPlan" });
      }
      break;
    case "stop": requestShutdown("dashboard"); break;
  }
}

function sendHttp(res, status, type, body) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function sendJson(res, value) {
  sendHttp(res, 200, "application/json; charset=utf-8", JSON.stringify(value));
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { if (body.length < 10_000) body += chunk; });
    req.on("end", () => resolve(body));
  });
}

function dashboardHtml() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ember Vale Bot</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#17131f;color:#f5edff}body{max-width:900px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#e45b5b}.dot.on{background:#62d58b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}.card{background:#261f32;border:1px solid #443753;border-radius:14px;padding:14px}.big{font-size:1.4rem;font-weight:700}.bar{height:9px;background:#120f18;border-radius:9px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:#e86f6f}.bar.sp i{background:#609de8}button{border:0;border-radius:10px;padding:10px 14px;margin:4px;background:#7857a5;color:white;font-weight:700;cursor:pointer}button.warn{background:#a44c4c}#events{background:#110e17;border-radius:12px;padding:12px;max-height:260px;overflow:auto;font-family:ui-monospace,monospace;font-size:.85rem}.muted{color:#b5a9c4}</style></head><body>
<div class="top"><div><h1>Ember Vale Bot</h1><div><span id="dot" class="dot"></span> <span id="mode">starting</span></div></div><button onclick="notifications()">เปิดการแจ้งเตือน</button></div>
<div class="grid"><div class="card"><div class="muted">Hero</div><div id="hero" class="big">-</div><div id="where"></div></div><div class="card"><div>HP <span id="hp"></span></div><div class="bar"><i id="hpb"></i></div><div>SP <span id="sp"></span></div><div class="bar sp"><i id="spb"></i></div></div><div class="card"><div class="muted">ทรัพยากร</div><div id="resources" class="big"></div><div id="bag"></div></div><div class="card"><div class="muted">Session</div><div id="stats"></div><div id="rate" class="big"></div></div></div>
<div><button onclick="act('resume')">เริ่ม/ทำต่อ</button><button onclick="act('pause')">พัก</button><button onclick="act('town')">กลับเมือง</button><button onclick="act('skills')">เปิด/ปิดสกิล</button><button onclick="act('expedition')">ออก Expedition</button><button class="warn" onclick="act('stop')">หยุดบอท</button></div>
<h2>เหตุการณ์</h2><div id="events"></div><script>
let last=0;const $=id=>document.getElementById(id);async function act(action){await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});refresh()}function pct(a,b){return b?Math.max(0,Math.min(100,a/b*100)):0}async function refresh(){const s=await fetch('/api/state').then(r=>r.json());$('dot').className='dot '+(s.connected&&s.authed?'on':'');$('mode').textContent=(s.xpRush?'⚡ XP Rush · ':'')+s.mode+(s.paused?' · paused':'');$('hero').textContent=(s.hero||'-')+' · Lv'+s.level+' '+s.class;$('where').textContent=s.map+' · '+s.target;$('hp').textContent=Math.round(s.hp)+'/'+Math.round(s.maxHp);$('hpb').style.width=pct(s.hp,s.maxHp)+'%';$('sp').textContent=Math.round(s.sp)+'/'+Math.round(s.maxSp);$('spb').style.width=pct(s.sp,s.maxSp)+'%';$('resources').textContent=s.gold+'g · 🧪 '+s.potions;$('bag').textContent='Bag '+s.bag+'/'+s.bagLimit;$('stats').textContent='Kills '+s.stats.kills+' · XP '+s.stats.xp+' · Deaths '+s.stats.deaths;$('rate').textContent=s.xpPerHour+' XP/h · '+s.killsPerHour+' kills/h · '+s.potionsPerMinute+' pot/min';const ev=await fetch('/api/events?after='+last).then(r=>r.json());for(const e of ev){last=e.id;const d=document.createElement('div');d.textContent=new Date(e.at).toLocaleTimeString()+' ['+e.kind+'] '+e.message;$('events').prepend(d);if(e.important&&Notification.permission==='granted')new Notification('Ember Vale',{body:e.message})}}function notifications(){Notification.requestPermission()}setInterval(refresh,1000);refresh();</script></body></html>`;
}

function runSelfTests() {
  const checks = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(`Self-test failed: ${name}`);
    checks.push(name);
  };
  check("world maps loaded", World.MAPS.length >= 10);
  check("all maps route to town", World.MAPS.every(candidate => mapRoute(candidate.id, 0)?.at(-1) === 0));
  const route = findRoute(World.MAPS[0], World.SPAWN, World.APOTHECARY);
  check("pathfinding to apothecary", Array.isArray(route) && route.length > 0);
  check("pathfinding to storage", Array.isArray(findRoute(World.MAPS[0], World.SPAWN, World.VAULT)));
  const portal = World.MAPS[0].def.portals[0];
  check("pathfinding to portal", Array.isArray(findRoute(World.MAPS[0], World.SPAWN, portal, portal)));
  check("equipment scoring", itemPower({ atk: 5, def: 2, hp: 10 }) > itemPower({ atk: 1 }));
  check("dashboard renders", dashboardHtml().includes("/api/state"));
  check("skill definitions loaded", World.CLASS_IDS.every(id => World.CLASSES[id].skills.length > 0));
  const saved = { map, level: me.lv, atk: me.atk, def: me.def, mh: me.mh, cls: me.cls, talents: me.talents, cd: me.cd, bag, zones: cfg.zones, sell: cfg.sell, authed, inGame: me.inGame, ws, haveMe, haveBag, paused: runtime.paused, mode: runtime.mode };
  map = World.MAPS[0]; authed = true; me.inGame = true; ws = { readyState: WebSocket.OPEN }; haveMe = false; haveBag = false; runtime.paused = false;
  tick();
  check("startup data synchronization gate", runtime.mode === "syncing hero data" && !runtime.paused);
  map = World.MAPS[0]; me.lv = 1; bag = []; cfg.zones = "auto";
  check("starter zone selection", chooseHuntMap() === 0);
  me.lv = 10; bag = [
    { id: 1, eq: true, slot: "weapon", ilvl: 40, atk: 20 },
    { id: 2, eq: true, slot: "head", ilvl: 40, def: 20 },
    { id: 3, eq: true, slot: "body", ilvl: 40, hp: 100 },
    { id: 5, eq: true, slot: "cloak", ilvl: 40, def: 15 },
  ];
  check("gear-aware combat level", combatLevel() === 40);
  me.lv = 8; me.atk = 50; me.def = 18; me.mh = 241; me.cls = "wizard"; me.talents = { emberdart: 4, arclightning: 1, _bar: ["emberdart", "arclightning"] }; me.cd = { basic: 600, s: {} }; bag = [];
  check("xp-rate zone selection", [1, 2].includes(chooseHuntMap()));
  check("damage skill priority", skillXpPriority(World.SKILLS.emberdart) > skillXpPriority(World.SKILLS.frostshard));
  check("potion refill uses valid shop batches", potionBatch(70) === 10 && potionBatch(9) === 5 && potionBatch(4) === 1);
  me.lv = 10;
  cfg.sell = [0];
  bag = [{ id: 1, eq: true, slot: "weapon", ilvl: 10, atk: 20 }];
  bag.push({ id: 4, eq: false, slot: "weapon", rarity: 0, wcls: "knight", atk: 1, cards: [] });
  check("safe town selling", townSellables().some(it => it.id === 4));
  bag.push({ id: 5, eq: false, slot: "card", rarity: 3, name: "Rare card", cards: [] });
  check("valuable items go to storage", townStashables().some(it => it.id === 5) && !townSellables().some(it => it.id === 5));
  map = saved.map; me.lv = saved.level; me.atk = saved.atk; me.def = saved.def; me.mh = saved.mh; me.cls = saved.cls; me.talents = saved.talents; me.cd = saved.cd; bag = saved.bag; cfg.zones = saved.zones; cfg.sell = saved.sell;
  authed = saved.authed; me.inGame = saved.inGame; ws = saved.ws; haveMe = saved.haveMe; haveBag = saved.haveBag; runtime.paused = saved.paused; runtime.mode = saved.mode;
  console.log(`[self-test] ${checks.length} checks passed: ${checks.join(", ")}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`);
    const eq = arg.indexOf("=");
    const key = arg.slice(2, eq < 0 ? undefined : eq);
    if (eq >= 0) out[key] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function value(...items) {
  for (const item of items) if (item !== undefined && item !== null && item !== "") return item;
  return "";
}

function bool(v) {
  if (v === true) return true;
  return /^(1|true|yes|on)$/i.test(String(v || ""));
}

function csv(v) {
  return String(v || "").split(",").map(x => x.trim()).filter(Boolean);
}

function numberIn(v, min, max, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}`);
  return n;
}

function parseRarity(v) {
  const names = { common: 0, uncommon: 1, rare: 2, epic: 3 };
  const key = String(v).toLowerCase();
  if (Object.hasOwn(names, key)) return names[key];
  const n = Number(key);
  if (Number.isInteger(n) && n >= 0 && n <= 3) return n;
  fail(`Unknown rarity: ${v} (use common,uncommon,rare,epic)`);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function promptSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return prompt(question);
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let secret = "";
    const onData = ch => {
      if (ch === "\r" || ch === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(secret);
      } else if (ch === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\b" || ch === "\u007f") {
        secret = secret.slice(0, -1);
      } else if (ch >= " ") {
        secret += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

function printHelp() {
  console.log(`Ember Vale bot (Node.js 22+)

Usage:
  node bot.js --user HERO
  node bot.js --token TOKEN
  node bot.js --register --user HERO --class knight --color "#4f8ec9"

Credentials can be supplied through EV_USER / EV_PASSWORD or EV_TOKEN.
The password is prompted securely when omitted.

Options:
  --url URL            WebSocket URL (default: ${"wss://ember-vale.onrender.com/ws"})
  --user NAME          Hero name
  --token TOKEN        Existing session token (prefer EV_TOKEN)
  --register           Create a new hero instead of signing in
  --class ID           New hero class: ${World.CLASS_IDS.join(", ")}
  --color HEX          New hero colour from the game's colour list
  --targets IDS        Comma-separated monster type ids; default is all safe targets
  --pot-at RATIO       Drink below this HP ratio (default: 0.45)
  --flee-at RATIO      Run away below this HP ratio (default: 0.18)
  --level-gap N        Fight monsters up to N levels higher (default: 4)
  --zones MODE         auto, stay, or a fixed map id (default: auto)
  --trash RARITIES     Leave selected drops: common,uncommon,rare
  --keep-rarity NAME   Keep this rarity and higher; leave lower drops on the ground
  --sell RARITIES      Sell selected non-upgrade gear when the bag is full
  --discard-other-class  Discard unusable weapons (permanent)
  --min-pots N         Return for supplies at or below N potions (default: 3)
  --buy-pots N         Refill to N potions (default: 20)
  --min-scrolls N      Keep at least N return scrolls (default: 1)
  --buy-scrolls N      Refill to N return scrolls (default: 3)
  --reserve-gold N     Never spend below this gold reserve (default: 100)
  --auto-spend         Server-balanced attribute spending
  --auto-build         Spend attributes/skills and maintain the hotbar
  --xp-rush            Maximise XP/hour (damage build, XP targets, auto zones, trash/sell low rarity)
  --no-auto-equip      Do not equip stronger drops automatically
  --no-auto-repair     Pause instead of repairing broken equipped gear
  --no-skills          Use basic attacks only
  --dashboard-port N   Local dashboard port (default: 3210)
  --no-dashboard       Disable the local dashboard
  --webhook URL        Notify important events through a webhook (prefer EV_WEBHOOK_URL)
  --expedition-on-exit Start the best safe expedition when the bot is stopped
  --verbose            Log extra server messages
  --self-test          Run offline checks and exit
  --help               Show this help
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
