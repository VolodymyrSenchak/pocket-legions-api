"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BALANCE = exports.ITEMS = exports.ITEM_IDS = exports.SLOT_NAMES = exports.SLOTS = void 0;
exports.SLOTS = ["head", "neck", "body", "cloak", "weapon", "shield", "feet", "ring"];
exports.SLOT_NAMES = {
    head: "Шолом",
    neck: "Амулет",
    body: "Броня",
    cloak: "Плащ",
    weapon: "Зброя",
    shield: "Щит",
    feet: "Чоботи",
    ring: "Кільце (×2)",
};
exports.ITEM_IDS = [
    "helm_luck",
    "helm_strat",
    "crown",
    "amu_valor",
    "dragon_eye",
    "clover",
    "leather",
    "chainmail",
    "plate",
    "cloak_shadow",
    "mantle",
    "cloak_wind",
    "sword",
    "axe_bers",
    "spear_1000",
    "shield_wood",
    "shield_dragon",
    "shield_guard",
    "boots_march",
    "boots_scout",
    "sandals",
    "ring_str",
    "ring_def",
    "ring_luck",
    "ring_sniper",
    "ring_blood",
];
/** `cost` is for a 1000-point budget; army.ts scales it with the budget. */
exports.ITEMS = {
    helm_luck: { id: "helm_luck", slot: "head", name: "Шолом удачі", cost: 25, fx: { luck: 1 } },
    helm_strat: { id: "helm_strat", slot: "head", name: "Шолом стратега", cost: 50, fx: { atk: 1, def: 1 } },
    crown: { id: "crown", slot: "head", name: "Корона полководця", cost: 55, fx: { atk: 1, morale: 1 } },
    amu_valor: { id: "amu_valor", slot: "neck", name: "Амулет відваги", cost: 30, fx: { morale: 1 } },
    dragon_eye: { id: "dragon_eye", slot: "neck", name: "Око дракона", cost: 50, fx: { atk: 2 } },
    clover: { id: "clover", slot: "neck", name: "Чотирилисник", cost: 50, fx: { luck: 2 } },
    leather: { id: "leather", slot: "body", name: "Шкіряна куртка", cost: 25, fx: { def: 1 } },
    chainmail: { id: "chainmail", slot: "body", name: "Кольчуга", cost: 50, fx: { def: 2 } },
    plate: { id: "plate", slot: "body", name: "Лицарські лати", cost: 75, fx: { def: 3 } },
    cloak_shadow: { id: "cloak_shadow", slot: "cloak", name: "Плащ тіні", cost: 40, fx: { rangedTaken: -0.15 }, text: "−15% шкоди від пострілів усім загонам" },
    mantle: { id: "mantle", slot: "cloak", name: "Мантія чародія", cost: 45, fx: { heroPower: 0.5, heroUses: 1 }, text: "Вміння героя +50% сили і 3 використання за бій" },
    cloak_wind: { id: "cloak_wind", slot: "cloak", name: "Плащ вітру", cost: 30, fx: { spdRound1: 1 }, text: "+1 швидкість усім загонам у першому раунді" },
    sword: { id: "sword", slot: "weapon", name: "Меч воїна", cost: 25, fx: { atk: 1 } },
    axe_bers: { id: "axe_bers", slot: "weapon", name: "Сокира берсерка", cost: 50, fx: { atk: 3, def: -1 } },
    spear_1000: { id: "spear_1000", slot: "weapon", name: "Спис тисячі битв", cost: 75, fx: { atk: 2, luck: 1 } },
    shield_wood: { id: "shield_wood", slot: "shield", name: "Дерев'яний щит", cost: 25, fx: { def: 1 } },
    shield_dragon: { id: "shield_dragon", slot: "shield", name: "Щит дракона", cost: 55, fx: { def: 2, heroDmgTaken: -0.2 }, text: "+2 захисту, −20% шкоди від умінь ворожих героїв" },
    shield_guard: { id: "shield_guard", slot: "shield", name: "Щит вартового", cost: 60, fx: { retaliations: 1 }, text: "Загони відповідають двічі за раунд" },
    boots_march: { id: "boots_march", slot: "feet", name: "Чоботи мандрівника", cost: 60, fx: { spdGround: 1 }, text: "+1 швидкість нелітаючим загонам" },
    boots_scout: { id: "boots_scout", slot: "feet", name: "Чоботи розвідника", cost: 20, fx: { deployRows: 1 }, text: "Зона розстановки більша на 1 ряд" },
    sandals: { id: "sandals", slot: "feet", name: "Крилаті сандалі", cost: 35, fx: { spdFly: 1 }, text: "+1 швидкість літаючим загонам" },
    ring_str: { id: "ring_str", slot: "ring", name: "Кільце сили", cost: 25, fx: { atk: 1 } },
    ring_def: { id: "ring_def", slot: "ring", name: "Кільце захисту", cost: 25, fx: { def: 1 } },
    ring_luck: { id: "ring_luck", slot: "ring", name: "Кільце удачі", cost: 25, fx: { luck: 1 } },
    ring_sniper: { id: "ring_sniper", slot: "ring", name: "Кільце снайпера", cost: 40, fx: { range: 2, shots: 1 }, text: "+2 дальності і +1 постріл стрільцям" },
    ring_blood: { id: "ring_blood", slot: "ring", name: "Кільце крові", cost: 55, fx: { meleeLifesteal: 0.1 }, text: "Загони ближнього бою лікуються на 10% завданої шкоди" },
};
exports.BALANCE = {
    /** Attack/defence of the "average enemy" in the power formula. */
    REF: 8,
    /** Power → points multiplier. */
    K: 9,
    defaultBudget: 1000,
    gearCapShare: 0.3,
    maxStacks: 6,
};
//# sourceMappingURL=items.js.map