// ==UserScript==
// @name         Ember Vale XP Rush Bot
// @namespace    local.ember-vale
// @version      1.0.3
// @description  Visible XP/hour auto-hunt, zones, town supplies, gear and build automation for Ember Vale.
// @match        *://ember-vale.onrender.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const page = typeof unsafeWindow === "object" ? unsafeWindow : window;
  const STORE = "evx.xp-rush.settings.v1";
  const defaults = {
    enabled: false,
    autoZone: true,
    autoEquip: true,
    autoBuild: true,
    fastLoot: true,
    minPots: 10,
    buyPots: 80,
    reserveGold: 100,
    levelGap: 4,
  };
  let settings = loadSettings();
  const trackedSockets = new WeakSet();
  const state = {
    ws: null,
    peerId: -1,
    bag: [],
    bagLimit: 24,
    stash: [],
    stashLimit: 60,
    haveBag: false,
    mapId: 0,
    path: [],
    pathKey: "",
    desiredMap: null,
    townReason: "",
    refillTarget: 0,
    bagServiceTarget: -1,
    scrollTried: false,
    lastAction: 0,
    lastTrash: 0,
    pendingEquip: null,
    pendingBuild: 0,
    startedAt: Date.now(),
    xp: 0,
    kills: 0,
    deaths: 0,
    lastLevel: 0,
    status: "รอเข้าเกม",
    error: "",
  };

  const XP_BUILD = {
    knight: [["cleave",5],["steeloath",5],["flamearc",5],["cleave",10],["steeloath",10],["fervor",5],["shieldrush",10],["flamearc",10],["fervor",10],["sunder",10],["bulwark",10],["warcry",5],["reckoning",10]],
    wizard: [["emberdart",4],["arcanestudy",5],["arclightning",5],["emberdart",10],["thunderhead",5],["arcanestudy",10],["flamewell",5],["arclightning",10],["thunderhead",10],["flamewell",10],["frostshard",5],["whiteout",10],["chainspark",10],["leyattune",10],["gravitywell",10],["starfall",10]],
    hunter: [["twinshot",5],["hail",5],["keeneye",5],["twinshot",10],["longsight",5],["focus",5],["hail",10],["keeneye",10],["hawkdive",10],["piercing",10],["scattershot",10],["instinct",10],["blasttrap",10],["cometarrow",10]],
    priest: [["smite",5],["macetraining",5],["smite",10],["sacredward",5],["benediction",3],["mend",5],["macetraining",10],["hallowed",5],["dawnbreak",10],["judgement",10],["benediction",10],["serenity",10],["renewal",10],["choir",10]],
    assassin: [["venomstrike",5],["twinblades",5],["thousandcuts",5],["venomstrike",10],["twinblades",10],["toxicedge",5],["thousandcuts",10],["shadowspikes",10],["plagueseed",10],["shadowstep",10],["killerinstinct",10],["deathlotus",10]],
    blacksmith: [["coinsmash",5],["forgecraft",5],["coinsmash",10],["cartsweep",5],["quakehammer",5],["forgecraft",10],["wardrums",3],["temperededge",5],["overdrive",10],["goldrush",10],["cartsweep",10],["moltenstrike",10],["anvildrop",10]],
  };

  try {
    captureWebSocket();
  } catch (err) {
    state.error = `WebSocket hook: ${err && err.message ? err.message : err}`;
    installSendFallback();
  }
  ready(() => {
    createPanel();
    setInterval(mainTick, 250);
    setInterval(renderPanel, 500);
  });

  function captureWebSocket() {
    const Native = page.WebSocket;
    if (!Native || Native.__evxWrapped) return;
    function WrappedWebSocket(...args) {
      const socket = new Native(...args);
      const url = String(args[0] || "");
      if (/\/ws(?:\?|$)/.test(url)) trackSocket(socket);
      return socket;
    }
    WrappedWebSocket.prototype = Native.prototype;
    // Inherit WebSocket.CONNECTING/OPEN/etc. from the native constructor.
    // Those constants are read-only in Chromium, so assigning them throws.
    Object.setPrototypeOf(WrappedWebSocket, Native);
    Object.defineProperty(WrappedWebSocket, "__evxWrapped", { value: true });
    try {
      page.WebSocket = WrappedWebSocket;
    } catch (err) {
      installSendFallback(Native);
      throw err;
    }
  }

  function installSendFallback(Native = page.WebSocket) {
    const proto = Native && Native.prototype;
    if (!proto || proto.__evxSendWrapped || typeof proto.send !== "function") return;
    const nativeSend = proto.send;
    try {
      Object.defineProperty(proto, "__evxSendWrapped", { value: true });
      proto.send = function evxSend(data) {
        try {
          if (/\/ws(?:\?|$)/.test(String(this.url || ""))) trackSocket(this);
        } catch {}
        return nativeSend.call(this, data);
      };
    } catch (err) {
      state.error = `WebSocket fallback: ${err && err.message ? err.message : err}`;
    }
  }

  function trackSocket(socket) {
    if (!socket || trackedSockets.has(socket)) return;
    trackedSockets.add(socket);
    state.ws = socket;
    socket.addEventListener("message", event => {
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      onMessage(data);
    });
    socket.addEventListener("close", () => {
      if (state.ws === socket) state.ws = null;
      state.status = "การเชื่อมต่อขาด—รอต่อใหม่";
    });
  }

  function onMessage(data) {
    switch (data.t) {
      case "welcome":
        state.peerId = data.id | 0;
        break;
      case "auth_ok":
        state.startedAt = Date.now(); state.xp = state.kills = state.deaths = 0;
        state.refillTarget = 0;
        state.bagServiceTarget = -1;
        break;
      case "map":
        state.mapId = data.id | 0; state.path = []; state.pathKey = ""; state.scrollTried = false;
        break;
      case "bag":
        state.bag = Array.isArray(data.items) ? data.items : [];
        state.bagLimit = data.limit | 0 || 24;
        state.stash = Array.isArray(data.stash) ? data.stash : [];
        state.stashLimit = data.stashLimit | 0 || 60;
        state.haveBag = true;
        setTimeout(onBag, 0);
        break;
      case "gain":
        state.xp += data.xp | 0;
        if (data.lv) state.lastLevel = data.lv | 0;
        break;
      case "kill":
        if (Array.isArray(data.by) && data.by.includes(state.peerId)) state.kills += 1;
        break;
      case "died":
        state.deaths += 1;
        state.status = `แพ้ ${data.by || "monster"}`;
        break;
      case "auth_err":
      case "kicked":
        state.status = data.m || data.t;
        break;
    }
    if (data.t === "me") setTimeout(manageBuild, 0);
  }

  function mainTick() {
    const env = game();
    if (!env) { state.status = "รอเกมโหลด"; return; }
    const { me, mobs, map, W } = env;
    state.mapId = map.id;
    if (!me.inGame) { state.status = "กรุณา Sign in ในเกม"; return; }
    if (!settings.enabled) { state.status = "หยุดอยู่"; return; }
    if (me.dead) { setNativeAuto(false); state.status = "ตัวละครเสียชีวิต"; return; }
    if (!state.haveBag) { state.status = "กำลังอ่านกระเป๋า"; return; }

    if (Date.now() - state.lastTrash > 5000) {
      state.lastTrash = Date.now();
      send({ t: "autoTrash", on: true, r: settings.fastLoot ? [0, 1] : [] });
    }

    const reason = townNeeded(me);
    if (reason || state.townReason) {
      state.townReason ||= reason;
      setNativeAuto(false);
      if (map.id !== 0) return returnTown(env);
      return serviceTown(env);
    }

    if (settings.autoZone) {
      state.desiredMap = chooseMap(env);
      if (state.desiredMap !== map.id) {
        setNativeAuto(false);
        state.status = `เดินทางไป ${W.MAPS[state.desiredMap].def.name}`;
        return travelToMap(env, state.desiredMap);
      }
    }

    state.path = []; state.pathKey = "";
    setNativeAuto(true);
    const best = chooseTarget(env);
    if (best && (me.target == null || !mobs[me.target] || mobs[me.target].dead)) me.target = best.id;
    state.status = best ? `ล่า ${W.MOB[best.type].name}` : "รอมอนสเตอร์เกิด";
  }

  function game() {
    const api = page.__ev, W = page.World;
    if (!api || !W || !api.me || typeof api.mobs !== "function" || typeof api.CM !== "function") return null;
    return { api, W, me: api.me, mobs: api.mobs(), map: api.CM() };
  }

  function setNativeAuto(on) {
    const button = document.getElementById("btnAuto");
    if (!button || button.disabled) return;
    const active = button.getAttribute("aria-pressed") === "true";
    if (active !== on) {
      button.click();
      if (on) setTimeout(() => send({ t: "autoTrash", on: true, r: settings.fastLoot ? [0, 1] : [] }), 100);
    }
  }

  function chooseTarget({ me, mobs, W }) {
    const level = combatLevel(me);
    let best = null, bestScore = -Infinity;
    for (const mob of mobs) {
      const spec = W.MOB[mob.type];
      if (!spec || mob.dead || spec.boss || spec.mini || spec.rare || spec.lvl > level + settings.levelGap) continue;
      const distance = Math.hypot(mob.x - me.x, mob.y - me.y);
      const dps = estimatedDps(me, spec, W);
      const ttk = Math.max(0.2, Math.max(1, mob.hp || spec.hp) / dps);
      const travel = distance / 4.6;
      const incoming = Math.max(1, spec.atk - (me.def || 0) * 0.5) / Math.max(0.4, spec.cd || 1) * 1.55;
      const dangerRatio = ttk / Math.max(1, me.mh / incoming);
      const safety = 1 / (1 + Math.pow(dangerRatio * 1.8, 2));
      const score = (spec.xp || 1) / (ttk + travel) * safety * (mob.tg ? 1.1 : 1) * ((mob.eff & 16) ? 0.55 : 1);
      if (score > bestScore) { bestScore = score; best = mob; }
    }
    return best;
  }

  function chooseMap({ me, W }) {
    const level = combatLevel(me);
    let best = state.mapId, bestScore = -Infinity;
    for (const candidate of W.MAPS) {
      const rows = candidate.spawns.map(spawn => W.MOB[spawn.type]).filter(spec => spec && !spec.boss && !spec.mini && !spec.rare);
      if (!rows.length || Math.min(...rows.map(spec => spec.lvl)) > level + 1) continue;
      const suitable = rows.filter(spec => spec.lvl <= level + settings.levelGap);
      if (!suitable.length) continue;
      const distance = Math.max(1.2, candidate.N / Math.sqrt(suitable.length) * 0.32);
      const rates = suitable.map(spec => {
        const dps = estimatedDps(me, spec, W), ttk = spec.hp / dps;
        const incoming = Math.max(1, spec.atk - (me.def || 0) * 0.5) / Math.max(0.4, spec.cd || 1) * 1.55;
        const danger = 1 / (1 + Math.pow(ttk / Math.max(1, me.mh / incoming) * 1.8, 2));
        return (spec.xp || 1) / (ttk + distance / 4.6) * danger;
      }).sort((a, b) => b - a).slice(0, 6);
      const score = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      if (score > bestScore) { bestScore = score; best = candidate.id; }
    }
    return best;
  }

  function estimatedDps(me, spec, W) {
    const attack = Math.max(1, +me.atk || combatLevel(me) * 4);
    const hit = Math.max(attack * 0.3, attack - (+spec.def || 0) * 0.45);
    let dps = hit / (Math.max(200, +(me.cd && me.cd.basic) || 600) / 1000);
    for (const id of hotbar(me, W)) {
      const skill = W.SKILLS[id], level = id ? W.skillLv(me.talents, id) : 0;
      if (!skill || !level || !skill.mult) continue;
      let mult = W.sv(skill.mult, level);
      if (skill.dot) mult += W.sv(skill.dot.dps, level) * ((skill.dot.dur || 0) / 1000);
      if (skill.zone) mult *= Math.max(1, (skill.zone.dur || 0) / Math.max(1, skill.zone.tick || 1000));
      dps += attack * mult / (Math.max(400, +((me.cd && me.cd.s && me.cd.s[id]) || skill.cd || 1000)) / 1000);
    }
    return Math.max(1, dps);
  }

  function combatLevel(me) {
    const slots = ["weapon", "head", "body", "cloak", "shoes", "acc"];
    const levels = slots.map(slot => {
      const item = state.bag.find(x => x.eq && x.slot === slot && !x.broken);
      return item ? Math.max(me.lv, item.ilvl | 0) : me.lv;
    }).sort((a, b) => a - b);
    return Math.max(me.lv, levels[2] || me.lv);
  }

  function hotbar(me, W) {
    const bar = Array.isArray(me.talents && me.talents._bar) ? me.talents._bar.slice(0, W.HOTBAR) : [];
    while (bar.length < W.HOTBAR) bar.push("");
    return bar;
  }

  function townNeeded(me) {
    if (state.bag.some(item => item.eq && item.broken)) return "อุปกรณ์พัง";
    if ((me.pot | 0) <= settings.minPots && settings.buyPots > (me.pot | 0)) {
      // Keep the refill goal latched. Without this, the first purchased potion
      // raises the count above minPots and the bot immediately leaves town.
      state.refillTarget = Math.max(state.refillTarget, settings.buyPots);
      return "ยาเหลือน้อย";
    }
    if (state.bag.filter(item => !item.eq).length >= state.bagLimit) {
      state.bagServiceTarget = Math.max(0, state.bagLimit - Math.max(4, Math.ceil(state.bagLimit * 0.25)));
      return "กระเป๋าเต็ม";
    }
    return "";
  }

  function returnTown(env) {
    const { me } = env;
    state.status = `กลับเมือง: ${state.townReason}`;
    if ((me.scrolls | 0) > 0 && !state.scrollTried) {
      state.scrollTried = true;
      send({ t: "scroll" });
      return;
    }
    travelToMap(env, 0);
  }

  function serviceTown(env) {
    const { me, map, W } = env;
    const now = Date.now();
    const broken = state.bag.filter(item => item.eq && item.broken);
    if (broken.length) {
      state.status = "เดินไปซ่อมอุปกรณ์";
      if (!navigate(env, W.NPC, "npc:forge", false)) return;
      const item = broken.find(x => me.gold - (+x.repair || Infinity) >= settings.reserveGold);
      if (!item) return stopForAttention("เงินไม่พอซ่อมอุปกรณ์");
      if (now - state.lastAction > 1200) { state.lastAction = now; send({ t: "repair", id: item.id }); }
      return;
    }
    const used = state.bag.filter(item => !item.eq).length;
    if (state.bagServiceTarget >= 0 && used > state.bagServiceTarget) {
      const sell = sellables(me);
      if (sell.length) {
        state.status = `ขายของที่ปลอดภัย ${sell.length} ชิ้น`;
        if (!navigate(env, W.TRADER, "npc:trader", false)) return;
        if (now - state.lastAction > 700) { state.lastAction = now; send({ t: "sellMany", ids: sell.map(x => x.id) }); }
        return;
      }
      const store = stashables(me);
      if (store.length && state.stash.length < state.stashLimit) {
        state.status = `ฝาก ${store[0].name || "ของมีค่า"} · กระเป๋า ${used}/${state.bagLimit} · Storage ${state.stash.length}/${state.stashLimit}`;
        if (!navigate(env, W.VAULT, "npc:vault", false)) return;
        if (now - state.lastAction > 450) { state.lastAction = now; send({ t: "stash", id: store[0].id }); }
        return;
      }
      return stopForAttention(`กระเป๋า ${used}/${state.bagLimit} และ Storage ${state.stash.length}/${state.stashLimit} ไม่มีช่องว่างที่จัดการได้อย่างปลอดภัย`);
    }
    if (state.bagServiceTarget >= 0 && used <= state.bagServiceTarget) {
      state.status = `จัดกระเป๋าแล้ว · ว่าง ${state.bagLimit - used} ช่อง`;
      state.bagServiceTarget = -1;
    }
    const potions = me.pot | 0;
    if (state.refillTarget > potions) {
      const cost = Math.max(1, +(me.cost && me.cost.pot) || 12);
      const affordable = Math.floor(Math.max(0, me.gold - settings.reserveGold) / cost);
      const count = Math.min(state.refillTarget - potions, affordable);
      if (count <= 0) {
        state.refillTarget = 0;
        if (potions <= settings.minPots) return stopForAttention("เงินไม่พอซื้อยา");
      } else {
        // The shop accepts only the same batch sizes exposed by the game UI:
        // 10, 5 or 1. Sending an arbitrary n (for example 70) buys only one.
        const batch = potionBatch(count);
        state.status = `เติมยา ${potions}/${state.refillTarget} (+${batch})`;
        if (!navigate(env, W.APOTHECARY, "npc:apothecary", false)) return;
        if (now - state.lastAction > 400) {
          state.lastAction = now;
          send({ t: "buy", item: "pot", n: batch });
        }
        return;
      }
    }
    if (state.refillTarget && potions >= state.refillTarget) {
      state.status = `เติมยาครบ ${potions} ขวด`;
      state.refillTarget = 0;
    }
    state.townReason = ""; state.scrollTried = false; state.path = []; state.pathKey = "";
  }

  function potionBatch(remaining) {
    if (remaining >= 10) return 10;
    if (remaining >= 5) return 5;
    return 1;
  }

  function sellables(me) {
    return state.bag.filter(item => {
      if (item.eq || item.slot === "card" || (item.cards && item.cards.length) || (item.rarity | 0) > 1) return false;
      if (wearable(item, me)) {
        const current = state.bag.find(x => x.eq && x.slot === item.slot);
        if (!current || itemPower(item) > itemPower(current)) return false;
      }
      return true;
    });
  }

  function stashables(me) {
    const sell = new Set(sellables(me).map(item => item.id));
    return state.bag.filter(item => !item.eq && item.id !== state.pendingEquip && !sell.has(item.id)).sort((a, b) => stashPriority(b, me) - stashPriority(a, me));
  }

  function stashPriority(item, me) {
    return (item.slot === "card" ? 1_000_000 : 0) + ((item.cards && item.cards.length) ? 500_000 : 0) + (item.rarity | 0) * 100_000 + (!wearable(item, me) ? 10_000 : 0) + itemPower(item);
  }

  function onBag() {
    const env = game();
    if (!env || !settings.enabled || !settings.autoEquip) return;
    if (state.pendingEquip && state.bag.some(x => x.id === state.pendingEquip && x.eq)) state.pendingEquip = null;
    if (state.pendingEquip) return;
    const upgrades = state.bag.filter(item => !item.eq && item.slot !== "card" && !item.broken && wearable(item, env.me)).map(item => {
      const current = state.bag.find(x => x.eq && x.slot === item.slot);
      return { item, gain: itemPower(item) - (current ? itemPower(current) : 0) };
    }).filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain);
    if (upgrades[0]) { state.pendingEquip = upgrades[0].item.id; send({ t: "equip", id: upgrades[0].item.id }); }
  }

  function wearable(item, me) {
    return !(item.slot === "weapon" && item.wcls && item.wcls !== me.cls);
  }

  function itemPower(item) {
    if (!item || item.broken) return 0;
    return (+item.atk || 0) * 2 + (+item.def || 0) * 2 + (+item.hp || 0) * 0.35 + (+item.crit || 0) * 3 + (+item.critd || 0) * 0.25 + (+item.aspd || 0) * 0.8 + (+item.cdr || 0) * 0.8 + (+item.leech || 0) * 2 + (+item.dodge || 0) + (+item.block || 0);
  }

  function manageBuild() {
    const env = game();
    if (!env || !settings.enabled || !settings.autoBuild || Date.now() - state.pendingBuild < 900) return;
    const { me, W } = env;
    if ((me.points | 0) > 0) { state.pendingBuild = Date.now(); send({ t: "autospend" }); return; }
    if ((me.tp | 0) > 0) {
      const plan = XP_BUILD[me.cls] || [];
      for (const [id, cap] of plan) {
        const skill = W.SKILLS[id];
        if (skill && W.skillLv(me.talents, id) < cap && !W.canLearn(me, skill)) {
          state.pendingBuild = Date.now(); send({ t: "talent", id }); return;
        }
      }
    }
    const learned = W.CLASSES[me.cls].skills.filter(skill => skill.kind === "active" && W.skillLv(me.talents, skill.id) > 0).sort((a, b) => skillScore(b, me, W) - skillScore(a, me, W)).map(skill => skill.id).slice(0, W.HOTBAR);
    while (learned.length < W.HOTBAR) learned.push("");
    if (JSON.stringify(learned) !== JSON.stringify(hotbar(me, W))) {
      state.pendingBuild = Date.now(); send({ t: "bar", bar: learned });
    }
  }

  function skillScore(skill, me, W) {
    const level = Math.max(1, W.skillLv(me.talents, skill.id));
    const cooldown = Math.max(400, +((me.cd && me.cd.s && me.cd.s[skill.id]) || skill.cd || 1000)) / 1000;
    let score = skill.mult ? W.sv(skill.mult, level) / cooldown * 100 : 0;
    if (skill.dot) score += W.sv(skill.dot.dps, level) * ((skill.dot.dur || 0) / 1000) / cooldown * 80;
    if (skill.zone) score *= Math.max(1.2, (skill.zone.dur || 0) / Math.max(1, skill.zone.tick || 1000));
    if (skill.buff) score += ((W.sv(skill.buff.atk, level) || 0) + (W.sv(skill.buff.haste, level) || 0) + (W.sv(skill.buff.crit, level) || 0)) * 120;
    return score;
  }

  function travelToMap(env, destination) {
    if (env.map.id === destination) return true;
    const route = mapRoute(env.W, env.map.id, destination);
    if (!route || route.length < 2) return stopForAttention("หาเส้นทางข้ามโซนไม่ได้");
    const next = route[1], portal = env.map.def.portals.find(p => p.to === next);
    return portal ? navigate(env, portal, `portal:${env.map.id}:${next}`, true) : false;
  }

  function mapRoute(W, from, to) {
    const seen = new Map([[from, null]]), queue = [from];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      for (const portal of W.MAPS[id].def.portals) if (!seen.has(portal.to)) { seen.set(portal.to, id); queue.push(portal.to); }
    }
    if (!seen.has(to)) return null;
    const result = [];
    for (let at = to; at != null; at = seen.get(at)) result.push(at);
    return result.reverse();
  }

  function navigate(env, point, key, allowPortal) {
    const { me, map, W } = env;
    if (Math.hypot(point.x - me.x, point.y - me.y) < (allowPortal ? 0.5 : (W.NPC_RANGE || 2.8) - 0.25)) return true;
    if (state.pathKey !== key || !state.path.length) {
      state.path = findPath(W, map, me, point, allowPortal ? point : null) || [];
      state.pathKey = key;
    }
    while (state.path.length && Math.hypot(state.path[0].x - me.x, state.path[0].y - me.y) < 1.0) state.path.shift();
    me.target = null; me.pending = null; me.moveTo = state.path[0] || { x: point.x, y: point.y };
    return false;
  }

  function findPath(W, map, from, to, allowedPortal) {
    const N = map.N;
    const nearPortal = (x, y) => Math.hypot(from.x - x - 0.5, from.y - y - 0.5) > 2.5 && map.def.portals.some(p => {
      if (allowedPortal && p.to === allowedPortal.to && p.x === allowedPortal.x && p.y === allowedPortal.y) return false;
      return Math.hypot(p.x - x - 0.5, p.y - y - 0.5) < 1.8;
    });
    const okay = (x, y) => W.canStand(map, x + 0.5, y + 0.5, 0.32, false) && !nearPortal(x, y);
    const sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
    if (sx < 0 || sy < 0 || sx >= N || sy >= N) return null;
    const seen = new Int32Array(N * N).fill(-1), start = sy * N + sx, queue = [start]; seen[start] = start;
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head], cx = cell % N, cy = (cell - cx) / N;
      if (Math.abs(cx - tx) + Math.abs(cy - ty) <= 1) {
        const route = [];
        for (let at = cell; at !== seen[at]; at = seen[at]) { const x = at % N; route.push({ x: x + 0.5, y: (at - x) / N + 0.5 }); }
        return route.reverse();
      }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy, index = ny * N + nx;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[index] !== -1 || !okay(nx, ny)) continue;
        seen[index] = cell; queue.push(index);
      }
    }
    return null;
  }

  function send(payload) {
    const socket = state.ws;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  function stopForAttention(message) {
    settings.enabled = false; saveSettings(); setNativeAuto(false); state.status = message; state.error = message; renderPanel(); return false;
  }

  function createPanel() {
    if (document.getElementById("evx-panel")) return;
    const style = document.createElement("style");
    style.textContent = `#evx-panel{position:fixed;z-index:2147483647;right:12px;top:70px;width:260px;background:#17131fee;color:#f7efff;border:1px solid #6d5687;border-radius:14px;box-shadow:0 10px 30px #0008;padding:12px;font:13px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px)}#evx-panel *{box-sizing:border-box}#evx-panel h3{margin:0 0 8px;font-size:16px}#evx-panel .evx-row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}#evx-panel .evx-rate{font-size:19px;font-weight:800;color:#ffd36a}#evx-panel button{border:0;border-radius:9px;padding:8px 11px;font-weight:800;color:white;background:#7755a5;cursor:pointer}#evx-panel button.evx-stop{background:#a84848}#evx-panel label{display:flex;gap:6px;align-items:center;color:#d8cce7}#evx-panel .evx-muted{color:#af9fbe;font-size:12px}#evx-panel .evx-error{color:#ff9898}`;
    document.documentElement.append(style);
    const panel = document.createElement("div");
    panel.id = "evx-panel";
    panel.innerHTML = `<h3>⚡ XP Rush</h3><div id="evx-status" class="evx-muted">รอเกมโหลด</div><div class="evx-row"><span>XP/hour</span><span id="evx-xph" class="evx-rate">0</span></div><div class="evx-row"><span>Session</span><span id="evx-session">0 XP · 0 kills</span></div><div class="evx-row"><span>เป้าหมาย/โซน</span><span id="evx-target">-</span></div><div class="evx-row"><button id="evx-toggle">เริ่ม XP Rush</button><button id="evx-town">กลับเมือง</button></div><label><input id="evx-zone" type="checkbox"> เปลี่ยนโซนอัตโนมัติ</label><label><input id="evx-build" type="checkbox"> ลงแต้ม Damage build</label><label><input id="evx-loot" type="checkbox"> ทิ้ง Common/Uncommon</label><label><input id="evx-equip" type="checkbox"> ใส่อุปกรณ์ที่แรงกว่า</label><div id="evx-error" class="evx-error"></div>`;
    document.body.append(panel);
    panel.querySelector("#evx-toggle").onclick = () => {
      settings.enabled = !settings.enabled; state.error = ""; state.townReason = ""; saveSettings();
      if (!settings.enabled) { setNativeAuto(false); send({ t: "autoTrash", on: false, r: [] }); }
      renderPanel();
    };
    panel.querySelector("#evx-town").onclick = () => { settings.enabled = true; state.townReason = "สั่งกลับเมือง"; saveSettings(); };
    for (const [id, key] of [["evx-zone","autoZone"],["evx-build","autoBuild"],["evx-loot","fastLoot"],["evx-equip","autoEquip"]]) {
      const input = panel.querySelector("#" + id); input.checked = !!settings[key]; input.onchange = () => { settings[key] = input.checked; saveSettings(); };
    }
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById("evx-panel"); if (!panel) return;
    const hours = Math.max(1 / 3600, (Date.now() - state.startedAt) / 3600000);
    const env = game();
    panel.querySelector("#evx-status").textContent = state.status;
    panel.querySelector("#evx-xph").textContent = Math.round(state.xp / hours).toLocaleString();
    panel.querySelector("#evx-session").textContent = `${state.xp.toLocaleString()} XP · ${state.kills} kills`;
    panel.querySelector("#evx-target").textContent = env ? `${env.map.def.name} · Lv${env.me.lv}` : "-";
    const toggle = panel.querySelector("#evx-toggle"); toggle.textContent = settings.enabled ? "หยุด Bot" : "เริ่ม XP Rush"; toggle.className = settings.enabled ? "evx-stop" : "";
    panel.querySelector("#evx-error").textContent = state.error;
  }

  function loadSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || "{}") }; } catch { return { ...defaults }; }
  }
  function saveSettings() { localStorage.setItem(STORE, JSON.stringify(settings)); }
  function ready(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback, { once: true });
    else callback();
  }
})();
