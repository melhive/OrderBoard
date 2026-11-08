import { describe, expect, it } from "vitest";
import { DEFAULT_MENU } from "../data/defaults";
import { buildMenuIndex, findMenuItem, parseItems, prepareTokens } from "./menuMatch";

const index = buildMenuIndex(DEFAULT_MENU);
const parse = (s: string) => {
  const r = parseItems(prepareTokens(s), index);
  return { items: r.lines.map((l) => `${l.qty}x ${l.item.name}`), unknown: r.unknown };
};

describe("parseItems", () => {
  it.each([
    ["pares w/ egg and rice", ["1x Pares w/ Egg & Rice"]],
    ["Pares with egg and rice", ["1x Pares w/ Egg & Rice"]],
    ["pares with rice and egg", ["1x Pares w/ Egg & Rice"]],
    ["pares egg rice", ["1x Pares w/ Egg & Rice"]],
    ["pares with egg", ["1x Pares w/ Egg"]],
    ["2 pares with egg and rice and 3 water", ["2x Pares w/ Egg & Rice", "3x Water"]],
    ["two mami and one softdrinks", ["2x Mami", "1x Softdrinks"]],
    ["a pares and a mami", ["1x Pares", "1x Mami"]],
    ["pares and mami", ["1x Pares", "1x Mami"]],
    ["mami pares", ["1x Mami", "1x Pares"]],
    ["siomai with rice", ["1x Siomai", "1x Rice"]],
    ["3 siomai with rice", ["3x Siomai", "3x Rice"]],
    ["siomai x3", ["3x Siomai"]],
    ["5 siomai, 2 coke", ["5x Siomai", "2x Softdrinks"]],
    ["two soft drinks", ["2x Softdrinks"]],
    ["paris with eggs", ["1x Pares w/ Egg"]],
    ["mommy with rice", ["1x Mami w/ Rice"]],
    ["pastel with egg", ["1x Pastil w/ Egg"]],
    ["shumai", ["1x Siomai"]],
    ["pares without egg", ["1x Pares"]],
    ["extra rice", ["1x Rice"]],
    ["mineral water", ["1x Water"]],
    ["a dozen siomai", ["12x Siomai"]],
    ["pares w egg n rice", ["1x Pares w/ Egg & Rice"]],
  ])("%s", (input, expected) => {
    expect(parse(input).items).toEqual(expected);
  });

  it("reports unknown items", () => {
    const r = parse("2 pares and kwek kwek");
    expect(r.items).toEqual(["2x Pares"]);
    expect(r.unknown).toEqual(["kwek kwek"]);
  });

  it("merges repeated mentions", () => {
    expect(parse("siomai, siomai, siomai").items).toEqual(["3x Siomai"]);
  });
});

describe("findMenuItem", () => {
  it("finds single items", () => {
    expect(findMenuItem("price of pares with egg", index)?.entry.name).toBe("Pares w/ Egg");
    expect(findMenuItem("water", index)?.entry.name).toBe("Water");
    expect(findMenuItem("lechon", index)).toBeNull();
  });
});
