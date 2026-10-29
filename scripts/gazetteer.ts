import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface Place {
  name: string;
  aliases: string[];
}

/** Every country and territory, with its native name. */
export function countries(): Place[] {
  const { countries } = require("countries-list") as {
    countries: Record<string, { name: string; native: string; capital: string }>;
  };
  return Object.values(countries).map((c) => ({
    name: c.name,
    aliases: [c.native].filter((a) => a && a !== c.name),
  }));
}

export function capitals(): string[] {
  const { countries } = require("countries-list") as { countries: Record<string, { capital: string }> };
  return Object.values(countries)
    .map((c) => c.capital)
    .filter(Boolean);
}
