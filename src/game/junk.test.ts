import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fnv, isGiveUp, isJunk, type Lexicon } from "./junk";

const lex: Lexicon = JSON.parse(readFileSync(join(import.meta.dirname, "../../public/puzzles/lexicon.json"), "utf8"));

const JUNK = [
  "asdf", "asdfgh", "qwerty", "jkl", "hjkl", "lkjh", "fdsa", "tgb", "sdfsdf", "aaaa", "jfjfj",
  "fjdksl", "wkfjd", "qpwoei", "bnmv", "pqpq", "sjdhf", "kdjfg", "mxnz", "vbvb", "qazwsx",
  "zxcv", "uiop", "poiu", "alskdj", "idk", "pass", "?", "a", "dfjk", "gfhj", "kfkf", "asdf jkl", "sjdh fjdk",
];

const REAL = [
  "Japan", "Fiji", "Tuvalu", "Iowa", "Kyrgyzstan", "Djibouti", "Ljubljana", "Reykjavik", "Zimbabwe",
  "Popocatepetl", "Nkunku", "Coco", "BTS", "KFC", "Wii", "Xbox", "Pikachu", "Tchaikovsky", "Xi Jinping",
  "Giannis Antetokounmpo", "Nikola Jokic", "Ouagadougou", "Phnom Penh", "Eyjafjallajokull", "Mbappe",
  "Huawei", "Xiaomi", "Tbilisi", "Iqaluit", "Fred", "Barack Obama", "Elon Musk", "Shrek", "Up",
  // Three letters in a row only across a word break (the judge on hedge-funds: "merrilllynch").
  "Merrill Lynch", "Bell Labs", "Wall Lane",
  // The coverage audit (Nov 8): codes and acronyms, letters with digits, numbers, web addresses, and keyboard runs that
  // are only part of a word ("erty" in Liberty, "ytre" in Skytree).
  "TMNT", "CSGO", "BNHA", "FMAB", "ASML", "MKBHD", "xkcd", "himym", "LPGA", "RAV4", "4chan", "9gag", "6ix9ine",
  "tj maxx", "TK Maxx", "4", "21", "1989", "bbc.co.uk", "x.com", "Statue of Liberty", "Tokyo Skytree", "Skytree",
  "property", "tower", "glass", "Help!", "Hello",
];

describe("isJunk", () => {
  it.each(JUNK)("flags %s", (s) => expect(isJunk(s, lex)).toBe(true));
  it.each(REAL)("accepts %s", (s) => expect(isJunk(s, lex)).toBe(false));
  it("chat filler is junk until the bank knows it as a name (LoL is League of Legends)", () => {
    const bare: Lexicon = { alphabet: "", table: "", names: "" };
    expect(isJunk("lol", bare)).toBe(true);
    expect(isJunk("lol", { ...bare, names: fnv("lol").toString(36) })).toBe(false);
  });
});

describe("isGiveUp", () => {
  it.each(["pass", "idk", "dunno", "no idea", "I don't know", "no clue", "skip", "next", "?", "??"])("%s gives up", (s) => expect(isGiveUp(s)).toBe(true));
  it.each(["passport", "next door", "skipper", "Japan", "help"])("%s doesn't", (s) => expect(isGiveUp(s)).toBe(false));
});
