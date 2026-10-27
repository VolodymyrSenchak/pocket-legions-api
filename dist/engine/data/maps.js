"use strict";
// Ported from design/data/maps.js. Each map lists obstacles for part of the field; the symmetry
// (grid.ts buildMap) adds the rest:
//   rot4 — 90° rotation (fair for 4 players in the corners and 2 players left/right),
//   rot2 — 180° rotation (fair for 2 players; corners are equal in pairs — for 2 vs 2).
// Coordinates: x is the column, y the row, from 0. w/h — object size in cells.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAP_IDS = exports.MAPS = exports.OBSTACLE_TYPES = void 0;
exports.OBSTACLE_TYPES = {
    rock: { name: "Камінь" },
    tree: { name: "Дерево" },
    pine: { name: "Ялина" },
    deadtree: { name: "Сухе дерево" },
    bush: { name: "Кущ" },
    grave: { name: "Надгробок" },
    water: { name: "Вода" },
    lava: { name: "Лава" },
    hay: { name: "Копиця сіна" },
    well: { name: "Криниця" },
    fence: { name: "Тин" },
    obsidian: { name: "Обсидіан" },
    pillar: { name: "Колона", high: true },
    house: { name: "Будинок", high: true },
    crypt: { name: "Склеп", high: true },
    mountain: { name: "Скеля", high: true },
    ruin: { name: "Руїна", high: true },
    mill: { name: "Млин", high: true },
    bridge: { name: "Міст", pass: true },
};
const water = (x, y) => ({ t: "water", x, y });
const bridge = (x, y) => ({ t: "bridge", x, y, w: 2 });
exports.MAPS = [
    {
        id: "arena", name: "Арена", size: 10, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "sand", sym: "rot4",
        desc: "Маленька арена з 4 колонами: швидкий бій, мало укриттів.",
        objects: [{ t: "pillar", x: 3, y: 3 }, { t: "rock", x: 5, y: 2 }],
    },
    {
        id: "valley", name: "Зелена долина", size: 12, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "grass", sym: "rot4",
        desc: "Відкрита долина зі ставком у центрі та гаями дерев.",
        objects: [
            { t: "water", x: 5, y: 5, w: 2, h: 2 }, { t: "tree", x: 3, y: 5 }, { t: "tree", x: 4, y: 4 },
            { t: "rock", x: 6, y: 3 }, { t: "bush", x: 2, y: 8 },
        ],
    },
    {
        id: "mill", name: "Старий млин", size: 14, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "farm", sym: "rot4",
        desc: "Млин посередині блокує прострілювання центру; навколо тини й копиці.",
        objects: [
            { t: "mill", x: 6, y: 6, w: 2, h: 2 }, { t: "well", x: 4, y: 4 }, { t: "fence", x: 7, y: 3 },
            { t: "fence", x: 8, y: 3 }, { t: "tree", x: 3, y: 6 }, { t: "hay", x: 10, y: 4 }, { t: "bush", x: 5, y: 9 },
        ],
    },
    {
        id: "river", name: "Річкова переправа", size: 14, players: "2 або 2 на 2", ffaPlayers: [2, 2], teams: true, theme: "grass", sym: "rot2",
        desc: "Річка ділить поле навпіл, перейти можна трьома мостами. Літуни та стрільці — королі.",
        objects: [
            ...[0, 1, 3, 4, 5, 8, 9, 10, 12, 13].map((y) => water(6, y)),
            ...[2, 6, 7, 11].map((y) => bridge(6, y)),
            { t: "tree", x: 4, y: 4 }, { t: "tree", x: 3, y: 9 }, { t: "bush", x: 4, y: 8 }, { t: "rock", x: 5, y: 12 },
        ],
    },
    {
        id: "graveyard", name: "Проклятий цвинтар", size: 16, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "dead", sym: "rot4",
        desc: "Склеп у центрі, ряди надгробків створюють вузькі проходи.",
        objects: [
            { t: "crypt", x: 7, y: 7, w: 2, h: 2 }, { t: "grave", x: 4, y: 4 }, { t: "grave", x: 6, y: 3 },
            { t: "grave", x: 5, y: 6 }, { t: "deadtree", x: 3, y: 8 }, { t: "deadtree", x: 10, y: 4 }, { t: "ruin", x: 6, y: 10 },
        ],
    },
    {
        id: "lava", name: "Лавові поля", size: 16, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "ash", sym: "rot4",
        desc: "Озера лави розрізають поле на сектори; обсидіанові брили — укриття.",
        objects: [
            { t: "lava", x: 7, y: 7, w: 2, h: 2 }, { t: "lava", x: 5, y: 4 }, { t: "lava", x: 6, y: 4 }, { t: "lava", x: 4, y: 5 },
            { t: "obsidian", x: 8, y: 3 }, { t: "obsidian", x: 3, y: 9 }, { t: "lava", x: 10, y: 5 },
        ],
    },
    {
        id: "pass", name: "Гірський перевал", size: 18, players: "2 або 2 на 2", ffaPlayers: [2, 2], teams: true, theme: "snow", sym: "rot2",
        desc: "Скелі утворюють три коридори. Повільним арміям тут важко, літунам — легко.",
        objects: [
            { t: "mountain", x: 8, y: 8, w: 2, h: 2 }, { t: "mountain", x: 5, y: 4, w: 3, h: 2 }, { t: "mountain", x: 12, y: 3, w: 2, h: 3 },
            { t: "mountain", x: 7, y: 12, w: 2, h: 2 }, { t: "pine", x: 3, y: 7 }, { t: "pine", x: 4, y: 8 }, { t: "pine", x: 11, y: 8 },
            { t: "rock", x: 9, y: 5 }, { t: "rock", x: 4, y: 13 },
        ],
    },
    {
        id: "village", name: "Село на перехресті", size: 20, players: "2–4", ffaPlayers: [2, 4], teams: true, theme: "village", sym: "rot4",
        desc: "Найбільша карта: хати, тини, криниця на площі. Багато укриттів від стрільців.",
        objects: [
            { t: "well", x: 9, y: 9, w: 2, h: 2 }, { t: "house", x: 5, y: 5, w: 2, h: 2 }, { t: "house", x: 12, y: 4, w: 2, h: 2 },
            { t: "fence", x: 8, y: 6 }, { t: "fence", x: 9, y: 6 }, { t: "tree", x: 3, y: 9 }, { t: "tree", x: 4, y: 15 },
            { t: "hay", x: 7, y: 3 }, { t: "bush", x: 15, y: 8 }, { t: "tree", x: 8, y: 13 },
        ],
    },
];
exports.MAP_IDS = exports.MAPS.map((map) => map.id);
//# sourceMappingURL=maps.js.map