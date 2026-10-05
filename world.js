// Shared world definition: loaded by the server (require) and by the browser (<script>).
// Everything here is deterministic, so the server and every player build identical maps.
(function(root) {
    "use strict";

    // ---------- tiles ----------
    const G = 0
      , F = 1
      , T = 2
      , W = 3
      , P = 4
      , S = 5
      , D = 6
      , H = 7
      , R = 8
      , FT = 9
      , PT = 10
      , BR = 11
      , WL = 12;
    // BR bridge, WL city wall
    const COLORS = ["#f08a3c", "#5fb3d9", "#9b7ad8", "#6fcf97", "#e0607e", "#e8c25a"];

    // ---------- character growth ----------
    const MAX_LEVEL = 90;
    const POINTS_PER_LEVEL = 3;
    // Six attributes, each with one job it owns outright. Nothing is a dump stat:
    //   STR melee damage · AGI speed and dodging · VIT staying alive
    //   INT magic damage and the SP to cast it · DEX aim and recharge · LUK crits and finds
    const STATS = ["str", "agi", "vit", "int", "dex", "luk"];
    const STAT_NAMES = {
        str: "Strength",
        agi: "Agility",
        vit: "Vitality",
        int: "Intellect",
        dex: "Dexterity",
        luk: "Luck"
    };
    const STAT_HELP = {
        str: "Melee attack power, and a little armour.",
        agi: "Attack speed (up to +30%, reached at 86) and the chance to dodge a blow completely (up to 35%, at 100 - an Assassin's Killer Instinct lifts that to 45%).",
        vit: "Maximum health, and armour. A Knight also blocks with it: 5% plus 0.25% a point, up to 30% at 100 - a blocked blow does half damage, bosses' too.",
        int: "Magic attack power, maximum SP and how fast SP comes back.",
        dex: "Attack power for bows and wands, and shorter skill cooldowns (up to 35%, reached at 110).",
        luk: "Crit chance, crit damage, and better drops.",
    };
    const need = lv => Math.round(18 * Math.pow(lv, 1.72));

    // ---------- classes ----------
    // Six classes in the spirit of Ragnarok Online's second jobs.
    // hp / sp / atk are multipliers, def is flat, w = how much each attribute adds to attack power.
    // Every class has 8 skills (2 passive, 6 active), each learnable to level 10 with skill points.
    //
    // Skill numbers are [base, perLevel]: value at level L = base + perLevel * (L - 1).
    //   kind      "active" | "passive"
    //   target    "mob" (needs a target) | "self" | "ground" (lands on the target, or on you) | "party" (you + allies near you)
    //   req       { skillId: level } prerequisites     lvReq: base level needed to learn it
    //   sp, cd    SP cost and cooldown (ms)             cast: delay before it lands (ms)
    //   mult      damage as a multiple of attack power  hits: how many hits it is split into (for show)
    //   radius    area size in tiles                    range: reach in tiles
    //   stun/slow/dot/defDown/knock   what it does to monsters
    //   buff      { key: [b, p] } for dur [b, p]  (keys: atk def dr crit haste shield stealth poisonHit)
    //   heal      fraction of max HP                   zone: lingering area { dur, tick }
    //   pas       passive bonuses per level { dmg def hp sp spRegen hpRegen crit haste range double potion discount }
    const SKILL_MAX = 10;
    const CLASSES = {
        knight: {
            name: "Knight",
            blurb: "Armoured blade who charges in and holds the line.",
            role: "Melee · Tank",
            weapon: "sword",
            hp: 1.35,
            sp: 0.8,
            atk: 1.35,
            def: 4,
            block: {
                base: 0.05,
                perVit: 0.0025,
                cap: 0.3
            },
            base: {
                str: 9,
                agi: 4,
                vit: 8,
                int: 2,
                dex: 4,
                luk: 3
            },
            w: {
                str: 0.55,
                agi: 0.12,
                int: 0.04,
                dex: 0.14
            },
            basic: {
                range: 1.5,
                cd: 640,
                mult: 1.0
            },
            skills: [{
                id: "steeloath",
                name: "Steel Oath",
                kind: "passive",
                pas: {
                    dmg: 0.03
                },
                icon: "sword",
                desc: "+{dmg}% damage."
            }, {
                id: "cleave",
                name: "Cleave",
                kind: "active",
                target: "mob",
                range: 1.8,
                sp: [1, 0.39],
                cd: 700,
                mult: [1.49, 0.3],
                radius: [1.1, 0],
                stun: {
                    from: 6,
                    chance: [0.06, 0.06],
                    dur: 1500
                },
                look: "bash",
                icon: "burst",
                desc: "A wide swing, {mult}% attack to the foe and any right beside it. From level 6, {chance}% to daze them for {sdur}s."
            }, {
                id: "roar",
                name: "Taunting Roar",
                kind: "active",
                target: "self",
                radius: [3, 0.1],
                sp: [2, 0],
                cd: 4000,
                mult: [0.2, 0.04],
                defDown: {
                    pct: [0.06, 0.03],
                    dur: 12000
                },
                taunt: true,
                look: "provoke",
                icon: "shout",
                desc: "Roar at everything around you for {mult}% attack: they come for you and lose {def}% armour for 12s."
            }, {
                id: "ironhide",
                name: "Iron Hide",
                kind: "passive",
                lvReq: 5,
                pas: {
                    hpRegen: 0.0015,
                    potion: 0.05
                },
                icon: "heart",
                tint: "#e0607a",
                desc: "Regenerate {hpRegen}% of max HP a second; potions heal +{potion}%."
            }, {
                id: "flamearc",
                name: "Flame Arc",
                kind: "active",
                target: "self",
                req: {
                    cleave: 5
                },
                lvReq: 8,
                sp: [2, 0],
                cd: 2500,
                mult: [1.17, 0.23],
                radius: [2.2, 0.05],
                knock: 1,
                look: "magnumbreak",
                icon: "fire",
                tint: "#f07a3a",
                desc: "Sweep a ring of fire round you, {mult}% attack, knocking foes back."
            }, {
                id: "bastion",
                name: "Bastion",
                kind: "active",
                target: "self",
                req: {
                    roar: 3
                },
                lvReq: 10,
                sp: [2, 0],
                cd: 20000,
                buff: {
                    dr: [0.1, 0.02]
                },
                dur: [8000, 700],
                look: "endure",
                icon: "shield",
                tint: "#6a90d0",
                desc: "Brace behind your shield: {dr}% less damage for {dur}s."
            }, {
                id: "fervor",
                name: "Fervor",
                kind: "active",
                target: "self",
                req: {
                    steeloath: 1
                },
                lvReq: 15,
                sp: [2, 1.18],
                cd: 30000,
                buff: {
                    haste: [0.1, 0.02]
                },
                dur: [20000, 3000],
                look: "quicken",
                icon: "wing",
                desc: "Fight faster: +{haste}% attack speed for {dur}s."
            }, {
                id: "shieldrush",
                name: "Shield Rush",
                kind: "active",
                target: "mob",
                req: {
                    cleave: 10,
                    flamearc: 3
                },
                lvReq: 25,
                range: 3,
                sp: [2, 0.39],
                cd: 1200,
                mult: [2.07, 0.41],
                radius: [1.6, 0.04],
                knock: 2,
                look: "bowlingbash",
                icon: "sword2",
                desc: "Charge a foe from three paces, {mult}% attack to it and everything near, bowled back."
            }, {
                id: "sunder",
                name: "Sundering Thrust",
                kind: "active",
                target: "mob",
                req: {
                    shieldrush: 3
                },
                lvReq: 40,
                range: 2,
                sp: [6, 0.6],
                cd: 1400,
                mult: [2.6, 0.52],
                hits: [4, 0],
                defDown: {
                    pct: [0.05, 0.01],
                    dur: 6000
                },
                look: "bash",
                icon: "slash",
                desc: "Four driving thrusts, {mult}% attack in total; the foe loses {def}% armour for 6s."
            }, {
                id: "bulwark",
                name: "Bulwark",
                kind: "passive",
                req: {
                    steeloath: 5
                },
                lvReq: 55,
                pas: {
                    hp: 0.015,
                    def: 0.015
                },
                icon: "shield",
                desc: "+{hp}% max HP and +{def}% armour."
            }, {
                id: "warcry",
                name: "War Cry",
                kind: "active",
                target: "party",
                req: {
                    bastion: 5
                },
                lvReq: 70,
                radius: [6, 0],
                sp: [12, 0.5],
                cd: 40000,
                buff: {
                    atk: [0.08, 0.012],
                    def: [0.08, 0.012]
                },
                dur: [20000, 2000],
                look: "provoke",
                icon: "shout",
                tint: "#e05a4a",
                desc: "Rally your party: +{atk}% attack and +{def}% armour for {dur}s."
            }, {
                id: "reckoning",
                name: "Dragon's Reckoning",
                kind: "active",
                target: "self",
                req: {
                    sunder: 5,
                    flamearc: 5
                },
                lvReq: 85,
                sp: [14, 1],
                cd: 12000,
                cast: 700,
                mult: [3.6, 0.72],
                radius: [3, 0.06],
                knock: 2,
                stun: {
                    chance: [0.2, 0.02],
                    dur: 1500
                },
                snd: "magnumbreak",
                icon: "fire",
                tint: "#e8603a",
                desc: "A blade of fire falls where you stand: {mult}% attack to all around, flung back, {chance}% to daze them for {sdur}s."
            }, ],
        },
        wizard: {
            name: "Wizard",
            blurb: "Fragile caster who rains fire, ice and lightning.",
            role: "Magic · Area",
            weapon: "staff",
            hp: 1.15,
            sp: 1.6,
            atk: 1.66,
            def: 0,
            base: {
                str: 2,
                agi: 4,
                vit: 3,
                int: 11,
                dex: 5,
                luk: 3
            },
            w: {
                str: 0.03,
                agi: 0.05,
                int: 0.58,
                dex: 0.16
            },
            basic: {
                range: 4.5,
                cd: 850,
                mult: 1.96,
                fx: "bolt"
            },
            skills: [{
                id: "arcanestudy",
                name: "Arcane Study",
                kind: "passive",
                pas: {
                    dmg: 0.04
                },
                icon: "book",
                desc: "+{dmg}% damage."
            }, {
                id: "emberdart",
                name: "Ember Darts",
                kind: "active",
                target: "mob",
                range: 7,
                sp: [1, 0.82],
                cd: 600,
                cast: 250,
                mult: [0.82, 0.17],
                hits: [1, 1],
                look: "firebolt",
                icon: "fire",
                tint: "#f07a3a",
                desc: "Darts of flame (×{hits}): {mult}% attack in total."
            }, {
                id: "frostshard",
                name: "Frost Shard",
                kind: "active",
                target: "mob",
                range: 7,
                sp: [3, 0],
                cd: 1500,
                mult: [0.64, 0.12],
                stun: {
                    chance: [0.38, 0.03],
                    dur: [2000, 250]
                },
                look: "frostdiver",
                icon: "ice",
                tint: "#5ab8ec",
                desc: "A shard of ice, {mult}% attack; {chance}% to freeze the foe solid for {sdur}s."
            }, {
                id: "manaspring",
                name: "Mana Spring",
                kind: "passive",
                lvReq: 5,
                pas: {
                    sp: 0.03,
                    spRegen: 0.04
                },
                icon: "drop",
                tint: "#5a8ae0",
                desc: "+{sp}% max SP, and SP comes back {spRegen}% faster."
            }, {
                id: "arclightning",
                name: "Arc Lightning",
                kind: "active",
                target: "mob",
                lvReq: 5,
                range: 7,
                sp: [2, 0.82],
                cd: 800,
                mult: [0.63, 0.12],
                hits: [1, 0.5],
                radius: [1.2, 0],
                look: "soulstrike",
                icon: "bolt",
                tint: "#8a6ad8",
                desc: "Crackling arcs (×{hits}): {mult}% attack in total, jumping to foes beside the target."
            }, {
                id: "thunderhead",
                name: "Thunderhead",
                kind: "active",
                target: "ground",
                req: {
                    emberdart: 4
                },
                lvReq: 12,
                range: 7,
                sp: [3, 2.42],
                cd: 3000,
                cast: 800,
                radius: [2.3, 0.05],
                mult: [0.79, 0.16],
                hits: [2, 0.5],
                look: "thunderstorm",
                icon: "bolt",
                tint: "#e8c23a",
                desc: "A storm cloud breaks over an area in {hits} strikes: {mult}% attack in total."
            }, {
                id: "flamewell",
                name: "Flame Well",
                kind: "active",
                target: "ground",
                req: {
                    emberdart: 5
                },
                lvReq: 18,
                range: 7,
                sp: [3, 1.61],
                cd: 4000,
                radius: [1.5, 0.03],
                mult: [0.31, 0.06],
                zone: {
                    dur: 6000,
                    tick: 1000
                },
                look: "firepillar",
                icon: "pillar",
                tint: "#e8603a",
                desc: "Fire wells up from the ground for {zdur}s, {mult}% attack each second."
            }, {
                id: "whiteout",
                name: "Whiteout",
                kind: "active",
                target: "ground",
                req: {
                    frostshard: 5,
                    thunderhead: 5
                },
                lvReq: 30,
                range: 7,
                sp: [8, 2.42],
                cd: 8000,
                cast: 1400,
                radius: [3.2, 0.05],
                mult: [1.46, 0.29],
                stun: {
                    chance: [0.3, 0.01],
                    dur: [2500, 0]
                },
                look: "stormgust",
                icon: "snow",
                tint: "#6ac0f0",
                desc: "A blizzard: {mult}% attack to a wide area, {chance}% to freeze each foe for {sdur}s."
            }, {
                id: "chainspark",
                name: "Chain Spark",
                kind: "active",
                target: "mob",
                req: {
                    arclightning: 5
                },
                lvReq: 40,
                range: 7,
                sp: [5, 0.8],
                cd: 1200,
                mult: [1.1, 0.22],
                hits: [4, 0],
                radius: [1.8, 0],
                look: "soulstrike",
                icon: "orb",
                desc: "Lightning leaps from foe to foe in {hits} jolts: {mult}% attack in total around the target."
            }, {
                id: "leyattune",
                name: "Ley Attunement",
                kind: "passive",
                req: {
                    arcanestudy: 5
                },
                lvReq: 55,
                pas: {
                    sp: 0.02,
                    dmg: 0.015
                },
                icon: "book",
                tint: "#7a5ad8",
                desc: "+{sp}% max SP and +{dmg}% damage."
            }, {
                id: "gravitywell",
                name: "Gravity Well",
                kind: "active",
                target: "ground",
                req: {
                    flamewell: 5
                },
                lvReq: 70,
                range: 7,
                sp: [8, 1.6],
                cd: 9000,
                cast: 500,
                radius: [2.4, 0.05],
                mult: [0.44, 0.09],
                zone: {
                    dur: 5000,
                    tick: 700
                },
                stun: {
                    chance: [0.06, 0.006],
                    dur: 700
                },
                snd: "stormgust",
                icon: "orb",
                tint: "#5a3a9a",
                desc: "A crushing vortex for {zdur}s: {mult}% attack every {tick}s, and each time {chance}% to pin a foe for {sdur}s."
            }, {
                id: "starfall",
                name: "Starfall",
                kind: "active",
                target: "ground",
                req: {
                    whiteout: 5,
                    chainspark: 5
                },
                lvReq: 85,
                range: 7,
                sp: [16, 2.4],
                cd: 14000,
                cast: 1600,
                radius: [3.4, 0.05],
                mult: [2.56, 0.51],
                hits: [6, 0],
                snd: "thunderstorm",
                icon: "star",
                tint: "#4a5ab8",
                desc: "Call down the night sky: {hits} falling stars, {mult}% attack in total over a wide area."
            }, ],
        },
        hunter: {
            name: "Hunter",
            blurb: "Sharp-eyed archer with traps and a trained falcon.",
            role: "Ranged · Burst",
            weapon: "bow",
            hp: 0.95,
            sp: 1.0,
            atk: 1.18,
            def: 1,
            base: {
                str: 4,
                agi: 8,
                vit: 4,
                int: 3,
                dex: 9,
                luk: 4
            },
            w: {
                str: 0.10,
                agi: 0.20,
                int: 0.05,
                dex: 0.54
            },
            basic: {
                range: 6,
                cd: 700,
                mult: 0.82,
                fx: "arrow"
            },
            skills: [{
                id: "keeneye",
                name: "Keen Eye",
                kind: "passive",
                pas: {
                    crit: 0.01,
                    dmg: 0.01
                },
                icon: "eye",
                desc: "+{crit}% crit and +{dmg}% damage."
            }, {
                id: "twinshot",
                name: "Twin Shot",
                kind: "active",
                target: "mob",
                range: 7,
                sp: [2, 0],
                cd: 500,
                mult: [1.15, 0.23],
                hits: [2, 0],
                look: "doublestrafe",
                icon: "arrow2",
                desc: "Two arrows on one string, {mult}% attack in total."
            }, {
                id: "hail",
                name: "Hail of Arrows",
                kind: "active",
                target: "ground",
                req: {
                    twinshot: 5
                },
                lvReq: 8,
                range: 7,
                sp: [3, 0],
                cd: 1500,
                radius: [2, 0.05],
                mult: [0.59, 0.11],
                knock: 1,
                look: "arrowshower",
                icon: "rain",
                desc: "Arrows come down on an area, {mult}% attack, knocking foes back."
            }, {
                id: "longsight",
                name: "Long Sight",
                kind: "passive",
                lvReq: 5,
                pas: {
                    range: 0.25,
                    dmg: 0.01
                },
                icon: "eye",
                tint: "#5a9a4a",
                desc: "+{range} tiles of reach and +{dmg}% damage."
            }, {
                id: "focus",
                name: "Hunter's Focus",
                kind: "active",
                target: "self",
                req: {
                    keeneye: 3
                },
                lvReq: 10,
                sp: [4, 0.43],
                cd: 30000,
                buff: {
                    haste: [0.05, 0.02],
                    crit: [0.03, 0.01]
                },
                dur: [20000, 2000],
                look: "concentration",
                icon: "star",
                desc: "+{haste}% attack speed and +{crit}% crit for {dur}s."
            }, {
                id: "bola",
                name: "Bola",
                kind: "active",
                target: "ground",
                lvReq: 12,
                range: 6,
                sp: [2, 0],
                cd: 6000,
                cast: 400,
                radius: [1.3, 0.03],
                stun: {
                    chance: [1, 0],
                    dur: [3000, 500]
                },
                look: "anklesnare",
                icon: "trap",
                desc: "A weighted throw that tangles legs: foes there are held for {dur}s."
            }, {
                id: "hawkdive",
                name: "Hawk Dive",
                kind: "active",
                target: "mob",
                req: {
                    focus: 1
                },
                lvReq: 18,
                range: 7,
                sp: [2, 0.43],
                cd: 2000,
                mult: [0.96, 0.19],
                radius: [1.5, 0],
                hits: [1, 1],
                look: "blitzbeat",
                icon: "falcon",
                desc: "Your hawk stoops on the target (×{hits}): {mult}% attack in total around it."
            }, {
                id: "piercing",
                name: "Piercing Shot",
                kind: "active",
                target: "mob",
                req: {
                    twinshot: 10,
                    focus: 5
                },
                lvReq: 30,
                range: 8,
                sp: [4, 0.29],
                cd: 1500,
                mult: [1.84, 0.37],
                pierce: true,
                critBonus: 0.2,
                look: "sharpshooting",
                icon: "arrow",
                desc: "One shot through every foe in a line, {mult}% attack, +20% crit."
            }, {
                id: "scattershot",
                name: "Scatter Shot",
                kind: "active",
                target: "mob",
                req: {
                    twinshot: 8
                },
                lvReq: 40,
                range: 7,
                sp: [4, 0.4],
                cd: 1200,
                mult: [2, 0.4],
                radius: [1.6, 0],
                hits: [3, 0],
                look: "doublestrafe",
                icon: "rain",
                tint: "#6ab04a",
                desc: "A fan of {hits} arrows bursts on the target: {mult}% attack in total around it."
            }, {
                id: "instinct",
                name: "Wild Instinct",
                kind: "passive",
                req: {
                    keeneye: 5
                },
                lvReq: 55,
                pas: {
                    crit: 0.006,
                    dmg: 0.012
                },
                icon: "falcon",
                tint: "#5a9a4a",
                desc: "+{crit}% crit and +{dmg}% damage."
            }, {
                id: "blasttrap",
                name: "Blast Trap",
                kind: "active",
                target: "ground",
                req: {
                    bola: 3
                },
                lvReq: 70,
                range: 6,
                sp: [6, 0.5],
                cd: 7000,
                cast: 400,
                radius: [2, 0.04],
                mult: [2.6, 0.52],
                knock: 1,
                look: "anklesnare",
                icon: "trap",
                tint: "#e8903a",
                desc: "A trap that bursts on everything over it, {mult}% attack, flinging them back."
            }, {
                id: "cometarrow",
                name: "Comet Arrow",
                kind: "active",
                target: "mob",
                req: {
                    piercing: 5,
                    scattershot: 5
                },
                lvReq: 85,
                range: 9,
                sp: [12, 0.8],
                cd: 10000,
                cast: 600,
                mult: [4, 0.8],
                radius: [2.2, 0.04],
                critBonus: 0.25,
                snd: "sharpshooting",
                icon: "arrow",
                tint: "#e8a83a",
                desc: "One arrow from high above, blazing like a comet: {mult}% attack where it lands, +25% crit."
            }, ],
        },
        priest: {
            name: "Priest",
            blurb: "Holy healer who shields the party and smites the dead.",
            role: "Support · Holy",
            weapon: "mace",
            hp: 1.2,
            sp: 1.4,
            atk: 1.42,
            def: 2,
            base: {
                str: 4,
                agi: 3,
                vit: 6,
                int: 9,
                dex: 5,
                luk: 3
            },
            w: {
                str: 0.18,
                agi: 0.05,
                int: 0.52,
                dex: 0.14
            },
            basic: {
                range: 1.6,
                cd: 620,
                mult: 0.95
            },
            skills: [{
                id: "sacredward",
                name: "Sacred Ward",
                kind: "passive",
                pas: {
                    def: 0.03
                },
                icon: "shield",
                desc: "+{def}% armour."
            }, {
                id: "mend",
                name: "Mend",
                kind: "active",
                target: "party",
                radius: [5, 0],
                sp: [10, 9.3],
                cd: 800,
                heal: [0.12, 0.03],
                lowest: true,
                look: "heal",
                icon: "heart",
                tint: "#5ac07a",
                desc: "Mend the most hurt ally near you (or yourself) for {heal}% of their HP."
            }, {
                id: "smite",
                name: "Smite",
                kind: "active",
                target: "mob",
                range: 6,
                sp: [12, 0],
                cd: 900,
                mult: [1.9, 0.38],
                bane: 1.5,
                look: "holylight",
                icon: "sun",
                tint: "#e8b83a",
                desc: "Strike with light, {mult}% attack; +{bane}% against undead and demons."
            }, {
                id: "benediction",
                name: "Benediction",
                kind: "active",
                target: "party",
                req: {
                    sacredward: 5
                },
                lvReq: 5,
                radius: [6, 0],
                sp: [22, 12.4],
                cd: 20000,
                buff: {
                    atk: [0.05, 0.015],
                    crit: [0.02, 0.006]
                },
                dur: [40000, 4000],
                look: "blessing",
                icon: "wing",
                desc: "+{atk}% attack and +{crit}% crit for your party, {dur}s."
            }, {
                id: "macetraining",
                name: "Mace Training",
                kind: "passive",
                lvReq: 5,
                pas: {
                    dmg: 0.03
                },
                icon: "mace",
                desc: "+{dmg}% damage."
            }, {
                id: "aegis",
                name: "Aegis",
                kind: "active",
                target: "party",
                req: {
                    benediction: 3
                },
                lvReq: 12,
                radius: [6, 0],
                sp: [16, 6.2],
                cd: 12000,
                buff: {
                    shield: [0.12, 0.03]
                },
                dur: [12000, 0],
                look: "kyrie",
                icon: "bubble",
                tint: "#6ab0e0",
                desc: "A barrier that absorbs {shield}% of max HP for your party, for {dur}s."
            }, {
                id: "hallowed",
                name: "Hallowed Ground",
                kind: "active",
                target: "ground",
                req: {
                    mend: 5
                },
                lvReq: 18,
                range: 6,
                sp: [12, 9.3],
                cd: 15000,
                radius: [2.3, 0.03],
                heal: [0.04, 0.008],
                mult: [1.3, 0.26],
                zone: {
                    dur: 6000,
                    tick: 1000
                },
                undeadOnly: true,
                look: "sanctuary",
                icon: "cross",
                tint: "#5ac08a",
                desc: "Holy ground for {zdur}s: allies on it heal {heal}% of max HP each second, and undead on it take {mult}% attack each second."
            }, {
                id: "dawnbreak",
                name: "Dawnbreak",
                kind: "active",
                target: "ground",
                req: {
                    smite: 5,
                    hallowed: 3
                },
                lvReq: 30,
                range: 7,
                sp: [32, 15.5],
                cd: 8000,
                cast: 1200,
                radius: [3, 0.05],
                mult: [1.39, 0.28],
                bane: 1.5,
                zone: {
                    dur: 4200,
                    tick: 700
                },
                look: "magnus",
                icon: "cross",
                tint: "#e8a83a",
                desc: "Spears of dawn scour an area for {zdur}s, {mult}% attack every {tick}s; +{bane}% against undead and demons."
            }, {
                id: "judgement",
                name: "Judgement",
                kind: "active",
                target: "mob",
                req: {
                    smite: 5
                },
                lvReq: 40,
                range: 6,
                sp: [16, 1],
                cd: 2500,
                mult: [2.1, 0.42],
                bane: 1.5,
                defDown: {
                    pct: [0.08, 0.012],
                    dur: 8000
                },
                look: "holylight",
                icon: "sun",
                tint: "#d8902a",
                desc: "Light that marks a foe: {mult}% attack and {def}% less armour for 8s; +{bane}% against undead and demons."
            }, {
                id: "serenity",
                name: "Serenity",
                kind: "passive",
                req: {
                    macetraining: 3
                },
                lvReq: 55,
                pas: {
                    sp: 0.02,
                    spRegen: 0.03,
                    hpRegen: 0.0008
                },
                icon: "drop",
                tint: "#5a8ae0",
                desc: "+{sp}% max SP, SP comes back {spRegen}% faster, and you regenerate {hpRegen}% of max HP a second."
            }, {
                id: "renewal",
                name: "Renewal",
                kind: "active",
                target: "party",
                req: {
                    mend: 5,
                    aegis: 3
                },
                lvReq: 70,
                radius: [6, 0],
                sp: [30, 8],
                cd: 20000,
                heal: [0.15, 0.02],
                buff: {
                    dr: [0.06, 0.01]
                },
                dur: [10000, 1000],
                look: "heal",
                icon: "heart",
                tint: "#3aa86a",
                desc: "Heal your party {heal}% of their HP; they take {dr}% less damage for {dur}s."
            }, {
                id: "choir",
                name: "Celestial Choir",
                kind: "active",
                target: "ground",
                req: {
                    dawnbreak: 5,
                    judgement: 3
                },
                lvReq: 85,
                range: 7,
                sp: [40, 10],
                cd: 16000,
                cast: 1200,
                radius: [3.2, 0.05],
                mult: [1.1, 0.22],
                heal: [0.03, 0.006],
                bane: 1.5,
                zone: {
                    dur: 5000,
                    tick: 1000
                },
                snd: "magnus",
                icon: "sun",
                tint: "#f0c040",
                desc: "Rings of light for {zdur}s: foes take {mult}% attack each second (+{bane}% against undead and demons), allies heal {heal}% of max HP."
            }, ],
        },
        assassin: {
            name: "Assassin",
            blurb: "Katar-wielding shadow: double strikes, poison and stealth.",
            role: "Melee · Burst",
            weapon: "katar",
            hp: 0.95,
            sp: 0.9,
            atk: 1.36,
            def: 1,
            base: {
                str: 6,
                agi: 9,
                vit: 4,
                int: 2,
                dex: 4,
                luk: 5
            },
            w: {
                str: 0.22,
                agi: 0.50,
                int: 0.04,
                dex: 0.16
            },
            basic: {
                range: 1.5,
                cd: 540,
                mult: 1.55
            },
            skills: [{
                id: "twinblades",
                name: "Twin Blades",
                kind: "passive",
                pas: {
                    dmg: 0.03
                },
                icon: "katar",
                desc: "+{dmg}% damage."
            }, {
                id: "flurry",
                name: "Flurry",
                kind: "passive",
                pas: {
                    double: 0.05
                },
                icon: "dagger2",
                desc: "{double}% chance for a normal attack to hit twice."
            }, {
                id: "venomstrike",
                name: "Venom Strike",
                kind: "active",
                target: "mob",
                range: 1.8,
                sp: [4, 0],
                cd: 800,
                mult: [0.82, 0.16],
                dot: {
                    dps: [0.3, 0.06],
                    dur: 8000
                },
                look: "envenom",
                icon: "drop",
                tint: "#6ab04a",
                desc: "A poisoned cut, {mult}% attack, then poison for {dotdur}s at {dot}% attack a second."
            }, {
                id: "shadowveil",
                name: "Shadow Veil",
                kind: "active",
                target: "self",
                lvReq: 5,
                sp: [5, 0.06],
                cd: 12000,
                buff: {
                    stealth: [0.3, 0.07]
                },
                dur: [3000, 500],
                look: "cloaking",
                icon: "mask",
                tint: "#5a5070",
                desc: "Fade from sight for {dur}s: monsters lose you, your next hit deals +{stealth}%."
            }, {
                id: "toxicedge",
                name: "Toxic Edge",
                kind: "active",
                target: "self",
                lvReq: 8,
                sp: [6, 0],
                cd: 30000,
                buff: {
                    poisonHit: [0.3, 0.03]
                },
                dur: [30000, 3000],
                look: "enchantpoison",
                icon: "flask",
                tint: "#6ab04a",
                desc: "Coat your blades for {dur}s: {poisonHit}% of your hits poison the foe (20% attack a second for 5s)."
            }, {
                id: "thousandcuts",
                name: "Thousand Cuts",
                kind: "active",
                target: "mob",
                req: {
                    twinblades: 4
                },
                lvReq: 10,
                range: 1.8,
                sp: [5, 0.12],
                cd: 1000,
                mult: [1.93, 0.39],
                hits: [8, 0],
                stun: {
                    chance: [0.12, 0],
                    dur: 1500
                },
                look: "sonicblow",
                icon: "slash",
                desc: "Eight cuts too quick to see, {mult}% attack in total; {chance}% to daze the foe for {sdur}s."
            }, {
                id: "shadowspikes",
                name: "Shadow Spikes",
                kind: "active",
                target: "mob",
                req: {
                    shadowveil: 2,
                    thousandcuts: 5
                },
                lvReq: 20,
                range: [3, 0.2],
                sp: [2, 0.06],
                cd: 900,
                mult: [0.97, 0.19],
                radius: [1.3, 0],
                look: "grimtooth",
                icon: "spikes",
                desc: "Spikes of shadow burst under a foe from afar, {mult}% attack around it."
            }, {
                id: "plagueseed",
                name: "Plague Seed",
                kind: "active",
                target: "mob",
                req: {
                    venomstrike: 5,
                    toxicedge: 3
                },
                lvReq: 30,
                range: 1.8,
                sp: [4, 0.12],
                cd: 5000,
                cast: 1500,
                mult: [1.99, 0.4],
                radius: [2, 0],
                look: "venomsplasher",
                icon: "skull",
                tint: "#5aa04a",
                desc: "Plant a seed of venom that bursts after 1.5s, {mult}% attack around the foe."
            }, {
                id: "shadowstep",
                name: "Shadow Step",
                kind: "active",
                target: "mob",
                req: {
                    shadowveil: 5,
                    thousandcuts: 5
                },
                lvReq: 40,
                range: [5, 0.2],
                sp: [5, 0.3],
                cd: 2500,
                mult: [3.75, 0.75],
                critBonus: 0.15,
                look: "grimtooth",
                icon: "mask",
                tint: "#4a3a60",
                desc: "Strike from the shadows at range, {mult}% attack, +15% crit."
            }, {
                id: "killerinstinct",
                name: "Killer Instinct",
                kind: "passive",
                req: {
                    twinblades: 5
                },
                lvReq: 55,
                pas: {
                    crit: 0.006,
                    dodgeCap: 0.01
                },
                icon: "dagger2",
                tint: "#8a3a6a",
                desc: "+{crit}% crit, and your dodge can climb {dodgeCap}% past the usual 35% cap (AGI beyond 100 keeps counting)."
            }, {
                id: "smokebomb",
                name: "Smoke Bomb",
                kind: "active",
                target: "self",
                req: {
                    shadowveil: 3
                },
                lvReq: 70,
                radius: [2.4, 0.04],
                sp: [8, 0.2],
                cd: 20000,
                stun: {
                    chance: [0.4, 0.03],
                    dur: 2000
                },
                buff: {
                    dr: [0.15, 0.02]
                },
                dur: [4000, 300],
                snd: "cloaking",
                icon: "mask",
                tint: "#7a7088",
                desc: "A burst of blinding smoke: {chance}% to daze each foe around for {sdur}s, and you take {dr}% less damage for {dur}s."
            }, {
                id: "deathlotus",
                name: "Death Lotus",
                kind: "active",
                target: "self",
                req: {
                    shadowstep: 5,
                    plagueseed: 3
                },
                lvReq: 85,
                radius: [2.6, 0.05],
                sp: [12, 0.5],
                cd: 11000,
                mult: [4.5, 0.9],
                hits: [10, 0],
                dot: {
                    dps: [0.4, 0.08],
                    dur: 6000
                },
                snd: "sonicblow",
                icon: "katar",
                tint: "#b04a8a",
                desc: "A whirl of blades like opening petals: {hits} cuts, {mult}% attack in total to all around, then poison for {dotdur}s at {dot}% attack a second."
            }, ],
        },
        blacksmith: {
            name: "Blacksmith",
            blurb: "Axe-swinging merchant who pays in gold for huge hits.",
            role: "Melee · Buffs",
            weapon: "axe",
            hp: 1.2,
            sp: 0.9,
            atk: 0.64,
            def: 3,
            base: {
                str: 9,
                agi: 5,
                vit: 6,
                int: 2,
                dex: 4,
                luk: 4
            },
            w: {
                str: 0.52,
                agi: 0.12,
                int: 0.04,
                dex: 0.16
            },
            basic: {
                range: 1.6,
                cd: 660,
                mult: 1.15
            },
            skills: [{
                id: "haggler",
                name: "Haggler",
                kind: "passive",
                pas: {
                    discount: 0.015
                },
                icon: "coin",
                tint: "#e0b03a",
                desc: "Shops charge {discount}% less and pay {discount}% more."
            }, {
                id: "coinsmash",
                name: "Coin Smash",
                kind: "active",
                target: "mob",
                range: 1.8,
                sp: [2, 0],
                cd: 700,
                mult: [2.53, 0.5],
                gold: [0, 0.02],
                look: "mammonite",
                icon: "coin",
                tint: "#e8a83a",
                desc: "Strike with a fistful of coins: {mult}% attack for a little gold."
            }, {
                id: "cartsweep",
                name: "Cart Sweep",
                kind: "active",
                target: "mob",
                lvReq: 8,
                range: 1.8,
                sp: [6, 0],
                cd: 1500,
                mult: [1.17, 0.23],
                radius: [1.8, 0],
                knock: 1,
                look: "cartrevolution",
                icon: "cart",
                desc: "Swing your cart through a crowd, {mult}% attack around the foe, knocking them back."
            }, {
                id: "forgecraft",
                name: "Forgecraft",
                kind: "passive",
                lvReq: 5,
                pas: {
                    dmg: 0.025,
                    crit: 0.005
                },
                icon: "gear",
                desc: "+{dmg}% damage and +{crit}% crit."
            }, {
                id: "quakehammer",
                name: "Quake Hammer",
                kind: "active",
                target: "self",
                req: {
                    forgecraft: 3
                },
                lvReq: 12,
                sp: [5, 0],
                cd: 4000,
                mult: [0.49, 0.1],
                radius: [2.2, 0.03],
                stun: {
                    chance: [0.3, 0.05],
                    dur: 3000
                },
                look: "hammerfall",
                icon: "hammer",
                desc: "Slam the ground: {mult}% attack around you, {chance}% to daze each foe for {sdur}s."
            }, {
                id: "wardrums",
                name: "War Drums",
                kind: "active",
                target: "party",
                req: {
                    quakehammer: 2
                },
                lvReq: 16,
                radius: [6, 0],
                sp: [10, 0.2],
                cd: 30000,
                buff: {
                    haste: [0.1, 0.015]
                },
                dur: [20000, 3000],
                look: "adrenaline",
                icon: "fist",
                desc: "+{haste}% attack speed for your party, {dur}s."
            }, {
                id: "temperededge",
                name: "Tempered Edge",
                kind: "active",
                target: "party",
                req: {
                    wardrums: 2
                },
                lvReq: 20,
                radius: [6, 0],
                sp: [8, 0.27],
                cd: 30000,
                buff: {
                    atk: [0.05, 0.02]
                },
                dur: [20000, 3000],
                look: "overthrust",
                icon: "up",
                desc: "+{atk}% attack for your party, {dur}s."
            }, {
                id: "overdrive",
                name: "Overdrive",
                kind: "active",
                target: "self",
                req: {
                    forgecraft: 5,
                    temperededge: 3
                },
                lvReq: 30,
                sp: [5, 0.14],
                cd: 40000,
                buff: {
                    atk: [0.15, 0.02],
                    crit: [0.1, 0.01]
                },
                dur: [10000, 1000],
                look: "maximize",
                icon: "star",
                desc: "Everything into it: +{atk}% attack and +{crit}% crit for {dur}s."
            }, {
                id: "goldrush",
                name: "Gold Rush",
                kind: "active",
                target: "mob",
                req: {
                    coinsmash: 8
                },
                lvReq: 40,
                range: 1.8,
                sp: [4, 0.3],
                cd: 1500,
                mult: [3.6, 0.72],
                gold: [1, 0.08],
                look: "mammonite",
                icon: "coin",
                tint: "#d89820",
                desc: "Pay well and hit hard: {mult}% attack for a purse of gold."
            }, {
                id: "hardhide",
                name: "Hardened Hide",
                kind: "passive",
                req: {
                    forgecraft: 5
                },
                lvReq: 55,
                pas: {
                    def: 0.02,
                    hp: 0.015
                },
                icon: "shield",
                tint: "#a07a4a",
                desc: "+{def}% armour and +{hp}% max HP."
            }, {
                id: "moltenstrike",
                name: "Molten Strike",
                kind: "active",
                target: "mob",
                req: {
                    cartsweep: 5
                },
                lvReq: 70,
                range: 1.8,
                sp: [6, 0.4],
                cd: 2500,
                mult: [2.4, 0.48],
                radius: [1.8, 0],
                dot: {
                    dps: [0.35, 0.07],
                    dur: 6000
                },
                look: "bowlingbash",
                icon: "fire",
                tint: "#e8603a",
                desc: "A red-hot blow that splashes, {mult}% attack around the foe, then it burns for {dotdur}s at {dot}% attack a second."
            }, {
                id: "anvildrop",
                name: "Anvil Drop",
                kind: "active",
                target: "ground",
                req: {
                    quakehammer: 5,
                    goldrush: 3
                },
                lvReq: 85,
                range: 6,
                sp: [12, 0.6],
                cd: 12000,
                cast: 900,
                radius: [2.8, 0.05],
                mult: [3.4, 0.68],
                stun: {
                    chance: [0.4, 0.03],
                    dur: 3000
                },
                snd: "hammerfall",
                icon: "hammer",
                tint: "#7a7a8a",
                desc: "A giant anvil from the sky: {mult}% attack to an area, {chance}% to daze each foe for {sdur}s."
            }, ],
        },
    };
    const CLASS_IDS = Object.keys(CLASSES);
    // characters made before the six classes existed move to the closest new one
    const OLD_CLASS = {
        warrior: "knight",
        paladin: "knight",
        berserker: "blacksmith",
        mage: "wizard",
        necromancer: "wizard",
        archer: "hunter",
        gunslinger: "hunter",
        cleric: "priest",
        rogue: "assassin"
    };
    const SKILLS = {};
    for (const c of CLASS_IDS)
        for (const sk of CLASSES[c].skills) {
            sk.cls = c;
            sk.max = SKILL_MAX;
            SKILLS[sk.id] = sk;
        }
    // value of a [base, perLevel] number at a skill level
    const sv = (v, lv) => Array.isArray(v) ? v[0] + v[1] * (Math.max(1, lv) - 1) : (v == null ? 0 : v);
    const skillLv = (talents, id) => Math.min(SKILL_MAX, (talents && talents[id]) | 0);
    // gold a cast costs (Coin Smash, Gold Rush): grows with the hero, a tenth more per skill level.
    // It used to be skill level x the rate, which at Lv 10 cost eight times what a Blacksmith earned
    // while spamming Coin Smash - the class went broke, then could not cast it at all.
    const skillGold = (sk, lv, heroLv) => sk.gold ? Math.max(1, Math.round((sk.gold[0] + sk.gold[1] * heroLv) * (1 + 0.1 * (Math.max(1, lv) - 1)))) : 0;
    // can this hero put one more point into the skill? returns "" or the reason it can't
    function canLearn(p, sk) {
        const lv = skillLv(p.talents, sk.id);
        if (lv >= SKILL_MAX)
            return "Maxed";
        if (p.lv < (sk.lvReq || 1))
            return `Needs Lv ${sk.lvReq}`;
        for (const [id,need] of Object.entries(sk.req || {}))
            if (skillLv(p.talents, id) < need)
                return `Needs ${SKILLS[id].name} ${need}`;
        return "";
    }
    const HOTBAR = 6;

    // ---------- monsters ----------
    // lvl drives loot quality and the level-gap rules. def soaks flat damage, so bosses never melt.
    // draw = sprite routine, scale = size, tint = body colour. Bosses also slam, summon and enrage.
    const MOB = {
        slime: {
            name: "Slime",
            lvl: 1,
            hp: 138,
            atk: 11,
            def: 3,
            xp: 6,
            gold: 2,
            spd: 1.5,
            aggro: 3.6,
            cd: 1.3,
            reach: 1.1,
            r: 0.32,
            respawn: 8000,
            draw: "slime",
            scale: 1,
            tint: "#6fcf6a"
        },
        wolf: {
            name: "Wolf",
            lvl: 3,
            hp: 258,
            atk: 15,
            def: 5,
            xp: 6,
            gold: 2,
            spd: 3.0,
            aggro: 3.7,
            cd: 1.0,
            reach: 1.1,
            r: 0.34,
            respawn: 9000,
            draw: "wolf",
            scale: 1,
            tint: "#6c6f78"
        },
        spider: {
            name: "Moss Spider",
            lvl: 6,
            hp: 559,
            atk: 26,
            def: 8,
            xp: 18,
            gold: 4,
            spd: 2.8,
            aggro: 3.7,
            cd: 1.0,
            reach: 1.1,
            r: 0.34,
            respawn: 10000,
            draw: "spider",
            scale: 1,
            tint: "#3e3a4c"
        },
        alpha: {
            name: "Alpha Wolf",
            lvl: 9,
            hp: 14153,
            atk: 42,
            def: 17,
            xp: 236,
            gold: 1708,
            spd: 3.2,
            aggro: 6,
            cd: 1.87,
            reach: 1.8,
            r: 0.7,
            respawn: 2400000,
            draw: "wolf",
            scale: 2,
            tint: "#34363e",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.12,
                radius: 3.2
            },
            adds: "wolf"
        },
        scorpion: {
            name: "Dune Scorpion",
            lvl: 9,
            hp: 773,
            atk: 36,
            def: 10,
            xp: 33,
            gold: 7,
            spd: 2.4,
            aggro: 3.8,
            cd: 1.1,
            reach: 1.2,
            r: 0.36,
            respawn: 10000,
            draw: "scorpion",
            scale: 1,
            tint: "#b0763a"
        },
        mummy: {
            name: "Mummy",
            lvl: 12,
            hp: 1204,
            atk: 52,
            def: 13,
            xp: 49,
            gold: 11,
            spd: 1.8,
            aggro: 3.9,
            cd: 1.3,
            reach: 1.2,
            r: 0.34,
            respawn: 11000,
            draw: "mummy",
            scale: 1,
            tint: "#cbbf9a"
        },
        queen: {
            name: "Scorpion Queen",
            lvl: 14,
            hp: 28084,
            atk: 64,
            def: 26,
            xp: 506,
            gold: 3248,
            spd: 2.2,
            aggro: 6,
            cd: 2.21,
            reach: 2.0,
            r: 0.8,
            respawn: 2400000,
            draw: "scorpion",
            scale: 2.2,
            tint: "#8a3d2a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.2,
                radius: 3.4
            },
            adds: "scorpion"
        },
        toad: {
            name: "Bog Toad",
            lvl: 14,
            hp: 1532,
            atk: 55,
            def: 14,
            xp: 60,
            gold: 13,
            spd: 2.0,
            aggro: 4.0,
            cd: 1.2,
            reach: 1.2,
            r: 0.36,
            respawn: 11000,
            draw: "toad",
            scale: 1,
            tint: "#6a8440"
        },
        lizard: {
            name: "Mire Lizard",
            lvl: 16,
            hp: 1967,
            atk: 59,
            def: 17,
            xp: 72,
            gold: 16,
            spd: 2.8,
            aggro: 4.0,
            cd: 1.0,
            reach: 1.2,
            r: 0.34,
            respawn: 11000,
            draw: "lizard",
            scale: 1,
            tint: "#3f7a6a"
        },
        bogking: {
            name: "Bog King",
            lvl: 19,
            hp: 48791,
            atk: 84,
            def: 34,
            xp: 855,
            gold: 4984,
            spd: 1.6,
            aggro: 6,
            cd: 2.55,
            reach: 2.2,
            r: 0.9,
            respawn: 2400000,
            draw: "toad",
            scale: 2.4,
            tint: "#3c5a28",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.27,
                radius: 3.8
            },
            adds: "toad"
        },
        skeleton: {
            name: "Skeleton",
            lvl: 19,
            hp: 2622,
            atk: 63,
            def: 19,
            xp: 91,
            gold: 20,
            spd: 2.2,
            aggro: 4.1,
            cd: 1.1,
            reach: 1.2,
            r: 0.34,
            respawn: 12000,
            draw: "skeleton",
            scale: 1,
            tint: "#d8d2c2"
        },
        ghost: {
            name: "Ash Wraith",
            lvl: 22,
            hp: 3503,
            atk: 78,
            def: 23,
            xp: 110,
            gold: 24,
            spd: 2.6,
            aggro: 4.2,
            cd: 1.2,
            reach: 1.2,
            r: 0.34,
            respawn: 12000,
            draw: "ghost",
            scale: 1,
            tint: "#b9d3e8"
        },
        golem: {
            name: "Ember Golem",
            lvl: 25,
            hp: 84743,
            atk: 117,
            def: 48,
            xp: 1370,
            gold: 7280,
            spd: 1.3,
            aggro: 6,
            cd: 3.06,
            reach: 1.9,
            r: 0.8,
            respawn: 2400000,
            draw: "golem",
            scale: 1,
            tint: "#5a5550",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.35,
                radius: 4
            },
            adds: "skeleton"
        },
        // --- deeper lands ---
        frostwolf: {
            name: "Frost Wolf",
            lvl: 27,
            hp: 5235,
            atk: 66,
            def: 29,
            xp: 143,
            gold: 31,
            spd: 3.4,
            aggro: 4.3,
            cd: 1.0,
            reach: 1.2,
            r: 0.36,
            respawn: 12000,
            draw: "wolf",
            scale: 1.1,
            tint: "#9fc6e8"
        },
        yeti: {
            name: "Frost Yeti",
            lvl: 30,
            hp: 6480,
            atk: 96,
            def: 33,
            xp: 163,
            gold: 36,
            spd: 2.0,
            aggro: 4.4,
            cd: 1.4,
            reach: 1.5,
            r: 0.45,
            respawn: 13000,
            draw: "yeti",
            scale: 1.2,
            tint: "#e4eef6"
        },
        jarl: {
            name: "Frost Jarl",
            lvl: 34,
            hp: 151886,
            atk: 146,
            def: 67,
            xp: 2326,
            gold: 11060,
            spd: 1.9,
            aggro: 7,
            cd: 2.55,
            reach: 2.4,
            r: 1.0,
            respawn: 2400000,
            draw: "yeti",
            scale: 2.4,
            tint: "#cfe6ff",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.42,
                radius: 4.4
            },
            adds: "frostwolf"
        },
        ashhound: {
            name: "Ash Hound",
            lvl: 36,
            hp: 9216,
            atk: 103,
            def: 40,
            xp: 204,
            gold: 45,
            spd: 3.6,
            aggro: 4.5,
            cd: 0.9,
            reach: 1.2,
            r: 0.36,
            respawn: 12000,
            draw: "wolf",
            scale: 1.15,
            tint: "#5a2f2a"
        },
        obsidian: {
            name: "Obsidian Golem",
            lvl: 40,
            hp: 11582,
            atk: 158,
            def: 47,
            xp: 232,
            gold: 51,
            spd: 1.6,
            aggro: 4.7,
            cd: 1.5,
            reach: 1.6,
            r: 0.5,
            respawn: 13000,
            draw: "golem",
            scale: 0.8,
            tint: "#2f2b35"
        },
        colossus: {
            name: "Cinder Colossus",
            lvl: 44,
            hp: 258230,
            atk: 184,
            def: 91,
            xp: 3623,
            gold: 15484,
            spd: 1.5,
            aggro: 7,
            cd: 2.72,
            reach: 2.6,
            r: 1.1,
            respawn: 2400000,
            draw: "golem",
            scale: 2,
            tint: "#3a2420",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.5,
                radius: 4.8
            },
            adds: "obsidian"
        },
        drowned: {
            name: "Drowned One",
            lvl: 46,
            hp: 15285,
            atk: 172,
            def: 55,
            xp: 274,
            gold: 60,
            spd: 2.2,
            aggro: 4.8,
            cd: 1.2,
            reach: 1.3,
            r: 0.36,
            respawn: 13000,
            draw: "mummy",
            scale: 1.1,
            tint: "#6fa6a0"
        },
        kraken: {
            name: "Kraken Spawn",
            lvl: 50,
            hp: 17759,
            atk: 172,
            def: 61,
            xp: 304,
            gold: 67,
            spd: 2.8,
            aggro: 4.9,
            cd: 1.1,
            reach: 1.4,
            r: 0.42,
            respawn: 13000,
            draw: "spider",
            scale: 1.4,
            tint: "#2f4f7a"
        },
        tidewrath: {
            name: "Tidewrath",
            lvl: 54,
            hp: 381814,
            atk: 224,
            def: 118,
            xp: 5154,
            gold: 20552,
            spd: 2.4,
            aggro: 7,
            cd: 2.38,
            reach: 2.6,
            r: 1.1,
            respawn: 2400000,
            draw: "spider",
            scale: 2.8,
            tint: "#1d3e63",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.58,
                radius: 5
            },
            adds: "kraken"
        },
        imp: {
            name: "Cinder Imp",
            lvl: 56,
            hp: 21961,
            atk: 174,
            def: 70,
            xp: 350,
            gold: 77,
            spd: 3.2,
            aggro: 5.1,
            cd: 1.0,
            reach: 1.2,
            r: 0.34,
            respawn: 13000,
            draw: "imp",
            scale: 1,
            tint: "#d0552f"
        },
        demon: {
            name: "Spire Demon",
            lvl: 60,
            hp: 24619,
            atk: 223,
            def: 75,
            xp: 381,
            gold: 84,
            spd: 2.6,
            aggro: 5.2,
            cd: 1.2,
            reach: 1.5,
            r: 0.44,
            respawn: 14000,
            draw: "imp",
            scale: 1.5,
            tint: "#7a2436"
        },
        gargoyle: {
            name: "Storm Gargoyle",
            lvl: 68,
            hp: 32802,
            atk: 207,
            def: 88,
            xp: 442,
            gold: 97,
            spd: 3.0,
            aggro: 5.4,
            cd: 1.1,
            reach: 1.4,
            r: 0.42,
            respawn: 14000,
            draw: "gargoyle",
            scale: 1,
            tint: "#7c8598"
        },
        stormknight: {
            name: "Storm Knight",
            lvl: 74,
            hp: 40608,
            atk: 251,
            def: 96,
            xp: 494,
            gold: 109,
            spd: 2.6,
            aggro: 5.6,
            cd: 1.2,
            reach: 1.6,
            r: 0.46,
            respawn: 15000,
            draw: "knight",
            scale: 1.1,
            tint: "#4a6fa5"
        },
        stormlord: {
            name: "Stormlord",
            lvl: 78,
            hp: 857306,
            atk: 314,
            def: 183,
            xp: 9701,
            gold: 34216,
            spd: 2.5,
            aggro: 8,
            cd: 2.21,
            reach: 3.0,
            r: 1.3,
            respawn: 2400000,
            draw: "knight",
            scale: 3,
            tint: "#2f4f86",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.7,
                radius: 5.8
            },
            adds: "gargoyle"
        },
        voidling: {
            name: "Voidling",
            lvl: 80,
            hp: 47554,
            atk: 230,
            def: 104,
            xp: 541,
            gold: 119,
            spd: 3.2,
            aggro: 5.7,
            cd: 1.0,
            reach: 1.3,
            r: 0.4,
            respawn: 15000,
            draw: "ghost",
            scale: 1.2,
            tint: "#9b7ad8"
        },
        voidreaver: {
            name: "Void Reaver",
            lvl: 85,
            hp: 53723,
            atk: 307,
            def: 111,
            xp: 580,
            gold: 128,
            spd: 2.4,
            aggro: 5.9,
            cd: 1.3,
            reach: 1.8,
            r: 0.6,
            respawn: 16000,
            draw: "golem",
            scale: 1.1,
            tint: "#3b2a55"
        },
        // The world boss. Not part of any zone's ladder and not in the bestiary's reckoning - it
        // comes round on its own clock, in the one place everybody can walk to, and it is written
        // to be unkillable alone: the health is a party's worth and the slam is a solo player's
        // whole life bar. Party scaling adds 55% health per extra fighter up to about five, so a
        // group always comes out ahead of the same people fighting it separately.
        // atk 320 left a hero of its level 14s to live - faster than potions heal - so only a party could
        // take it, on a server most often played alone. 230: ~29s, about seven potions a fight, still the worst.
        // the world boss: above the last zone's sovereign on every count, and meant for a full party
        hollowking: {
            name: "The Hollow King",
            lvl: 95,
            hp: 2600000,
            atk: 470,
            def: 240,
            xp: 25000,
            gold: 90000,
            spd: 2.0,
            aggro: 9,
            cd: 1.9,
            reach: 3.2,
            r: 1.4,
            respawn: 14400000,
            draw: "imp",
            scale: 3.4,
            tint: "#2e2a4a",
            boss: true,
            world: true,
            slam: {
                cd: 8000,
                mult: 2.2,
                radius: 7.0
            },
            adds: "ghost"
        },
        riftlord: {
            name: "Rift Sovereign",
            lvl: 90,
            hp: 1154448,
            atk: 358,
            def: 212,
            xp: 12408,
            gold: 41356,
            spd: 2.4,
            aggro: 8,
            cd: 2.04,
            reach: 3.2,
            r: 1.4,
            respawn: 2400000,
            draw: "imp",
            scale: 3.6,
            tint: "#4a2a6a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.7,
                radius: 6.4
            },
            adds: "voidling"
        },
        sovereign: {
            name: "Ashen Sovereign",
            lvl: 65,
            hp: 555176,
            atk: 261,
            def: 149,
            xp: 7089,
            gold: 26460,
            spd: 2.2,
            aggro: 8,
            cd: 2.21,
            reach: 3.0,
            r: 1.3,
            respawn: 2400000,
            draw: "imp",
            scale: 3.2,
            tint: "#5c1a2a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.7,
                radius: 5.6
            },
            adds: "demon"
        },

        // --- new wildlife, filling the thin level bands ---
        duskbat: {
            name: "Dusk Bat",
            lvl: 2,
            hp: 195,
            atk: 11,
            def: 4,
            xp: 6,
            gold: 2,
            spd: 3.4,
            aggro: 3.6,
            cd: 0.9,
            reach: 1.0,
            r: 0.3,
            respawn: 8000,
            draw: "bat",
            scale: 0.9,
            tint: "#6b5a7a"
        },
        sporecap: {
            name: "Spore Cap",
            lvl: 5,
            hp: 440,
            atk: 27,
            def: 7,
            xp: 14,
            gold: 3,
            spd: 1.4,
            aggro: 3.7,
            cd: 1.4,
            reach: 1.1,
            r: 0.34,
            respawn: 9000,
            draw: "sporecap",
            scale: 1,
            tint: "#c2554a"
        },
        dunecrab: {
            name: "Dune Crab",
            lvl: 11,
            hp: 1080,
            atk: 46,
            def: 12,
            xp: 44,
            gold: 10,
            spd: 2.0,
            aggro: 3.9,
            cd: 1.2,
            reach: 1.2,
            r: 0.36,
            respawn: 10000,
            draw: "crab",
            scale: 1,
            tint: "#c2764a"
        },
        bogwisp: {
            name: "Bog Wisp",
            lvl: 17,
            hp: 2166,
            atk: 65,
            def: 18,
            xp: 78,
            gold: 17,
            spd: 2.9,
            aggro: 4.0,
            cd: 1.1,
            reach: 1.6,
            r: 0.32,
            respawn: 11000,
            draw: "wisp",
            scale: 1,
            tint: "#7ad8a0"
        },
        cryptbat: {
            name: "Crypt Bat",
            lvl: 21,
            hp: 3255,
            atk: 68,
            def: 22,
            xp: 103,
            gold: 23,
            spd: 3.6,
            aggro: 4.1,
            cd: 0.9,
            reach: 1.1,
            r: 0.32,
            respawn: 11000,
            draw: "bat",
            scale: 1,
            tint: "#6b4a86"
        },
        graveserpent: {
            name: "Grave Serpent",
            lvl: 24,
            hp: 4114,
            atk: 84,
            def: 25,
            xp: 123,
            gold: 27,
            spd: 2.6,
            aggro: 4.2,
            cd: 1.2,
            reach: 1.4,
            r: 0.36,
            respawn: 12000,
            draw: "serpent",
            scale: 1,
            tint: "#5a4a6a"
        },
        rimewisp: {
            name: "Rime Wisp",
            lvl: 28,
            hp: 5594,
            atk: 75,
            def: 30,
            xp: 150,
            gold: 33,
            spd: 3.0,
            aggro: 4.3,
            cd: 1.1,
            reach: 1.6,
            r: 0.32,
            respawn: 12000,
            draw: "wisp",
            scale: 1,
            tint: "#9fd8ff"
        },
        frostelem: {
            name: "Frost Elemental",
            lvl: 32,
            hp: 7248,
            atk: 104,
            def: 35,
            xp: 177,
            gold: 39,
            spd: 2.0,
            aggro: 4.4,
            cd: 1.5,
            reach: 1.5,
            r: 0.42,
            respawn: 12000,
            draw: "elemental",
            scale: 1,
            tint: "#7fc2e8"
        },
        magmaserpent: {
            name: "Magma Serpent",
            lvl: 38,
            hp: 10151,
            atk: 132,
            def: 43,
            xp: 218,
            gold: 48,
            spd: 2.8,
            aggro: 4.6,
            cd: 1.1,
            reach: 1.4,
            r: 0.38,
            respawn: 13000,
            draw: "serpent",
            scale: 1.05,
            tint: "#7a2a2a"
        },
        ashwyvern: {
            name: "Ash Wyvern",
            lvl: 42,
            hp: 12524,
            atk: 152,
            def: 49,
            xp: 245,
            gold: 54,
            spd: 3.0,
            aggro: 4.7,
            cd: 1.2,
            reach: 1.6,
            r: 0.46,
            respawn: 13000,
            draw: "wyvern",
            scale: 1,
            tint: "#8a4a2a"
        },
        reefcrab: {
            name: "Reef Crab",
            lvl: 48,
            hp: 16424,
            atk: 183,
            def: 58,
            xp: 289,
            gold: 64,
            spd: 2.2,
            aggro: 4.9,
            cd: 1.3,
            reach: 1.4,
            r: 0.42,
            respawn: 13000,
            draw: "crab",
            scale: 1.1,
            tint: "#3a7a8a"
        },
        tideelem: {
            name: "Tide Elemental",
            lvl: 52,
            hp: 18908,
            atk: 205,
            def: 63,
            xp: 319,
            gold: 70,
            spd: 2.4,
            aggro: 5.0,
            cd: 1.4,
            reach: 1.6,
            r: 0.44,
            respawn: 13000,
            draw: "elemental",
            scale: 1.05,
            tint: "#3ab0c2"
        },
        emberwisp: {
            name: "Ember Wisp",
            lvl: 58,
            hp: 23333,
            atk: 181,
            def: 72,
            xp: 365,
            gold: 80,
            spd: 3.2,
            aggro: 5.1,
            cd: 1.0,
            reach: 1.6,
            r: 0.34,
            respawn: 14000,
            draw: "wisp",
            scale: 1.1,
            tint: "#ff8a3c"
        },
        spirewyvern: {
            name: "Spire Wyvern",
            lvl: 63,
            hp: 27421,
            atk: 240,
            def: 80,
            xp: 403,
            gold: 89,
            spd: 2.8,
            aggro: 5.3,
            cd: 1.3,
            reach: 1.8,
            r: 0.5,
            respawn: 14000,
            draw: "wyvern",
            scale: 1.15,
            tint: "#8a2a3a"
        },
        stormelem: {
            name: "Storm Elemental",
            lvl: 70,
            hp: 35074,
            atk: 253,
            def: 91,
            xp: 458,
            gold: 101,
            spd: 2.6,
            aggro: 5.5,
            cd: 1.3,
            reach: 1.7,
            r: 0.46,
            respawn: 15000,
            draw: "elemental",
            scale: 1.1,
            tint: "#6a9fe8"
        },
        thunderserpent: {
            name: "Thunder Serpent",
            lvl: 76,
            hp: 42924,
            atk: 238,
            def: 99,
            xp: 509,
            gold: 112,
            spd: 3.0,
            aggro: 5.6,
            cd: 1.1,
            reach: 1.5,
            r: 0.42,
            respawn: 15000,
            draw: "serpent",
            scale: 1.15,
            tint: "#3a6a8a"
        },
        riftwisp: {
            name: "Rift Wisp",
            lvl: 82,
            hp: 49850,
            atk: 238,
            def: 107,
            xp: 556,
            gold: 122,
            spd: 3.4,
            aggro: 5.8,
            cd: 1.0,
            reach: 1.7,
            r: 0.36,
            respawn: 15000,
            draw: "wisp",
            scale: 1.15,
            tint: "#b07ae8"
        },
        voidwyrm: {
            name: "Void Wyrm",
            lvl: 87,
            hp: 56534,
            atk: 315,
            def: 114,
            xp: 597,
            gold: 131,
            spd: 2.8,
            aggro: 5.9,
            cd: 1.3,
            reach: 1.7,
            r: 0.46,
            respawn: 16000,
            draw: "serpent",
            scale: 1.25,
            tint: "#6a3a9a"
        },

        // --- champions: one guards each land, tougher than a normal but no summons ---
        eldertreant: {
            name: "Elder Treant",
            lvl: 8,
            hp: 2553,
            atk: 38,
            def: 12,
            xp: 193,
            gold: 105,
            spd: 1.5,
            aggro: 6.0,
            cd: 1.7,
            reach: 1.9,
            r: 0.62,
            respawn: 1200000,
            draw: "treant",
            scale: 1.5,
            tint: "#5a7a3a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        carapacelord: {
            name: "Carapace Lord",
            lvl: 13,
            hp: 5310,
            atk: 59,
            def: 18,
            xp: 417,
            gold: 217,
            spd: 1.9,
            aggro: 6.0,
            cd: 1.6,
            reach: 1.9,
            r: 0.64,
            respawn: 1200000,
            draw: "crab",
            scale: 1.8,
            tint: "#b05a2a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        fenserpent: {
            name: "Fen Serpent",
            lvl: 18,
            hp: 9321,
            atk: 76,
            def: 25,
            xp: 651,
            gold: 336,
            spd: 2.4,
            aggro: 6.0,
            cd: 1.5,
            reach: 2.0,
            r: 0.66,
            respawn: 1200000,
            draw: "serpent",
            scale: 1.9,
            tint: "#3a6a4a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        bonewarden: {
            name: "Bone Warden",
            lvl: 24,
            hp: 15974,
            atk: 105,
            def: 34,
            xp: 963,
            gold: 497,
            spd: 2.3,
            aggro: 6.0,
            cd: 1.6,
            reach: 2.0,
            r: 0.66,
            respawn: 1200000,
            draw: "skeleton",
            scale: 1.9,
            tint: "#cfc8b0",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        glacierwarden: {
            name: "Glacier Warden",
            lvl: 33,
            hp: 30092,
            atk: 144,
            def: 49,
            xp: 1476,
            gold: 756,
            spd: 1.9,
            aggro: 6.0,
            cd: 1.7,
            reach: 2.0,
            r: 0.7,
            respawn: 1200000,
            draw: "elemental",
            scale: 1.8,
            tint: "#bfe8ff",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        cinderwyrm: {
            name: "Cinder Wyrm",
            lvl: 43,
            hp: 51084,
            atk: 181,
            def: 67,
            xp: 2070,
            gold: 1064,
            spd: 2.4,
            aggro: 6.0,
            cd: 1.6,
            reach: 2.2,
            r: 0.72,
            respawn: 1200000,
            draw: "wyvern",
            scale: 1.7,
            tint: "#a03a1a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        coralbehemoth: {
            name: "Coral Behemoth",
            lvl: 53,
            hp: 76465,
            atk: 238,
            def: 87,
            xp: 2739,
            gold: 1407,
            spd: 1.9,
            aggro: 6.0,
            cd: 1.8,
            reach: 2.2,
            r: 0.76,
            respawn: 1200000,
            draw: "crab",
            scale: 2.0,
            tint: "#2a6a7a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        flamewarden: {
            name: "Flame Warden",
            lvl: 64,
            hp: 110211,
            atk: 285,
            def: 109,
            xp: 3513,
            gold: 1806,
            spd: 2.3,
            aggro: 6.0,
            cd: 1.7,
            reach: 2.2,
            r: 0.74,
            respawn: 1200000,
            draw: "elemental",
            scale: 1.8,
            tint: "#ff7a3c",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        skywyrm: {
            name: "Sky Wyrm",
            lvl: 77,
            hp: 172143,
            atk: 336,
            def: 135,
            xp: 4524,
            gold: 2324,
            spd: 2.5,
            aggro: 6.0,
            cd: 1.6,
            reach: 2.4,
            r: 0.78,
            respawn: 1200000,
            draw: "wyvern",
            scale: 1.8,
            tint: "#2f4f86",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        riftwarden: {
            name: "Rift Warden",
            lvl: 89,
            hp: 231115,
            atk: 397,
            def: 157,
            xp: 5442,
            gold: 2793,
            spd: 2.4,
            aggro: 6.0,
            cd: 1.7,
            reach: 2.4,
            r: 0.78,
            respawn: 1200000,
            draw: "elemental",
            scale: 1.8,
            tint: "#a06ae8",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },

        // --- second lairs: another full boss for the four widest lands ---
        ashmaw: {
            name: "Ashmaw",
            lvl: 39,
            hp: 201489,
            atk: 168,
            def: 79,
            xp: 2945,
            gold: 13272,
            spd: 1.8,
            aggro: 7.0,
            cd: 2.55,
            reach: 2.6,
            r: 1.1,
            respawn: 2400000,
            draw: "wyvern",
            scale: 2.6,
            tint: "#8a3a1a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.36,
                radius: 4.5
            },
            adds: "ashhound"
        },
        deepcoil: {
            name: "Deepcoil",
            lvl: 49,
            hp: 318346,
            atk: 210,
            def: 106,
            xp: 4361,
            gold: 17976,
            spd: 2.2,
            aggro: 7.0,
            cd: 2.38,
            reach: 2.6,
            r: 1.1,
            respawn: 2400000,
            draw: "serpent",
            scale: 2.8,
            tint: "#2a5a7a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.42,
                radius: 4.8
            },
            adds: "drowned"
        },
        tempestwyrm: {
            name: "Tempest Wyrm",
            lvl: 71,
            hp: 685138,
            atk: 294,
            def: 166,
            xp: 8252,
            gold: 29904,
            spd: 2.4,
            aggro: 7.5,
            cd: 2.21,
            reach: 2.8,
            r: 1.2,
            respawn: 2400000,
            draw: "wyvern",
            scale: 2.8,
            tint: "#3a5f9a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.55,
                radius: 5.6
            },
            adds: "gargoyle"
        },
        nullseed: {
            name: "Nullseed",
            lvl: 84,
            hp: 997153,
            atk: 341,
            def: 197,
            xp: 11019,
            gold: 37716,
            spd: 2.2,
            aggro: 8.0,
            cd: 2.13,
            reach: 3.0,
            r: 1.3,
            respawn: 2400000,
            draw: "elemental",
            scale: 2.6,
            tint: "#8a5ad8",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.63,
                radius: 6.0
            },
            adds: "voidling"
        },

        // --- Fallen Sanctum (Lv 28-40): a temple whose guardians turned. Its set, Seraphic, is the healer's ---
        sentinel: {
            name: "Hallowed Sentinel",
            lvl: 29,
            hp: 6020,
            atk: 96,
            def: 32,
            xp: 156,
            gold: 34,
            spd: 2.2,
            aggro: 4.3,
            cd: 1.3,
            reach: 1.4,
            r: 0.42,
            respawn: 12000,
            draw: "knight",
            scale: 1,
            tint: "#d8c48a"
        },
        seraphwisp: {
            name: "Seraph Wisp",
            lvl: 31,
            hp: 6450,
            atk: 92,
            def: 32,
            xp: 166,
            gold: 37,
            spd: 3.0,
            aggro: 4.4,
            cd: 1.1,
            reach: 1.6,
            r: 0.32,
            respawn: 12000,
            draw: "wisp",
            scale: 1.05,
            tint: "#fff2b0"
        },
        marblegargoyle: {
            name: "Marble Gargoyle",
            lvl: 35,
            hp: 8310,
            atk: 118,
            def: 38,
            xp: 190,
            gold: 42,
            spd: 2.8,
            aggro: 4.5,
            cd: 1.2,
            reach: 1.4,
            r: 0.42,
            respawn: 13000,
            draw: "gargoyle",
            scale: 1,
            tint: "#e6e0d2"
        },
        acolyte: {
            name: "Fallen Acolyte",
            lvl: 38,
            hp: 9780,
            atk: 128,
            def: 42,
            xp: 212,
            gold: 47,
            spd: 2.4,
            aggro: 4.6,
            cd: 1.2,
            reach: 1.3,
            r: 0.36,
            respawn: 13000,
            draw: "ghost",
            scale: 1.05,
            tint: "#e8d8a8"
        },
        choirwarden: {
            name: "Choir Warden",
            lvl: 36,
            hp: 36500,
            atk: 158,
            def: 55,
            xp: 1650,
            gold: 850,
            spd: 2.0,
            aggro: 6.0,
            cd: 1.7,
            reach: 2.0,
            r: 0.7,
            respawn: 1200000,
            draw: "elemental",
            scale: 1.8,
            tint: "#ffe08a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        fallenseraph: {
            name: "The Fallen Seraph",
            lvl: 41,
            hp: 225000,
            atk: 175,
            def: 85,
            xp: 3250,
            gold: 14300,
            spd: 1.9,
            aggro: 7.0,
            cd: 2.6,
            reach: 2.6,
            r: 1.1,
            respawn: 2400000,
            draw: "knight",
            scale: 2.8,
            tint: "#c8a85a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.4,
                radius: 4.6
            },
            adds: "sentinel"
        },
        // --- Thornveil Jungle (Lv 68-80): deep green, fast hunters and things that grab ---
        raptor: {
            name: "Thornback Raptor",
            lvl: 68,
            hp: 33500,
            atk: 214,
            def: 88,
            xp: 445,
            gold: 98,
            spd: 3.4,
            aggro: 5.4,
            cd: 1.0,
            reach: 1.3,
            r: 0.4,
            respawn: 14000,
            draw: "lizard",
            scale: 1.2,
            tint: "#5a8a3a"
        },
        strangler: {
            name: "Vine Strangler",
            lvl: 71,
            hp: 36500,
            atk: 246,
            def: 92,
            xp: 468,
            gold: 103,
            spd: 2.6,
            aggro: 5.5,
            cd: 1.2,
            reach: 1.7,
            r: 0.42,
            respawn: 15000,
            draw: "serpent",
            scale: 1.15,
            tint: "#3f7a2a"
        },
        bloomlurker: {
            name: "Bloom Lurker",
            lvl: 74,
            hp: 39800,
            atk: 244,
            def: 95,
            xp: 490,
            gold: 108,
            spd: 1.8,
            aggro: 5.6,
            cd: 1.4,
            reach: 1.4,
            r: 0.42,
            respawn: 15000,
            draw: "sporecap",
            scale: 1.3,
            tint: "#d04a8a"
        },
        stalker: {
            name: "Jungle Stalker",
            lvl: 78,
            hp: 45500,
            atk: 262,
            def: 101,
            xp: 523,
            gold: 115,
            spd: 3.6,
            aggro: 5.7,
            cd: 0.9,
            reach: 1.2,
            r: 0.38,
            respawn: 15000,
            draw: "wolf",
            scale: 1.25,
            tint: "#2f4a2a"
        },
        ironbark: {
            name: "Ancient Ironbark",
            lvl: 75,
            hp: 165000,
            atk: 326,
            def: 131,
            xp: 4400,
            gold: 2260,
            spd: 1.6,
            aggro: 6.0,
            cd: 1.8,
            reach: 2.4,
            r: 0.78,
            respawn: 1200000,
            draw: "treant",
            scale: 2.0,
            tint: "#4a5a2a",
            mini: true,
            slam: {
                cd: 11000,
                mult: 1.1,
                radius: 2.8
            }
        },
        verdant: {
            name: "Verdant Colossus",
            lvl: 80,
            hp: 900000,
            atk: 322,
            def: 187,
            xp: 10100,
            gold: 35200,
            spd: 2.2,
            aggro: 8.0,
            cd: 2.2,
            reach: 3.0,
            r: 1.3,
            respawn: 2400000,
            draw: "treant",
            scale: 3.2,
            tint: "#3a6a2a",
            boss: true,
            slam: {
                cd: 9000,
                mult: 1.7,
                radius: 6.0
            },
            adds: "raptor"
        },

        // --- rare wanderers: seldom seen, heavy purses, two of them bolt when hurt ---
        gildedslime: {
            name: "Gilded Slime",
            lvl: 12,
            hp: 2012,
            atk: 50,
            def: 15,
            xp: 603,
            gold: 330,
            spd: 3.6,
            aggro: 6.0,
            cd: 1.4,
            reach: 1.1,
            r: 0.36,
            respawn: 260000,
            draw: "slime",
            scale: 1.4,
            tint: "#f2c14a",
            rare: true,
            flee: true
        },
        treasuremimic: {
            name: "Treasure Mimic",
            lvl: 40,
            hp: 29782,
            atk: 171,
            def: 54,
            xp: 3996,
            gold: 2156,
            spd: 2.2,
            aggro: 2.2,
            cd: 1.3,
            reach: 1.4,
            r: 0.5,
            respawn: 300000,
            draw: "mimic",
            scale: 1.5,
            tint: "#8a5f34",
            rare: true
        },
        starlitwisp: {
            name: "Starlit Wisp",
            lvl: 75,
            hp: 70104,
            atk: 263,
            def: 112,
            xp: 6525,
            gold: 3520,
            spd: 3.8,
            aggro: 6.5,
            cd: 1.1,
            reach: 1.6,
            r: 0.38,
            respawn: 320000,
            draw: "wisp",
            scale: 1.5,
            tint: "#ffe9a0",
            rare: true,
            flee: true
        },
    };

    // ---------- noise ----------
    function mulberry32(a) {
        return function() {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
        ;
    }
    function hash(x, y, s) {
        let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    function vnoise(x, y, sc, s) {
        const fx = x / sc
          , fy = y / sc
          , ix = Math.floor(fx)
          , iy = Math.floor(fy);
        let tx = fx - ix
          , ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const a = hash(ix, iy, s)
          , b = hash(ix + 1, iy, s)
          , c = hash(ix, iy + 1, s)
          , d = hash(ix + 1, iy + 1, s);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
    const fbm = (x, y, s) => 0.62 * vnoise(x, y, 10, s) + 0.38 * vnoise(x, y, 4, s + 7);

    // ---------- maps ----------
    // Ember Vale is the hub. Four roads leave it, one to each side, and each runs three lands deep,
    // so the world reads as a cross with the town in the middle (it used to be one land north, east
    // and south and four in a row west - the world map leaned hard to the left).
    const THEMES = {
        //        river  pools  groves (open-ground clumps)  rockGroves (share of rock)  rock/lone (single rocks/trees)  rockEdge  decor
        //        fill: how much of the land between the roads is thicket or crag (the roads and camps are cut through it)
        vale: {
            river: 1,
            pools: 3,
            groves: 1.0,
            rockGroves: 0.10,
            rock: 0.006,
            lone: 0.010,
            rockEdge: 0.15,
            decor: 0.05,
            fill: 0
        },
        woods: {
            river: 0,
            pools: 3,
            groves: 0.5,
            rockGroves: 0.08,
            rock: 0.004,
            lone: 0.020,
            rockEdge: 0.10,
            decor: 0.08,
            fill: 0.46
        },
        dunes: {
            river: 0,
            pools: 3,
            groves: 0.4,
            rockGroves: 0.70,
            rock: 0.012,
            lone: 0.006,
            rockEdge: 0.60,
            decor: 0.04,
            fill: 0.26
        },
        marsh: {
            river: 1,
            pools: 9,
            groves: 0.4,
            rockGroves: 0.05,
            rock: 0.002,
            lone: 0.016,
            rockEdge: 0.10,
            decor: 0.07,
            fill: 0.34
        },
        crypt: {
            river: 0,
            pools: 3,
            groves: 0.4,
            rockGroves: 0.55,
            rock: 0.010,
            lone: 0.006,
            rockEdge: 0.60,
            decor: 0.03,
            fill: 0.42
        },
        frost: {
            river: 1,
            pools: 2,
            groves: 0.4,
            rockGroves: 0.45,
            rock: 0.008,
            lone: 0.010,
            rockEdge: 0.40,
            decor: 0.05,
            fill: 0.44
        },
        waste: {
            river: 0,
            pools: 6,
            groves: 0.4,
            rockGroves: 0.70,
            rock: 0.014,
            lone: 0.006,
            rockEdge: 0.60,
            decor: 0.04,
            fill: 0.32
        },
        sunken: {
            river: 1,
            pools: 6,
            groves: 0.4,
            rockGroves: 0.25,
            rock: 0.004,
            lone: 0.014,
            rockEdge: 0.30,
            decor: 0.06,
            fill: 0.36
        },
        spire: {
            river: 0,
            pools: 5,
            groves: 0.4,
            rockGroves: 0.60,
            rock: 0.012,
            lone: 0.006,
            rockEdge: 0.60,
            decor: 0.03,
            fill: 0.40
        },
        storm: {
            river: 0,
            pools: 2,
            groves: 0.4,
            rockGroves: 0.45,
            rock: 0.010,
            lone: 0.008,
            rockEdge: 0.50,
            decor: 0.04,
            fill: 0.34
        },
        void: {
            river: 0,
            pools: 5,
            groves: 0.4,
            rockGroves: 0.35,
            rock: 0.008,
            lone: 0.010,
            rockEdge: 0.40,
            decor: 0.05,
            fill: 0.38
        },
        sanctum: {
            river: 0,
            pools: 4,
            groves: 0.4,
            rockGroves: 0.55,
            rock: 0.008,
            lone: 0.008,
            rockEdge: 0.50,
            decor: 0.06,
            fill: 0.36
        },
        jungle: {
            river: 1,
            pools: 4,
            groves: 0.6,
            rockGroves: 0.10,
            rock: 0.003,
            lone: 0.024,
            rockEdge: 0.10,
            decor: 0.09,
            fill: 0.50
        },
    };
    // Ember Vale grew from 72 to 88 tiles, and its walled city from 33 to 41 across: it felt cramped,
    // shops and people stood in the gates. The layout was drawn for the old size (centre 36), so
    // every town coordinate goes through townXY(): pushed out from the centre by TOWN_K, sizes kept.
    // The wild lands grew from 64 to 96 tiles across, with room for camps and roads three wide.
    const V = 88
      , VC = 44
      , M = 96
      , MC = 48;
    // (named townXY, not town: buildMap has a local `town` flag that would shadow it)
    const TOWN_K = 1.25
      , townXY = v => VC + (v - 36) * TOWN_K
      , tc = v => Math.round(townXY(v))
      , tp = v => Math.round(townXY(v) * 10) / 10;
    // a gate on the middle of a side of a wild land, and the arrival point a few steps in from it
    const GATE = {
        n: {
            x: MC + 1,
            y: 2.5
        },
        s: {
            x: MC + 1,
            y: M - 2.5
        },
        w: {
            x: 2.5,
            y: MC + 1
        },
        e: {
            x: M - 2.5,
            y: MC + 1
        }
    };
    const IN = {
        n: {
            x: MC + 1,
            y: 6
        },
        s: {
            x: MC + 1,
            y: M - 6
        },
        w: {
            x: 6,
            y: MC + 1
        },
        e: {
            x: M - 6,
            y: MC + 1
        }
    };
    const gate = (side, to) => ({
        ...GATE[side],
        to
    });
    // spawns: n is a share, not a count - buildMap scales every land to the same crowd for its size (MOB_DENSITY)
    const MAP_DEFS = [{
        id: 0,
        key: "vale",
        name: "Ember Vale",
        lv: "Lv 1–5",
        theme: "vale",
        size: V,
        seed: 101,
        town: true,
        entry: {
            x: VC + 1,
            y: VC + 4.5
        },
        lair: {
            x: 10,
            y: 10,
            boss: "hollowking"
        },
        spawns: [{
            type: "slime",
            n: 15,
            zone: [0.14, 0.55]
        }, {
            type: "duskbat",
            n: 12,
            zone: [0.2, 0.8]
        }, {
            type: "wolf",
            n: 12,
            zone: [0.45, 1]
        }],
        portals: [{
            x: VC + 1,
            y: 2.5,
            to: 1
        }, {
            x: V - 2.5,
            y: VC + 1,
            to: 2
        }, {
            x: VC + 1,
            y: V - 2.5,
            to: 3
        }, {
            x: 2.5,
            y: VC + 1,
            to: 4
        }]
    }, // north: Whisperwood, Frostpeak Pass, Stormspire Citadel
    {
        id: 1,
        key: "woods",
        name: "Whisperwood",
        lv: "Lv 4–9",
        theme: "woods",
        size: M,
        seed: 202,
        entry: IN.s,
        lair: {
            x: MC - 20,
            y: 16,
            boss: "alpha"
        },
        spawns: [{
            type: "wolf",
            n: 8,
            zone: [0.12, 0.5]
        }, {
            type: "sporecap",
            n: 10,
            zone: [0.2, 0.8]
        }, {
            type: "eldertreant",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "gildedslime",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "spider",
            n: 11,
            zone: [0.35, 1]
        }],
        portals: [gate("s", 0), gate("n", 5)]
    }, {
        id: 5,
        key: "frost",
        name: "Frostpeak Pass",
        lv: "Lv 26–34",
        theme: "frost",
        size: M,
        seed: 606,
        entry: IN.s,
        lair: {
            x: MC + 20,
            y: 16,
            boss: "jarl"
        },
        spawns: [{
            type: "frostwolf",
            n: 15,
            zone: [0.12, 0.55]
        }, {
            type: "rimewisp",
            n: 13,
            zone: [0.2, 0.7]
        }, {
            type: "frostelem",
            n: 13,
            zone: [0.5, 1]
        }, {
            type: "glacierwarden",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "yeti",
            n: 14,
            zone: [0.45, 1]
        }],
        portals: [gate("s", 1), gate("n", 9)]
    }, {
        id: 9,
        key: "storm",
        name: "Stormspire Citadel",
        lv: "Lv 66–78",
        theme: "storm",
        size: M,
        seed: 1010,
        entry: IN.s,
        lair: {
            x: MC + 1,
            y: 15,
            boss: "stormlord"
        },
        lair2: {
            x: M - 17,
            y: MC - 6,
            boss: "tempestwyrm"
        },
        spawns: [{
            type: "gargoyle",
            n: 14,
            zone: [0.12, 0.55]
        }, {
            type: "stormelem",
            n: 12,
            zone: [0.2, 0.7]
        }, {
            type: "thunderserpent",
            n: 12,
            zone: [0.5, 1]
        }, {
            type: "skywyrm",
            n: 1,
            zone: [0.55, 0.9]
        }, {
            type: "starlitwisp",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "stormknight",
            n: 13,
            zone: [0.45, 1]
        }],
        portals: [gate("s", 5)]
    }, // east: Sunscar Dunes, Obsidian Wastes, Void Rift
    {
        id: 2,
        key: "dunes",
        name: "Sunscar Dunes",
        lv: "Lv 8–14",
        theme: "dunes",
        size: M,
        seed: 303,
        entry: IN.w,
        lair: {
            x: M - 17,
            y: MC - 20,
            boss: "queen"
        },
        spawns: [{
            type: "scorpion",
            n: 22,
            zone: [0.12, 0.55]
        }, {
            type: "dunecrab",
            n: 22,
            zone: [0.2, 0.8]
        }, {
            type: "carapacelord",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "gildedslime",
            n: 1,
            zone: [0.3, 1]
        }, {
            type: "mummy",
            n: 20,
            zone: [0.45, 1]
        }],
        portals: [gate("w", 0), gate("e", 6)]
    }, {
        id: 6,
        key: "waste",
        name: "Obsidian Wastes",
        lv: "Lv 35–44",
        theme: "waste",
        size: M,
        seed: 707,
        entry: IN.w,
        lair: {
            x: M - 17,
            y: MC + 20,
            boss: "colossus"
        },
        lair2: {
            x: MC - 4,
            y: 16,
            boss: "ashmaw"
        },
        spawns: [{
            type: "ashhound",
            n: 14,
            zone: [0.12, 0.55]
        }, {
            type: "magmaserpent",
            n: 12,
            zone: [0.2, 0.7]
        }, {
            type: "ashwyvern",
            n: 12,
            zone: [0.5, 1]
        }, {
            type: "cinderwyrm",
            n: 1,
            zone: [0.55, 0.9]
        }, {
            type: "treasuremimic",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "obsidian",
            n: 13,
            zone: [0.45, 1]
        }],
        portals: [gate("w", 2), gate("e", 10)]
    }, {
        id: 10,
        key: "void",
        name: "Void Rift",
        lv: "Lv 79–90",
        theme: "void",
        size: M,
        seed: 1111,
        entry: IN.w,
        lair: {
            x: M - 15,
            y: MC + 1,
            boss: "riftlord"
        },
        lair2: {
            x: MC + 6,
            y: M - 16,
            boss: "nullseed"
        },
        spawns: [{
            type: "voidling",
            n: 12,
            zone: [0.12, 0.55]
        }, {
            type: "riftwisp",
            n: 10,
            zone: [0.2, 0.7]
        }, {
            type: "voidwyrm",
            n: 10,
            zone: [0.5, 1]
        }, {
            type: "riftwarden",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "starlitwisp",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "voidreaver",
            n: 11,
            zone: [0.45, 1]
        }],
        portals: [gate("w", 6)]
    }, // south: Mirefen, Sunken Hollow, Thornveil Jungle
    {
        id: 3,
        key: "marsh",
        name: "Mirefen",
        lv: "Lv 13–19",
        theme: "marsh",
        size: M,
        seed: 404,
        entry: IN.n,
        lair: {
            x: MC + 20,
            y: M - 17,
            boss: "bogking"
        },
        spawns: [{
            type: "toad",
            n: 17,
            zone: [0.12, 0.55]
        }, {
            type: "bogwisp",
            n: 18,
            zone: [0.2, 0.8]
        }, {
            type: "fenserpent",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "lizard",
            n: 18,
            zone: [0.45, 1]
        }],
        portals: [gate("n", 0), gate("s", 7)]
    }, {
        id: 7,
        key: "sunken",
        name: "Sunken Hollow",
        lv: "Lv 45–54",
        theme: "sunken",
        size: M,
        seed: 808,
        entry: IN.n,
        lair: {
            x: MC - 20,
            y: M - 17,
            boss: "tidewrath"
        },
        lair2: {
            x: M - 16,
            y: MC + 2,
            boss: "deepcoil"
        },
        spawns: [{
            type: "drowned",
            n: 12,
            zone: [0.12, 0.55]
        }, {
            type: "reefcrab",
            n: 10,
            zone: [0.2, 0.7]
        }, {
            type: "tideelem",
            n: 10,
            zone: [0.5, 1]
        }, {
            type: "coralbehemoth",
            n: 1,
            zone: [0.55, 0.9]
        }, {
            type: "treasuremimic",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "kraken",
            n: 11,
            zone: [0.45, 1]
        }],
        portals: [gate("n", 3), gate("s", 12)]
    }, {
        id: 12,
        key: "jungle",
        name: "Thornveil Jungle",
        lv: "Lv 68–80",
        theme: "jungle",
        size: M,
        seed: 1313,
        entry: IN.n,
        lair: {
            x: MC + 1,
            y: M - 15,
            boss: "verdant"
        },
        spawns: [{
            type: "raptor",
            n: 14,
            zone: [0.12, 0.55]
        }, {
            type: "strangler",
            n: 12,
            zone: [0.2, 0.75]
        }, {
            type: "bloomlurker",
            n: 12,
            zone: [0.4, 1]
        }, {
            type: "ironbark",
            n: 1,
            zone: [0.55, 0.9]
        }, {
            type: "starlitwisp",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "stalker",
            n: 12,
            zone: [0.5, 1]
        }],
        portals: [gate("n", 7)]
    }, // west: Ashen Crypt, Fallen Sanctum, Infernal Spire
    {
        id: 4,
        key: "crypt",
        name: "Ashen Crypt",
        lv: "Lv 18–25",
        theme: "crypt",
        size: M,
        seed: 505,
        entry: IN.e,
        lair: {
            x: 16,
            y: MC - 20,
            boss: "golem"
        },
        spawns: [{
            type: "skeleton",
            n: 11,
            zone: [0.12, 0.55]
        }, {
            type: "cryptbat",
            n: 9,
            zone: [0.2, 0.7]
        }, {
            type: "graveserpent",
            n: 9,
            zone: [0.5, 1]
        }, {
            type: "bonewarden",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "ghost",
            n: 10,
            zone: [0.45, 1]
        }],
        portals: [gate("e", 0), gate("w", 11)]
    }, {
        id: 11,
        key: "sanctum",
        name: "Fallen Sanctum",
        lv: "Lv 28–40",
        theme: "sanctum",
        size: M,
        seed: 1212,
        entry: IN.e,
        lair: {
            x: 16,
            y: MC + 20,
            boss: "fallenseraph"
        },
        spawns: [{
            type: "sentinel",
            n: 14,
            zone: [0.12, 0.55]
        }, {
            type: "seraphwisp",
            n: 12,
            zone: [0.2, 0.75]
        }, {
            type: "marblegargoyle",
            n: 12,
            zone: [0.4, 1]
        }, {
            type: "choirwarden",
            n: 1,
            zone: [0.55, 0.9]
        }, {
            type: "gildedslime",
            n: 1,
            zone: [0.4, 1]
        }, {
            type: "acolyte",
            n: 12,
            zone: [0.5, 1]
        }],
        portals: [gate("e", 4), gate("w", 8)]
    }, {
        id: 8,
        key: "spire",
        name: "Infernal Spire",
        lv: "Lv 55–65",
        theme: "spire",
        size: M,
        seed: 909,
        entry: IN.e,
        lair: {
            x: 15,
            y: MC + 1,
            boss: "sovereign"
        },
        spawns: [{
            type: "imp",
            n: 11,
            zone: [0.12, 0.55]
        }, {
            type: "emberwisp",
            n: 10,
            zone: [0.2, 0.7]
        }, {
            type: "spirewyvern",
            n: 10,
            zone: [0.5, 1]
        }, {
            type: "flamewarden",
            n: 1,
            zone: [0.6, 0.95]
        }, {
            type: "demon",
            n: 11,
            zone: [0.45, 1]
        }],
        portals: [gate("e", 11)]
    }, ].sort( (a, b) => a.id - b.id);
    // written by road, kept by id: MAPS[id] is the land with that id
    // Where you land when you step through a gate: a few steps in from the gate on the other side
    // that leads back - worked out from the gates, so a new road cannot be left without one.
    for (const d of MAP_DEFS)
        for (const p of d.portals) {
            const back = MAP_DEFS[p.to].portals.find(q => q.to === d.id)
              , N = MAP_DEFS[p.to].size
              , c = N / 2;
            if (!back)
                throw new Error(`[world] the gate from ${d.name} to ${MAP_DEFS[p.to].name} has no way back`);
            const dx = back.x - c
              , dy = back.y - c
              , L = Math.hypot(dx, dy) || 1;
            p.tx = Math.round((back.x - dx / L * 3.5) * 10) / 10;
            p.ty = Math.round((back.y - dy / L * 3.5) * 10) / 10;
        }

    const NPC = {
        map: 0,
        x: tp(44.5),
        y: tp(34.7)
    };
    // Maren, in front of her forge on the east street
    const ARMORY = {
        map: 0,
        x: 54.5,
        y: 55.2
    };
    // Brann, at his armoury door on the south ring road
    const RESETTER = {
        map: 0,
        x: 32,
        y: 37.5
    };
    // Sister Liora, by the chapel steps: resets attributes and skills
    const APOTHECARY = {
        map: 0,
        x: tp(30),
        y: tp(40.5)
    };
    // Yala, at her herb stall on the west plaza: potions
    // Selling, refining and storage happen at a counter in town, not from the bag anywhere:
    const TRADER = {
        map: 0,
        x: tp(33),
        y: tp(34.2)
    };
    // Tomas, at the plaza stall: buys what you bring, sells supplies
    const VAULT = {
        map: 0,
        x: tp(27),
        y: tp(46.6)
    };
    // Odo, at the inn door: keeps your storage
    const CURIO = {
        map: 0,
        x: tp(43.5),
        y: tp(26.6)
    };
    // Vesna, at her house: rare and epic gear, new stock every day
    const CARDS = {
        map: 0,
        x: 49,
        y: 26.5
    };
    // Pell, in the north-east quarter (off the street - he used to stand in the gate road): copies of cards for monsters you have mastered
    const MARKET = {
        map: 0,
        x: 38.5,
        y: 37.5
    };
    // Ines, on the grass north-west of the plaza: the market board, where players sell to players
    const TAILOR = {
        map: 0,
        x: 48.5,
        y: 37.5
    };
    // Lio, on the grass north-east of the plaza: dyes, titles, name colours, footstep trails
    const SEALS = {
        map: 0,
        x: 41.5,
        y: 54.5
    };
    // Garrick, south of the plaza: trades Boss Seals for charms, chests and trophies
    // What a Boss Seal buys. Seals come from bosses and champions - every hero who was in on the
    // kill gets the full number, never a share - so a boss fought as a party pays each of them.
    const SEAL_SHOP = [{
        id: "safe",
        name: "Safeguard charm",
        seals: 4,
        desc: "Keeps a refine step on a failed try. Used before gold."
    }, {
        id: "ward",
        name: "Ward charm",
        seals: 6,
        desc: "Stops a refine try breaking the piece. Used before gold."
    }, {
        id: "spread",
        name: "An extra card spread",
        seals: 5,
        desc: "Pell lays out one more spread for you today."
    }, {
        id: "chest",
        name: "Epic chest",
        seals: 50,
        desc: "An Epic piece for your level, in the slot you choose.",
        slot: true
    }, {
        id: "cos:bossbreaker",
        name: "Title: Bossbreaker",
        seals: 40,
        desc: "Worn under your name. Only Garrick has it."
    }, {
        id: "cos:sealfire",
        name: "Trail: Seal Fire",
        seals: 60,
        desc: "Blue fire where you walk. Only Garrick has it."
    }, ];
    // What Lio sells. None of it makes a hero any stronger, so it can be dear: it is where gold goes
    // once a hero has everything else. A dye is paid each time; the rest is bought once and kept.
    const COSMETICS = {
        dyes: [...["#f08a3c", "#5fb3d9", "#9b7ad8", "#6fcf97", "#e0607e", "#e8c25a"].map(c => ({
            c,
            price: 20000
        })), {
            c: "#3a3a4a",
            name: "Midnight",
            price: 120000
        }, {
            c: "#f4f1ea",
            name: "Snow",
            price: 120000
        }, {
            c: "#b8322a",
            name: "Crimson",
            price: 120000
        }, {
            c: "#1aa58e",
            name: "Teal",
            price: 120000
        }, {
            c: "#c9a227",
            name: "Old gold",
            price: 200000
        }, {
            c: "#6a3fa0",
            name: "Royal",
            price: 200000
        }, ],
        titles: [{
            id: "bold",
            name: "the Bold",
            price: 50000
        }, {
            id: "wanderer",
            name: "Wanderer",
            price: 80000
        }, {
            id: "slimebane",
            name: "Slimebane",
            price: 100000
        }, {
            id: "lucky",
            name: "Lucky Charm",
            price: 150000
        }, {
            id: "guardian",
            name: "Vale Guardian",
            price: 300000
        }, {
            id: "dragonheart",
            name: "Dragonheart",
            price: 600000
        }, {
            id: "legend",
            name: "Living Legend",
            price: 1500000
        }, {
            id: "bossbreaker",
            name: "Bossbreaker",
            price: 0,
            seals: 40
        }, ],
        names: [{
            id: "gold",
            name: "Gold",
            c: "#ffd25a",
            price: 150000
        }, {
            id: "sky",
            name: "Sky",
            c: "#8fd3ff",
            price: 100000
        }, {
            id: "rose",
            name: "Rose",
            c: "#ff9ec0",
            price: 100000
        }, {
            id: "mint",
            name: "Mint",
            c: "#9df0b8",
            price: 100000
        }, {
            id: "violet",
            name: "Violet",
            c: "#c9a8ff",
            price: 150000
        }, {
            id: "flame",
            name: "Flame",
            c: "#ff8a4a",
            price: 200000
        }, ],
        trails: [{
            id: "sparkle",
            name: "Sparkles",
            c: "#ffe27a",
            price: 150000
        }, {
            id: "leaf",
            name: "Falling leaves",
            c: "#7ccf6a",
            price: 150000
        }, {
            id: "ember",
            name: "Embers",
            c: "#ff8a3a",
            price: 200000
        }, {
            id: "frost",
            name: "Frost",
            c: "#a8e4ff",
            price: 200000
        }, {
            id: "heart",
            name: "Hearts",
            c: "#ff7aa8",
            price: 250000
        }, {
            id: "star",
            name: "Starfall",
            c: "#c9b4ff",
            price: 400000
        }, {
            id: "sealfire",
            name: "Seal Fire",
            c: "#7fd0ff",
            price: 0,
            seals: 60
        }, ],
    };
    const NPC_RANGE = 2.8;
    // how close counts as standing at a counter
    const SPAWN = {
        map: 0,
        x: VC + 1,
        y: VC + 4.5
    };
    const FOUNTAIN = {
        x: VC,
        y: VC
    };
    // top-left tile of the 2x2 fountain in the plaza

    // ---------- map building ----------
    // Maps are designed from a recipe rather than raw noise: a winding road network ties the portals
    // and boss lairs together, groves and rock outcrops sit in open meadows, rivers cross with bridges,
    // and a walled city with streets, plaza and buildings sits in the middle of Ember Vale.
    const CITY = {
        x0: tc(20),
        y0: tc(20),
        x1: tc(52),
        y1: tc(52)
    };
    // walls of the city (tiles, inclusive): 24..64
    // buildings in the city: footprint in tiles; the renderer draws them, the tiles are solid
    const CITY_BUILDINGS = [{
        kind: "forge",
        x: 42,
        y: 30,
        w: 5,
        h: 4,
        name: "Maren's Forge"
    }, {
        kind: "armory",
        x: 42,
        y: 40,
        w: 5,
        h: 4,
        name: "Brann's Armory"
    }, {
        kind: "chapel",
        x: 24,
        y: 23,
        w: 6,
        h: 6,
        name: "Chapel"
    }, {
        kind: "inn",
        x: 24,
        y: 41,
        w: 6,
        h: 5,
        name: "The Ember Inn"
    }, {
        kind: "house",
        x: 31,
        y: 24,
        w: 3,
        h: 3
    }, {
        kind: "house",
        x: 42,
        y: 23,
        w: 3,
        h: 3
    }, {
        kind: "house",
        x: 47,
        y: 24,
        w: 3,
        h: 3
    }, {
        kind: "house",
        x: 31,
        y: 46,
        w: 3,
        h: 3
    }, {
        kind: "house",
        x: 41,
        y: 47,
        w: 3,
        h: 3
    }, {
        kind: "tower",
        x: 47,
        y: 45,
        w: 3,
        h: 3,
        name: "Watchtower"
    }, ].map(b => ({
        ...b,
        x: Math.round(townXY(b.x + b.w / 2) - b.w / 2),
        y: Math.round(townXY(b.y + b.h / 2) - b.h / 2)
    }));
    // centres spread with the town (so the shopkeepers still stand at their doors); footprints unchanged
    // decorations inside the city that don't block (drawn only)
    const CITY_PROPS = [{
        kind: "stall",
        x: 33,
        y: 33
    }, {
        kind: "stall",
        x: 40,
        y: 33
    }, {
        kind: "stall",
        x: 33,
        y: 40.5
    }, {
        kind: "well",
        x: 28.5,
        y: 35
    }, {
        kind: "bench",
        x: 34,
        y: 30.5
    }, {
        kind: "bench",
        x: 39,
        y: 30.5
    }, {
        kind: "bench",
        x: 34,
        y: 43
    }, {
        kind: "bench",
        x: 39,
        y: 43
    }, {
        kind: "lamp",
        x: 34.5,
        y: 34.5
    }, {
        kind: "lamp",
        x: 39.5,
        y: 34.5
    }, {
        kind: "lamp",
        x: 34.5,
        y: 39.5
    }, {
        kind: "lamp",
        x: 39.5,
        y: 39.5
    }, {
        kind: "lamp",
        x: 36,
        y: 22.5
    }, {
        kind: "lamp",
        x: 36,
        y: 50.5
    }, {
        kind: "lamp",
        x: 22.5,
        y: 36
    }, {
        kind: "lamp",
        x: 50.5,
        y: 36
    }, {
        kind: "banner",
        x: 35,
        y: 20.6
    }, {
        kind: "banner",
        x: 39,
        y: 20.6
    }, {
        kind: "banner",
        x: 20.6,
        y: 35
    }, {
        kind: "banner",
        x: 52.4,
        y: 35
    }, {
        kind: "flowers",
        x: 30,
        y: 30
    }, {
        kind: "flowers",
        x: 29.5,
        y: 44
    }, {
        kind: "flowers",
        x: 45.5,
        y: 28.5
    }, {
        kind: "barrels",
        x: 47.6,
        y: 33
    }, {
        kind: "crates",
        x: 47.6,
        y: 41
    }, {
        kind: "cart",
        x: 40.5,
        y: 44.6
    }, ].map(p => ({
        ...p,
        x: tp(p.x),
        y: tp(p.y)
    }));
    // Every land gets the same crowd for its size: one ordinary monster to this many tiles you can walk
    // on (a spawn's n in MAP_DEFS is its share of that crowd). The lands used to range from one to 41
    // tiles to one to 75, so some felt empty and others never let you stop. Ember Vale, with the town
    // taking its middle and beginners in its fields, is kept sparser.
    const MOB_DENSITY = {
        wild: 38,
        town: 70
    };
    function buildMap(def) {
        const N = def.size
          , th = THEMES[def.theme]
          , map = new Uint8Array(N * N)
          , rng = mulberry32(def.seed);
        const idx = (x, y) => y * N + x
          , inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
        const get = (x, y) => inside(x, y) ? map[idx(x, y)] : T;
        const set = (x, y, t) => {
            if (x >= 1 && y >= 1 && x < N - 1 && y < N - 1)
                map[idx(x, y)] = t;
        }
        ;
        const disc = (cx, cy, r, t, keep) => {
            for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
                for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++)
                    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && (!keep || !keep.includes(get(x, y))))
                        set(x, y, t);
        }
        ;
        const town = !!def.town
          , inCity = (x, y) => town && x >= CITY.x0 - 1 && x <= CITY.x1 + 1 && y >= CITY.y0 - 1 && y <= CITY.y1 + 1;
        const nearCity = (x, y, m) => town && x > CITY.x0 - m && x < CITY.x1 + m && y > CITY.y0 - m && y < CITY.y1 + m;
        const lairs = [def.lair, def.lair2].filter(Boolean);
        // 1. open ground, with a thick natural edge (trees or rock) of uneven depth
        for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++) {
                const edge = Math.min(x, y, N - 1 - x, N - 1 - y)
                  , depth = 2 + fbm(x * 2, y * 2, def.seed + 3) * 4;
                map[idx(x, y)] = edge < depth ? (fbm(x, y, def.seed + 9) < th.rockEdge ? R : T) : G;
            }
        // 2. water: a winding river for wet lands, pools for the rest
        if (th.river) {
            const vertical = rng() < 0.5
              , ph = rng() * 6
              , amp = 4 + rng() * 5
              , base = N * (0.3 + rng() * 0.4);
            for (let t = 0; t < N; t++) {
                const c = base + Math.sin(t / 9 + ph) * amp + Math.sin(t / 3.7 + ph * 2) * 1.2
                  , w = 1.4 + fbm(t, 3, def.seed) * 1.4;
                for (let o = -3; o <= 3; o++)
                    if (Math.abs(o) <= w) {
                        const x = vertical ? Math.round(c + o) : t
                          , y = vertical ? t : Math.round(c + o);
                        if (!inCity(x, y))
                            set(x, y, W);
                    }
            }
        }
        const nearHub = (x, y, r) => [def.entry, ...def.portals, ...lairs].some(h => Math.hypot(h.x - x, h.y - y) < r);
        for (let k = 0; k < th.pools; k++) {
            const cx = 6 + rng() * (N - 12)
              , cy = 6 + rng() * (N - 12);
            if (inCity(cx, cy) || nearHub(cx, cy, 9))
                continue;
            const r = 1.8 + rng() * 2.6;
            for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
                for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++)
                    if (Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.2) <= r + (fbm(x * 3, y * 3, def.seed + 21) - 0.5) * 2.2)
                        set(x, y, W);
        }
        // 3. camps: open clearings spread over the land, each a place monsters gather and a road goes to.
        // Every road runs between two of these (or a gate, a lair, the way in), so none of them stops
        // in the trees - the side trails that used to wander off to a random spot and end there were
        // most of the dead ends.
        const camps = []
          , wet = (x, y, r) => {
            for (let b = -r; b <= r; b++)
                for (let a = -r; a <= r; a++)
                    if (get(Math.floor(x + a), Math.floor(y + b)) === W)
                        return true;
            return false;
        }
        ;
        {
            const want = Math.round(N * N / (town ? 1300 : 860))
              , margin = town ? 8 : 11;
            for (let tries = 0; camps.length < want && tries < 4000; tries++) {
                const x = margin + rng() * (N - margin * 2)
                  , y = margin + rng() * (N - margin * 2);
                if (nearCity(x, y, 9) || nearHub(x, y, town ? 12 : 14) || lairs.some(L => Math.hypot(L.x - x, L.y - y) < 17))
                    continue;
                if (camps.some(c => Math.hypot(c.x - x, c.y - y) < (town ? 16 : 17)))
                    continue;
                if (wet(x, y, 3))
                    continue;
                camps.push({
                    x,
                    y,
                    r: 5 + rng() * 2.2
                });
            }
        }
        // 4. thicket and crag: the land between the roads is filled to th.fill with masses of trees or
        // rock (noise, so they are broad shapes, not salt and pepper); roads and camps are cut through
        // them below, so the way on is always clear and the edges of it are the scenery.
        if (th.fill > 0) {
            const n = new Float32Array(N * N)
              , vals = [];
            for (let y = 0; y < N; y++)
                for (let x = 0; x < N; x++)
                    if (map[idx(x, y)] === G) {
                        const v = 0.6 * vnoise(x, y, 13, def.seed + 51) + 0.4 * vnoise(x, y, 5, def.seed + 57);
                        n[idx(x, y)] = v;
                        vals.push(v);
                    }
            vals.sort( (a, b) => a - b);
            const cut = vals[Math.floor(vals.length * (1 - th.fill))] || 2;
            for (let y = 0; y < N; y++)
                for (let x = 0; x < N; x++)
                    if (map[idx(x, y)] === G && n[idx(x, y)] > cut)
                        set(x, y, vnoise(x, y, 9, def.seed + 63) < th.rockGroves ? R : T);
        }
        // 5. the walled city (Ember Vale only)
        if (town) {
            const {x0, y0, x1, y1} = CITY;
            for (let y = y0; y <= y1; y++)
                for (let x = x0; x <= x1; x++)
                    set(x, y, (x === x0 || x === x1 || y === y0 || y === y1) ? WL : G);
            // streets from the four gates to the plaza, and a ring road
            for (let t = x0; t <= x1; t++)
                for (const o of [0, 1]) {
                    set(t, VC + o, P);
                    set(VC + o, t, P);
                }
            {
                const lo = tc(27)
                  , hi = tc(45);
                // the ring road, scaled with the town
                for (let t = lo; t <= hi + 1; t++)
                    for (const o of [0, 1]) {
                        set(t, lo + o, P);
                        set(t, hi + o, P);
                        set(lo + o, t, P);
                        set(hi + o, t, P);
                    }
            }
            disc(VC + 1, VC + 1, 5.6 * TOWN_K, S);
            // plaza
            for (const [a,b] of [[0, 0], [1, 0], [0, 1], [1, 1]])
                set(VC + a, VC + b, FT);
            // fountain in the middle
            for (const b of CITY_BUILDINGS)
                for (let y = b.y; y < b.y + b.h; y++)
                    for (let x = b.x; x < b.x + b.w; x++)
                        set(x, y, H);
            // keep a clean grass band outside the walls, and wide clear mouths in front of the four gates
            for (let y = y0 - 3; y <= y1 + 3; y++)
                for (let x = x0 - 3; x <= x1 + 3; x++) {
                    if (x >= x0 && x <= x1 && y >= y0 && y <= y1)
                        continue;
                    const t = get(x, y);
                    if (t === T || t === R || t === W)
                        set(x, y, G);
                }
            for (const [gx,gy] of [[x0 - 1, VC + 0.5], [x1 + 1, VC + 0.5], [VC + 0.5, y0 - 1], [VC + 0.5, y1 + 1]]) {
                const ox = gx < x0 ? -1 : gx > x1 ? 1 : 0
                  , oy = gy < y0 ? -1 : gy > y1 ? 1 : 0;
                for (let k = 0; k <= 6; k++) {
                    const cx = gx + ox * k + 0.5 * (ox === 0)
                      , cy = gy + oy * k + 0.5 * (oy === 0);
                    for (let y = Math.floor(cy - 3); y <= cy + 3; y++)
                        for (let x = Math.floor(cx - 3); x <= cx + 3; x++)
                            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 2.6 && [T, R].includes(get(x, y)))
                                set(x, y, G);
                }
            }
            for (const o of [0, 1])
                for (const d of [1, 2]) {
                    set(x0 - d, VC + o, P);
                    set(x1 + d, VC + o, P);
                    set(VC + o, y0 - d, P);
                    set(VC + o, y1 + d, P);
                }
            // the gate mouths join the roads
            // a little park with a pond and trees in the south-east
            disc(townXY(47.5), townXY(30.5), 1.8 * TOWN_K, W);
            for (const [x,y] of [[23, 31], [22, 33], [22, 40], [49, 38], [30, 49], [38, 49], [44, 49], [50, 49], [33, 22], [40, 22]])
                set(tc(x), tc(y), T);
            for (const [x,y] of [[29, 38], [30, 33], [43, 26], [38, 42], [26, 36], [50, 42]])
                set(tc(x), tc(y), F);
        }
        // 6. roads. Midpoint displacement gives a gentle wander; the road is laid in short straight
        // hops, bridging water, and (clear) cuts the thicket back that far either side of its middle,
        // so a road through a forest is a wide ride, not a one-hero gap with monsters in the trees.
        const road = (a, b, width, clear) => {
            let pts = [[a.x, a.y], [b.x, b.y]];
            for (let lvl = 0; lvl < 3; lvl++) {
                const out = [pts[0]];
                for (let i = 1; i < pts.length; i++) {
                    const [ax,ay] = pts[i - 1]
                      , [bx,by] = pts[i]
                      , L = Math.hypot(bx - ax, by - ay)
                      , nx = -(by - ay) / (L || 1)
                      , ny = (bx - ax) / (L || 1)
                      , off = (rng() - 0.5) * L * 0.3;
                    out.push([(ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off], pts[i]);
                }
                pts = out;
            }
            for (let i = 1; i < pts.length; i++) {
                const [ax,ay] = pts[i - 1]
                  , [bx,by] = pts[i]
                  , n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
                for (let s = 0; s <= n; s++) {
                    const x = ax + (bx - ax) * s / n
                      , y = ay + (by - ay) * s / n;
                    if (clear)
                        for (let dy = -clear - 1; dy <= clear + 1; dy++)
                            for (let dx = -clear - 1; dx <= clear + 1; dx++) {
                                const tx = Math.floor(x) + dx
                                  , ty = Math.floor(y) + dy;
                                if (!inCity(tx, ty) && Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= clear && [T, R].includes(get(tx, ty)))
                                    set(tx, ty, G);
                            }
                    for (let dy = 0; dy < width; dy++)
                        for (let dx = 0; dx < width; dx++) {
                            const tx = Math.floor(x - width / 2 + 0.5) + dx
                              , ty = Math.floor(y - width / 2 + 0.5) + dy;
                            const cur = get(tx, ty);
                            if (inCity(tx, ty) || cur === H || cur === FT || cur === WL || cur === S)
                                continue;
                            set(tx, ty, cur === W || cur === BR ? BR : P);
                        }
                }
            }
        }
        ;
        // The road network: the way in, the gates and the camps joined by the shortest set of roads
        // that reaches them all, plus a few shortcuts between camps so there are loops to hunt round.
        // A boss lair hangs off the nearest stop on a road of its own, never on the way to anywhere
        // else, so walking through a land does not walk you into its boss.
        const nodes = []
          , edges = [];
        const addNode = (x, y, kind) => {
            nodes.push({
                x,
                y,
                kind
            });
            return nodes.length - 1;
        }
        ;
        const parent = []
          , find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
          , join = (a, b) => {
            parent[find(a)] = find(b);
        }
        ;
        const crossesCity = (a, b) => {
            if (!town)
                return false;
            for (let s = 0; s <= 20; s++) {
                const x = a.x + (b.x - a.x) * s / 20
                  , y = a.y + (b.y - a.y) * s / 20;
                if (nearCity(x, y, 2))
                    return true;
            }
            return false;
        }
        ;
        if (town) {
            // the four gates lead straight out to the four portals, and the gates are joined through the city
            const gates = def.portals.map(p => ({
                x: Math.abs(p.x - VC - 1) < 2 ? VC + 1 : p.x < VC ? CITY.x0 - 1 : CITY.x1 + 1,
                y: Math.abs(p.y - VC - 1) < 2 ? VC + 1 : p.y < VC ? CITY.y0 - 1 : CITY.y1 + 1
            }));
            def.portals.forEach( (p, i) => {
                road(gates[i], p, 2, 2.5);
                // the road from the gate to the portal is a string of stops, so camps can join it anywhere
                const a = addNode(p.x, p.y, "hub");
                let prev = a;
                for (let k = 1; k <= 3; k++) {
                    const t = k / 4
                      , b = addNode(p.x + (gates[i].x - p.x) * t, p.y + (gates[i].y - p.y) * t, "road");
                    edges.push([prev, b, 0, true]);
                    prev = b;
                }
            }
            );
        } else {
            addNode(def.entry.x, def.entry.y, "hub");
            for (const p of def.portals)
                addNode(p.x, p.y, "hub");
        }
        for (const c of camps)
            c.node = addNode(c.x, c.y, "camp");
        for (let i = 0; i < nodes.length; i++)
            parent[i] = i;
        for (const e of edges)
            join(e[0], e[1]);
        if (town) {
            const stops = nodes.map( (n, i) => i).filter(i => nodes[i].kind !== "camp");
            for (const i of stops)
                join(i, stops[0]);
        }
        // all joined through the city
        const pairs = [];
        for (let i = 0; i < nodes.length; i++)
            for (let j = i + 1; j < nodes.length; j++) {
                if (nodes[i].kind !== "camp" && nodes[j].kind !== "camp" && town)
                    continue;
                if (crossesCity(nodes[i], nodes[j]))
                    continue;
                pairs.push([i, j, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)]);
            }
        pairs.sort( (a, b) => a[2] - b[2]);
        const used = new Set();
        for (const [i,j] of pairs)
            if (find(i) !== find(j)) {
                join(i, j);
                used.add(i + "," + j);
                edges.push([i, j, 1]);
            }
        // shortcuts: the shortest few roads not yet laid between two camps, or a camp and a gate
        let loops = town ? 2 : 4;
        for (const [i,j,L] of pairs) {
            if (!loops)
                break;
            if (used.has(i + "," + j) || L > (town ? 30 : 34))
                continue;
            if (nodes[i].kind !== "camp" && nodes[j].kind !== "camp")
                continue;
            // not one that runs alongside a road already there: the far end must be a new direction
            const deg = k => edges.filter(e => e[0] === k || e[1] === k).length;
            if (deg(i) >= 3 || deg(j) >= 3)
                continue;
            edges.push([i, j, 1]);
            used.add(i + "," + j);
            loops--;
        }
        // and no camp at the end of a single road: it gets a second one on to somewhere else, so a
        // hunter who walks to it can walk on rather than back the way they came
        for (const c of camps) {
            const k = c.node
              , deg = () => edges.filter(e => e[0] === k || e[1] === k).length;
            if (deg() !== 1)
                continue;
            const next = pairs.find( ([i,j,L]) => (i === k || j === k) && !used.has(i + "," + j) && L < 40);
            if (next) {
                edges.push([next[0], next[1], 1]);
                used.add(next[0] + "," + next[1]);
            }
        }
        for (const L of lairs) {
            let best = -1
              , bd = Infinity;
            for (let i = 0; i < nodes.length; i++) {
                const d = Math.hypot(nodes[i].x - L.x, nodes[i].y - L.y);
                if (d < bd && !crossesCity(nodes[i], L)) {
                    bd = d;
                    best = i;
                }
            }
            if (best >= 0)
                road(nodes[best], L, town ? 2 : 3, 2.5);
        }
        for (const [i,j,lay] of edges)
            if (lay)
                road(nodes[i], nodes[j], town && nodes[i].kind !== "camp" && nodes[j].kind !== "camp" ? 2 : town ? 2 : 3, town ? 2.5 : 3.5);
        // 7. a few clumps and single trees on open ground, away from the roads, so a camp or a meadow
        // is not a bare field - fewer and smaller than the old groves, which half-blocked every chase
        const nearRoad = (x, y, r) => {
            for (let b = -r; b <= r; b++)
                for (let a = -r; a <= r; a++) {
                    const t = get(x + a, y + b);
                    if (t === P || t === BR)
                        return true;
                }
            return false;
        }
        ;
        const groves = Math.round(N * N / 210 * th.groves);
        for (let k = 0; k < groves; k++) {
            const cx = 3 + rng() * (N - 6)
              , cy = 3 + rng() * (N - 6);
            if (inCity(cx, cy) || nearRoad(Math.floor(cx), Math.floor(cy), 5) || nearHub(cx, cy, 8))
                continue;
            const r = 1.2 + rng() * 1.8
              , t = rng() < th.rockGroves ? R : T;
            for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
                for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++)
                    if (get(x, y) === G && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + (fbm(x * 3, y * 3, def.seed + 31) - 0.5) * 2)
                        set(x, y, t);
        }
        for (let y = 2; y < N - 2; y++)
            for (let x = 2; x < N - 2; x++)
                if (get(x, y) === G && !inCity(x, y) && !nearRoad(x, y, 2)) {
                    const h = rng();
                    if (h < th.rock * 0.25)
                        set(x, y, R);
                    else if (h < (th.rock + th.lone) * 0.25)
                        set(x, y, T);
                }
        // 8. clearings: the way in, the gates, the camps, and boss arenas ringed with stones
        if (!town)
            disc(def.entry.x, def.entry.y, 5, G, [P, BR, W]);
        for (const p of def.portals)
            disc(p.x, p.y, 3.2, G, [P, BR]);
        for (const c of camps) {
            disc(c.x, c.y, c.r, G, [P, BR, W]);
            // a camp keeps a few trees or stones of its own toward the edge, for shape - never in the middle
            for (let k = 0; k < 3; k++) {
                const a = rng() * 6.283
                  , d = c.r - 1.2;
                set(Math.floor(c.x + Math.cos(a) * d), Math.floor(c.y + Math.sin(a) * d), rng() < th.rockGroves ? R : T);
            }
        }
        // the arena is marked by six standing stones with wide gaps, not walled in: a near-closed ring
        // was cover to shoot a boss from that its body could not get round. Clear a margin outside
        // it too, so the way in and out is open ground rather than a squeeze through a grove.
        for (const L of lairs) {
            disc(L.x, L.y, 7.2, G, [P, BR, W]);
            disc(L.x, L.y, 4.4, D);
            for (let k = 0; k < 6; k++) {
                const a = (k + hash(L.x, L.y, def.seed) * 0.5) / 6 * Math.PI * 2;
                set(Math.floor(L.x + Math.cos(a) * 5.4), Math.floor(L.y + Math.sin(a) * 5.4), R);
            }
        }
        // No one-tile squeezes between trees or rocks: a hero slips through and a monster's body
        // does not, which is how a gap in a grove turned into a place to shoot from for free.
        const solid = (x, y) => {
            const t = get(x, y);
            return t === T || t === R;
        }
        ;
        // first, a lone open tile walled in on three sides by thicket is filled in: opening squeezes
        // from those used to cut thin slits clean across a crag
        for (let pass = 0; pass < 2; pass++)
            for (let y = 2; y < N - 2; y++)
                for (let x = 2; x < N - 2; x++) {
                    if (get(x, y) !== G || inCity(x, y))
                        continue;
                    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter( ([a,b]) => solid(x + a, y + b));
                    if (around.length >= 3)
                        set(x, y, get(x + around[0][0], y + around[0][1]));
                }
        for (let pass = 0; pass < 3; pass++)
            for (let y = 2; y < N - 2; y++)
                for (let x = 2; x < N - 2; x++) {
                    if (solid(x, y) || inCity(x, y))
                        continue;
                    if (solid(x - 1, y) && solid(x + 1, y))
                        set(x + 1, y, G);
                    if (solid(x, y - 1) && solid(x, y + 1))
                        set(x, y + 1, G);
                }
        // 9. flower patches and dirt, only on open grass
        for (let y = 2; y < N - 2; y++)
            for (let x = 2; x < N - 2; x++)
                if (get(x, y) === G && !inCity(x, y)) {
                    const n = fbm(x * 2, y * 2, def.seed + 41);
                    if (n > 0.72 && hash(x, y, def.seed) < th.decor * 6)
                        set(x, y, F);
                    else if (n < 0.2 && hash(x, y, def.seed + 1) < 0.5)
                        set(x, y, D);
                }
        for (const p of def.portals) {
            const px = Math.floor(p.x - 0.5)
              , py = Math.floor(p.y - 0.5);
            for (let a = 0; a < 2; a++)
                for (let b = 0; b < 2; b++) {
                    const x = px + a
                      , y = py + b;
                    if (inside(x, y))
                        map[idx(x, y)] = PT;
                }
        }

        const Mp = {
            id: def.id,
            def,
            N,
            map,
            idx
        };
        if (town) {
            def.buildings = CITY_BUILDINGS;
            def.props = CITY_PROPS;
            def.city = CITY;
        }
        // 10. everything must be reachable from the entry: carve a path to any portal, lair or camp that isn't
        const reachFrom = () => {
            const reach = new Uint8Array(N * N)
              , sx = Math.floor(def.entry.x)
              , sy = Math.floor(def.entry.y)
              , q = [[sx, sy]];
            reach[idx(sx, sy)] = 1;
            while (q.length) {
                const [x,y] = q.pop();
                for (const [dx,dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx
                      , ny = y + dy;
                    if (!inside(nx, ny) || reach[idx(nx, ny)])
                        continue;
                    if (blocked(Mp, nx + .5, ny + .5, false) && map[idx(nx, ny)] !== PT)
                        continue;
                    reach[idx(nx, ny)] = 1;
                    q.push([nx, ny]);
                }
            }
            return reach;
        }
        ;
        let reach = reachFrom();
        for (const h of [...def.portals, ...lairs, ...camps])
            if (!reach[idx(Math.floor(h.x), Math.floor(h.y))]) {
                road(def.entry, h, 3, 2.5);
                reach = reachFrom();
            }
        Mp.reach = reach;
        Mp.camps = camps.map(c => ({
            x: Math.round(c.x * 10) / 10,
            y: Math.round(c.y * 10) / 10,
            r: Math.round(c.r * 10) / 10
        }));
        let maxD = 1
          , open = 0;
        for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++)
                if (reach[idx(x, y)]) {
                    maxD = Math.max(maxD, Math.hypot(x - def.entry.x, y - def.entry.y));
                    if (!nearCity(x, y, 5))
                        open++;
                }
        // 11. monsters. Two in three stand in a camp whose distance from the way in suits them (a pack
        // you can see and choose to take on); the rest wander the open ground between.
        const spawns = []
          , ordinary = def.spawns.filter(sp => !MOB[sp.type].mini && !MOB[sp.type].rare);
        const crowd = open / (town ? MOB_DENSITY.town : MOB_DENSITY.wild)
          , share = crowd / ordinary.reduce( (a, sp) => a + sp.n, 0);
        for (const sp of def.spawns) {
            const want = MOB[sp.type].mini || MOB[sp.type].rare ? sp.n : Math.max(1, Math.round(sp.n * share));
            const fits = camps.filter(c => {
                const d = Math.hypot(c.x - def.entry.x, c.y - def.entry.y) / maxD;
                return d >= sp.zone[0] && d <= sp.zone[1];
            }
            );
            let n = 0
              , guard = 0;
            while (n < want && guard++ < 60000) {
                let x, y;
                if (fits.length && rng() < 0.66 && guard < 40000) {
                    const c = fits[Math.floor(rng() * fits.length)]
                      , a = rng() * 6.283
                      , d = Math.sqrt(rng()) * (c.r + 1.5);
                    x = Math.floor(c.x + Math.cos(a) * d);
                    y = Math.floor(c.y + Math.sin(a) * d);
                } else {
                    x = 2 + Math.floor(rng() * (N - 4));
                    y = 2 + Math.floor(rng() * (N - 4));
                }
                if (!inside(x, y))
                    continue;
                const t = map[idx(x, y)];
                if (!reach[idx(x, y)] || t === S || t === P || t === PT || t === H || t === BR)
                    continue;
                const d = Math.hypot(x - def.entry.x, y - def.entry.y) / maxD;
                if (d < sp.zone[0] || d > sp.zone[1] || Math.hypot(x - def.entry.x, y - def.entry.y) < 15)
                    continue;
                // the way in and its waypoint stay calm
                if (lairs.some(L => Math.hypot(x - L.x, y - L.y) < 8))
                    continue;
                // not on a gate: whoever comes through should not land on a monster. And somewhere this
                // body can move about - an Elder Treant once spawned in an eight-tile nook beside a portal
                // where it could reach no one, so it evaded every arrow and could never be killed.
                if (def.portals.some(p => Math.hypot(x + .5 - p.x, y + .5 - p.y) < 7))
                    continue;
                if (!roomFor(Mp, x, y, MOB[sp.type].r * 0.7, 60))
                    continue;
                if (inCity(x, y) || nearCity(x, y, 5))
                    continue;
                // two monsters never stand on the same tile
                if (spawns.some(s => Math.abs(s.sx - x - .5) < 0.6 && Math.abs(s.sy - y - .5) < 0.6))
                    continue;
                spawns.push({
                    type: sp.type,
                    sx: x + .5,
                    sy: y + .5
                });
                n++;
            }
        }
        for (const L of lairs) {
            spawns.push({
                type: L.boss,
                sx: L.x + .5,
                sy: L.y + .5
            });
            // reserved slots the boss fills with summoned adds; they start dead and never respawn on their own
            const addType = MOB[L.boss].adds;
            // a boss naming adds that do not exist used to put unknown monsters into the world and
            // bring the server down the next time anything looked at one
            if (addType && !MOB[addType])
                console.error(`[world] ${L.boss} summons "${addType}", which is not a monster - ignoring`);
            if (addType && MOB[addType])
                for (let k = 0; k < 6; k++)
                    spawns.push({
                        type: addType,
                        sx: L.x + .5,
                        sy: L.y + .5,
                        slot: true
                    });
        }
        spawns.forEach( (s, i) => {
            s.id = i;
        }
        );
        Mp.spawns = spawns;
        return Mp;
    }

    // does a monster body of radius r starting on tile (x, y) have at least `need` tiles to move on?
    function roomFor(Mp, x, y, r, need) {
        const N = Mp.N
          , start = y * N + x;
        if (!canStand(Mp, x + .5, y + .5, r, true))
            return false;
        const seen = new Set([start])
          , q = [start];
        for (let h = 0; h < q.length && q.length < need; h++) {
            const c = q[h]
              , cx = c % N
              , cy = (c - cx) / N;
            for (const [dx,dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx
                  , ny = cy + dy
                  , k = ny * N + nx;
                if (nx >= 0 && ny >= 0 && nx < N && ny < N && !seen.has(k) && canStand(Mp, nx + .5, ny + .5, r, true)) {
                    seen.add(k);
                    q.push(k);
                }
            }
        }
        return q.length >= need;
    }
    function blocked(Mp, x, y, forMob) {
        const tx = Math.floor(x)
          , ty = Math.floor(y);
        if (tx < 0 || ty < 0 || tx >= Mp.N || ty >= Mp.N)
            return true;
        const t = Mp.map[ty * Mp.N + tx];
        if (t === T || t === W || t === R || t === H || t === FT || t === WL)
            return true;
        if (forMob && Mp.def.town && tx >= CITY.x0 && tx <= CITY.x1 && ty >= CITY.y0 && ty <= CITY.y1)
            return true;
        // monsters never enter the city
        return forMob && (t === S || t === PT);
    }
    function canStand(Mp, x, y, r, forMob) {
        return !blocked(Mp, x - r, y - r, forMob) && !blocked(Mp, x + r, y - r, forMob) && !blocked(Mp, x - r, y + r, forMob) && !blocked(Mp, x + r, y + r, forMob);
    }
    function step(Mp, e, dx, dy, r, forMob) {
        if (canStand(Mp, e.x + dx, e.y, r, forMob))
            e.x += dx;
        if (canStand(Mp, e.x, e.y + dy, r, forMob))
            e.y += dy;
    }
    function inTown(Mp, x, y) {
        return !!Mp.def.town && x >= CITY.x0 && x <= CITY.x1 + 1 && y >= CITY.y0 && y <= CITY.y1 + 1;
    }
    function portalAt(Mp, x, y) {
        for (const p of Mp.def.portals)
            if (Math.hypot(p.x - x, p.y - y) < 1.05)
                return p;
        return null;
    }

    const MAPS = MAP_DEFS.map(buildMap);

    // ---------- waypoints ----------
    // One stone a zone. Touch it once and it is yours; stand at any stone you have and travel to
    // any other. In the wilds it sits a few steps in from the gate you arrive by (out of the way
    // of the portal, inside the clearing round the arrival point); in Ember Vale, on the plaza.
    // What a kill is worth in experience. A boss's listed xp is about 0.3 of a level at its own
    // level and a champion's under that (they used to list four to nine levels and half a level, and
    // a cap trimmed them; hunting bosses as they came up reached level 90 in about fifteen hours -
    // tools/levelsim.js). Anything far below you (overLevelGap in server.js) pays a quarter, and a
    // boss or champion far below you next to nothing. No kill is ever worth more than a level.
    const BIG_XP = {
        farBelow: 0.05
    };
    // experience from one kill of `s` for a hero of `lv`, before party shares, elites and rates:
    // { mul, cap } - multiply the listed xp by mul, then never more than cap (in xp) from the kill
    function killXp(s, lv, gap) {
        const far = lv > s.lvl + gap;
        return {
            mul: far ? (s.boss || s.mini ? BIG_XP.farBelow : 0.25) : 1,
            cap: need(lv)
        };
    }
    // Each wild zone has a four-piece set (head, body, cloak, shoes - bonuses at two and four pieces)
    // and a material its monsters drop; Brann makes that zone's set pieces from its material.
    const ZONE_SETS = {
        woods: {
            set: "Wildwood",
            mat: "Mossy Bark",
            core: "Alpha Fang"
        },
        dunes: {
            set: "Sandstrider",
            mat: "Scarab Shell",
            core: "Queen's Stinger"
        },
        marsh: {
            set: "Mirewalker",
            mat: "Bog Iron",
            core: "Bog Crown"
        },
        crypt: {
            set: "Gravewarden",
            mat: "Grave Dust",
            core: "Golem Heart"
        },
        frost: {
            set: "Rimeguard",
            mat: "Rime Crystal",
            core: "Jarl's Frozen Heart"
        },
        waste: {
            set: "Obsidian Vanguard",
            mat: "Obsidian Shard",
            core: "Cinder Heart"
        },
        sunken: {
            set: "Tidecaller",
            mat: "Tide Pearl",
            core: "Abyssal Pearl"
        },
        spire: {
            set: "Hellforged",
            mat: "Brimstone",
            core: "Sovereign's Sigil"
        },
        storm: {
            set: "Stormrider",
            mat: "Storm Feather",
            core: "Thunder Core"
        },
        void: {
            set: "Starless",
            mat: "Void Ember",
            core: "Rift Shard"
        },
        sanctum: {
            set: "Seraphic",
            mat: "Seraph Feather",
            core: "Fallen Halo"
        },
        jungle: {
            set: "Thornveil",
            mat: "Ironbark Resin",
            core: "Verdant Heart"
        },
    };
    // a zone's boss core is carried with the materials, under this key
    const coreKey = k => "core_" + k;
    // one set piece at Brann, at a level the hero picks: from the zone's own level up to the hero's,
    // in steps of five - the higher, the more material and gold (craftCost). Materials also sell to Tomas.
    // gold climbs faster than the level (goldCurve): a Lv 90 piece is about 46,000, a Lv 10 one 1,100
    const CRAFT = {
        mats: 30,
        matsPerLv: 2,
        goldPerLv: 60,
        goldCurve: 12,
        step: 5,
        sellPerLv: 1.5
    };
    const craftGold = (lv, perLv) => Math.round(lv * perLv * (1 + lv / CRAFT.goldCurve));
    const craftCost = (zoneLv, lv) => ({
        mats: CRAFT.mats + CRAFT.matsPerLv * Math.max(0, lv - zoneLv),
        gold: craftGold(lv, CRAFT.goldPerLv)
    });
    // the levels Brann will make a zone's set at for a hero of heroLv
    const craftLevels = (zoneLv, heroLv) => {
        const out = [zoneLv];
        for (let lv = Math.ceil((zoneLv + 1) / CRAFT.step) * CRAFT.step; lv <= heroLv; lv += CRAFT.step)
            out.push(lv);
        return out;
    }
    ;
    const matPrice = zoneLv => Math.max(1, Math.round(zoneLv * CRAFT.sellPerLv));
    // Brann works on a set piece already made, too:
    // - raises its level with the zone's material, to any of craftLevels above it (up to the hero's own)
    // - makes a Rare piece Epic with cores from the zone's boss (every boss there drops one a kill)
    const SET_UP = {
        mats: 5,
        goldPerLv: 30,
        cores: 5,
        epicGoldPerLv: 150
    };
    const raiseCost = (from, to) => ({
        mats: SET_UP.mats + CRAFT.matsPerLv * Math.max(0, to - from),
        gold: craftGold(to, SET_UP.goldPerLv)
    });
    const epicCost = lv => ({
        cores: SET_UP.cores,
        gold: Math.round(lv * SET_UP.epicGoldPerLv * (1 + lv / 30))
    });
    // Tomas's newer supplies, carried as counts (the server keeps them in `supplies`)
    const SUPPLIES = {
        ether: {
            name: "Ether",
            desc: "Restores 40% of your SP (Q). 8s between drinks."
        },
        tonic: {
            name: "Swift tonic",
            desc: "Run 25% faster for 5 minutes."
        },
        way: {
            name: "Wayfarer scroll",
            desc: "Travel to any waypoint you have found, from anywhere - no fare. Not while something is after you."
        },
    };
    // How many gates apart two zones are (fewest), for the waypoint fare: the further, the dearer.
    let HOPS = null;
    function zoneHops(a, b) {
        if (!HOPS)
            HOPS = MAPS.map( (M0, s) => {
                const d = MAPS.map( () => Infinity)
                  , q = [s];
                d[s] = 0;
                for (let h = 0; h < q.length; h++)
                    for (const p of MAPS[q[h]].def.portals)
                        if (MAPS[p.to] && d[p.to] === Infinity) {
                            d[p.to] = d[q[h]] + 1;
                            q.push(p.to);
                        }
                return d;
            }
            );
        const v = HOPS[a] && HOPS[a][b];
        return Number.isFinite(v) ? v : 1;
    }
    const warpCost = (lv, from, to) => from === to ? 0 : Math.round(zoneHops(from, to) * (15 + Math.max(1, lv) * 4));
    const WAYPOINTS = MAPS.map(M => {
        const def = M.def;
        let x, y;
        if (def.town) {
            x = 52;
            y = 49;
        } // south-east of the plaza, clear of the streets, the stalls and every shop counter
        else {
            // a dozen steps into the zone from where you arrive, toward its middle - not standing in the
            // gateway, where it was first put and felt like part of the door
            const e = def.entry
              , c = M.N / 2
              , L = Math.hypot(c - e.x, c - e.y) || 1
              , d = Math.min(12, L * 0.6);
            x = e.x + (c - e.x) / L * d;
            y = e.y + (c - e.y) / L * d;
        }
        // nearest open ground (off the road, room round it, reachable from the way in), spiralling out
        const open = (px, py) => canStand(M, px, py, 0.45, false) && (def.town || canStand(M, px, py, 0.7, false)) && (def.town || (M.map[Math.floor(py) * M.N + Math.floor(px)] !== P && M.reach[Math.floor(py) * M.N + Math.floor(px)]));
        for (let r = 0; r <= 8; r += 0.5) {
            let hit = null;
            for (let a = 0; a < 24 && !hit; a++) {
                const px = x + Math.cos(a / 24 * 6.283) * r
                  , py = y + Math.sin(a / 24 * 6.283) * r;
                if (open(px, py))
                    hit = [px, py];
            }
            if (hit) {
                x = Math.round(hit[0] * 10) / 10;
                y = Math.round(hit[1] * 10) / 10;
                break;
            }
        }
        return {
            map: def.id,
            x,
            y,
            name: def.name,
            lv: def.lv
        };
    }
    );
    const WAYPOINT_RANGE = 2.6;
    // how close counts as standing at a stone

    // Arrival points are written by hand above, but the scenery around them is generated, so a
    // gate can end up dropping you where only the point under your feet is clear. The client
    // walks the hero as a body and refuses any step that clips a tree, so that lands you wedged
    // in the bushes, shuffling on the spot. Snap every arrival to the nearest place a hero
    // actually fits with room to walk off - this way a change to a map seed cannot bring it back.
    const HERO_R = 0.28;
    for (const M of MAPS)
        for (const p of M.def.portals) {
            const dest = MAPS[p.to];
            const room = (x, y) => {
                if (!canStand(dest, x, y, HERO_R, false))
                    return false;
                let open = 0;
                for (let k = 0; k < 8; k++) {
                    const t = k / 8 * Math.PI * 2;
                    if (canStand(dest, x + Math.cos(t) * 0.6, y + Math.sin(t) * 0.6, HERO_R, false))
                        open++;
                }
                return open >= 5;
            }
            ;
            if (room(p.tx, p.ty))
                continue;
            let moved = false;
            for (let r = 0.25; r <= 8 && !moved; r += 0.25)
                for (let a = 0; a < 24 && !moved; a++) {
                    const th = a / 24 * Math.PI * 2
                      , x = +(p.tx + Math.cos(th) * r).toFixed(2)
                      , y = +(p.ty + Math.sin(th) * r).toFixed(2);
                    if (x < 1 || y < 1 || x > dest.N - 1 || y > dest.N - 1)
                        continue;
                    // and not so close to the gate that you walk straight back through it
                    const gate = dest.def.portals.find(q => q.to === M.def.id);
                    if (gate && Math.hypot(x - gate.x, y - gate.y) < 1.6)
                        continue;
                    if (!room(x, y))
                        continue;
                    p.tx = x;
                    p.ty = y;
                    moved = true;
                }
        }

    // ---------- the bestiary, and what a zone is worth finishing ----------
    // The game had one goal, the level bar, and when it filled there was nothing left. These are
    // the goals that have an end: every kind of monster in a zone, and every zone in the world.
    const BESTIARY_MASTER = 25;
    // kills of one kind before that kind counts as mastered
    // ...for a kind that is always about. One boss on a ten-to-twenty minute respawn, shared with
    // the whole server, made 25 a day's camping per boss and turned "catalogued" into a chore;
    // rares are worse still, one on the map at a time and some of them run.
    const masterAt = k => {
        const s = MOB[k] || {};
        return s.boss ? 3 : s.rare ? 5 : s.mini ? 10 : BESTIARY_MASTER;
    }
    ;
    const isMastered = (book, k) => ((book && book[k]) | 0) >= masterAt(k);
    const ZONE_BIT = {
        cleared: 1,
        catalogued: 2
    };
    // two bits per zone in one number

    // every kind of monster that lives in a zone, boss included
    const zoneMonsters = mapId => {
        const M = MAPS[mapId];
        if (!M)
            return [];
        const set = new Set(M.spawns.filter(sp => !sp.slot && !MOB[sp.type].world).map(sp => sp.type));
        for (const l of [M.def.lair, M.def.lair2])
            if (l && l.boss && !MOB[l.boss].world)
                set.add(l.boss);
        return [...set];
    }
    ;
    const zoneOf = mob => {
        // the first zone a kind of monster appears in
        for (const M of MAPS)
            if (zoneMonsters(M.def.id).includes(mob))
                return M.def.id;
        return -1;
    }
    ;
    const zoneFlag = (zones, mapId, bit) => ((zones | 0) >> (mapId * 2) & 3) & bit;
    const setZoneFlag = (zones, mapId, bit) => (zones | 0) | (bit << (mapId * 2));

    // What finishing things is worth. Small on purpose - this is meant to be a reason to go back
    // to a zone you outlevelled, not a power curve that leaves anyone who skipped it behind.
    const COLLECTION = {
        perCleared: {
            hp: 0.01,
            atk: 0.01
        },
        // killed the zone's boss
        perCatalogued: {
            hp: 0.02,
            atk: 0.02
        },
        // mastered every kind of monster in it
        perRebirth: {
            hp: 0.03,
            atk: 0.03
        },
    };
    function collectionBonus(zones, rebirths) {
        let hp = 0
          , atk = 0;
        for (const M of MAPS) {
            if (zoneFlag(zones, M.def.id, ZONE_BIT.cleared)) {
                hp += COLLECTION.perCleared.hp;
                atk += COLLECTION.perCleared.atk;
            }
            if (zoneFlag(zones, M.def.id, ZONE_BIT.catalogued)) {
                hp += COLLECTION.perCatalogued.hp;
                atk += COLLECTION.perCatalogued.atk;
            }
        }
        hp += COLLECTION.perRebirth.hp * (rebirths | 0);
        atk += COLLECTION.perRebirth.atk * (rebirths | 0);
        return {
            hp,
            atk
        };
    }

    // ---------- the hero's numbers ----------
    // One copy of every formula that turns level, attributes and gear into attack, health and the
    // rest, for the server (server.js wraps these around a live hero) and for the balance model
    // (tools/balance.js wraps them around a made-up one). They were written out three times before
    // and drifted: the model's --matrix table was still on VIT x6, crit from AGI and an SP pool two
    // versions old, so everything it printed was quietly wrong.
    //   C  the class (CLASSES[id])
    //   s  lv, w (weapon upgrades), ar (armour upgrades), str agi vit int dex luk
    //   g  gear totals: atk def hp crit critd aspd
    //   m  multipliers, each a fraction (0 = none): atk / def / crit / haste (buffs), dmg hp def crit
    //      sp spRegen (passive skills), colAtk colHp (zones finished and rebirths)
    const SP_REGEN = 0.028
      , SP_REFILL_FLOOR = 14;
    // share of the pool a second; seconds for empty to full at most
    const n0 = v => v || 0;
    const Stats = {
        atk: (C, s, g, m) => Math.round(((6 + s.lv + s.w * 3 + s.str * C.w.str + s.agi * C.w.agi + s.int * C.w.int + s.dex * n0(C.w.dex)) * C.atk + n0(g.atk)) * (1 + n0(m.atkBuff)) * (1 + n0(m.dmg)) * (1 + n0(m.colAtk))),
        hp: (C, s, g, m) => Math.round(((40 + s.lv * 9 + s.ar * 8 + s.vit * 7) * C.hp + n0(g.hp)) * (1 + n0(m.hp)) * (1 + n0(m.colHp))),
        def: (C, s, g, m) => Math.round((s.lv * 0.45 + s.ar * 1.8 + s.vit * 0.3 + s.str * 0.15 + C.def + n0(g.def)) * (1 + n0(m.defBuff)) * (1 + n0(m.def))),
        crit: (s, g, m) => Math.min(0.6, 0.05 + s.luk * 0.0042 + n0(g.crit) + n0(m.crit) + n0(m.critBuff)),
        critDmg: (s, g) => 1.8 + Math.min(0.5, s.luk * 0.0022) + Math.min(1.2, n0(g.critd)),
        // 0.35% a point of AGI up to a cap of 35% (reached at 100); a passive can raise the cap
        // (m.dodgeCap - Killer Instinct), and AGI past 100 then keeps counting up to it
        dodge: (s, m) => Math.min(0.35 + ((m && m.dodgeCap) || 0), s.agi * 0.0035),
        // The tank's answer to dodge: a Knight blocks, taking half of the blow (BLOCK_CUT in server.js).
        // 5% to start and 0.25% a point of VIT, up to 30% (at 100 VIT). Unlike dodge it works as well
        // against a boss as against anything else - holding a boss is what a tank is for.
        block: (C, s) => C.block ? Math.min(C.block.cap, C.block.base + s.vit * C.block.perVit) : 0,
        hasteBasic: (s, g, m) => Math.min(0.3, s.agi * 0.0035 + n0(m.haste)) + Math.min(0.25, n0(g.aspd)),
        // gear speed stacks on top
        hasteSkill: (s, m) => Math.min(0.35, s.dex * 0.0032 + n0(m.haste)),
        sp: (C, s, m) => Math.round((40 + s.lv * 5 + s.int * 1.6) * C.sp * (1 + n0(m.sp))),
        // INT owns the pool and nudges the rate; the floor keeps SP a resource rather than a formality
        spRegen: (s, pool, m) => Math.min((pool * SP_REGEN + 1) * (1 + Math.min(0.4, s.int * 0.002)) * (1 + n0(m.spRegen)), pool / SP_REFILL_FLOOR),
    };

    // The attribute split a hero is balanced around (tools/balance.js builds its model hero the same
    // way): most into whatever drives the class's attack, a fifth into VIT, and a little into DEX
    // (cooldowns) and LUK (crits) - AGI instead of DEX for a class whose attack is DEX already.
    // Heroes who never spend their points fall a long way behind it; this is the one-button way in.
    function statPlan(clsId) {
        const w = (CLASSES[clsId] || CLASSES.knight).w;
        const main = ["str", "agi", "int", "dex"].reduce( (best, k) => ((w[k] || 0) > (w[best] || 0) ? k : best), "str");
        const plan = {
            [main]: 0.6,
            vit: 0.2,
            luk: 0.1
        };
        plan[main === "dex" ? "agi" : "dex"] = 0.1;
        return plan;
    }
    // Spread `n` points by the plan, nudged toward it given what has been spent already, so pressing
    // it a second time later keeps the build on course rather than piling everything on one stat.
    function statSpend(clsId, have, n) {
        const plan = statPlan(clsId)
          , out = {};
        const spent = k => (have[k] || 0) + (out[k] || 0);
        for (let i = 0; i < n; i++) {
            const total = Object.keys(plan).reduce( (a, k) => a + spent(k), 0) + 1;
            const k = Object.keys(plan).sort( (a, b) => (spent(a) / total - plan[a]) - (spent(b) / total - plan[b]))[0];
            out[k] = (out[k] || 0) + 1;
        }
        return out;
    }

    const World = {
        SKILLS,
        SKILL_MAX,
        OLD_CLASS,
        HOTBAR,
        sv,
        skillLv,
        skillGold,
        canLearn,
        CITY,
        FOUNTAIN,
        TS: 32,
        G,
        F,
        T,
        W,
        P,
        S,
        D,
        H,
        R,
        FT,
        PT,
        BR,
        WL,
        COLORS,
        CLASSES,
        CLASS_IDS,
        MOB,
        THEMES,
        MAPS,
        NPC,
        ARMORY,
        RESETTER,
        SPAWN,
        MAX_LEVEL,
        POINTS_PER_LEVEL,
        STATS,
        STAT_NAMES,
        STAT_HELP,
        need,
        hash,
        mulberry32,
        blocked,
        canStand,
        step,
        inTown,
        portalAt,
        APOTHECARY,
        BESTIARY_MASTER,
        masterAt,
        isMastered,
        ZONE_BIT,
        zoneMonsters,
        zoneOf,
        zoneFlag,
        setZoneFlag,
        COLLECTION,
        collectionBonus,
        statPlan,
        statSpend,
        Stats,
        SP_REGEN,
        SP_REFILL_FLOOR,
        WAYPOINTS,
        WAYPOINT_RANGE,
        TRADER,
        VAULT,
        CURIO,
        CARDS,
        MARKET,
        TAILOR,
        COSMETICS,
        zoneHops,
        warpCost,
        BIG_XP,
        killXp,
        SEALS,
        SEAL_SHOP,
        ZONE_SETS,
        coreKey,
        CRAFT,
        craftCost,
        craftLevels,
        matPrice,
        SET_UP,
        raiseCost,
        epicCost,
        SUPPLIES,
        NPC_RANGE
    };
    if (typeof module !== "undefined" && module.exports)
        module.exports = World;
    else
        root.World = World;
}
)(typeof self !== "undefined" ? self : this);
