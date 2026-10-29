import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isJunk, type Lexicon } from "./junk";

const lex: Lexicon = JSON.parse(readFileSync(join(import.meta.dirname, "../../public/puzzles/lexicon.json"), "utf8"));

const JUNK = [
  "asdf", "asdfgh", "qwerty", "jkl", "hjkl", "lkjh", "fdsa", "tgb", "sdfsdf", "aaaa", "jfjfj",
  "fjdksl", "wkfjd", "qpwoei", "bnmv", "pqpq", "xkcd", "sjdhf", "kdjfg", "mxnz", "vbvb", "qazwsx",
  "zxcv", "uiop", "poiu", "alskdj", "lol", "idk", "pass", "?", "a",
];

const REAL = [
  "Japan", "Fiji", "Tuvalu", "Iowa", "Kyrgyzstan", "Djibouti", "Ljubljana", "Reykjavik", "Zimbabwe",
  "Popocatepetl", "Nkunku", "Coco", "BTS", "KFC", "Wii", "Xbox", "Pikachu", "Tchaikovsky", "Xi Jinping",
  "Giannis Antetokounmpo", "Nikola Jokic", "Ouagadougou", "Phnom Penh", "Eyjafjallajokull", "Mbappe",
  "Huawei", "Xiaomi", "Tbilisi", "Iqaluit", "Fred", "Barack Obama", "Elon Musk", "Shrek", "Up",
];

describe("isJunk", () => {
  it.each(JUNK)("flags %s", (s) => expect(isJunk(s, lex)).toBe(true));
  it.each(REAL)("accepts %s", (s) => expect(isJunk(s, lex)).toBe(false));
});
