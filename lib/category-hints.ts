/**
 * Smart category suggestion.
 *
 * Simple keyword matching — no ML, no API. Each category has a list of
 * substring patterns we expect to find in the vendor or item name. The
 * category with the most hits wins; ties break by CATEGORIES order so
 * earlier (more common) categories win when ambiguous.
 *
 * Patterns are lowercase substring matches against `(vendor + " " + item)`.
 * Multi-word patterns let us require specific contexts ("electric bill"
 * vs the word "electric" alone in a hardware item name).
 *
 * Add new keywords here as Lexi and the team learn what staff actually
 * type. The match is forgiving — wrong suggestions are one tap away from
 * being ignored.
 */

import { getCategoryDefs } from "./store";
import type { Category } from "./types";

/**
 * Default keyword patterns shipped with the prototype. Exposed so the
 * /categories/manage page can show admins what triggers each built-in
 * category. To extend without code changes, admins use the "extra hints"
 * field on each category — that's stored on the def and merged with
 * these defaults at suggestion time.
 */
export const DEFAULT_HINTS: Record<Category, string[]> = {
  Breakfast: [
    "rice",
    "pandesal",
    "bread",
    "egg",
    "sugar",
    "milk",
    "oat",
    "cereal",
    "butter",
    "jam",
    "cheese",
    "cooking oil",
  ],
  "Lunch/Dinner": [
    "bangus",
    "chicken",
    "manok",
    "pork",
    "baboy",
    "beef",
    "baka",
    "fish",
    "isda",
    "lechon",
    "kamatis",
    "okra",
    "talong",
    "sayote",
    "vegetable",
    "gulay",
    "palengke",
  ],
  "Staff Meals": ["staff meal", "staff lunch", "staff merienda", "merienda"],
  Coffee: ["coffee", "kape", "espresso", "latte", "barako", "coffee mate"],
  Kitchen: [
    "pan",
    "knife",
    "utensil",
    "plate",
    "spatula",
    "kaldero",
    "tabo",
    "kawali",
    "wok",
    "tupperware",
    "cookware",
  ],
  "Room Supplies": [
    "towel",
    "soap",
    "shampoo",
    "conditioner",
    "lotion",
    "toiletr",
    "fragrance",
    "diffuser",
    "tissue",
    "toilet paper",
    "linen",
    "sheet",
    "pillow",
    "blanket",
    "kumot",
    "amenity",
    "amenities",
  ],
  "Cleaning Supplies": [
    "zonrox",
    "clorox",
    "bleach",
    "mop",
    "broom",
    "walis",
    "detergent",
    "sponge",
    "disinfectant",
    "lysol",
    "alcohol",
    "spray",
    "rag",
    "trapo",
  ],
  Laundry: ["downy", "ariel", "tide", "surf", "fabric softener", "labada", "laundry"],
  Utilities: [
    "penelco",
    "electric bill",
    "kuryente",
    "water bill",
    "tubig bill",
    "meralco",
    "bawd",
  ],
  "Drinking Water": [
    "drinking water",
    "mineral water",
    "distilled",
    "purified water",
    "absolute",
    "wilkins",
    "nature spring",
    "gallon",
  ],
  Communications: [
    "globe",
    "smart",
    "sim",
    "prepaid load",
    "load",
    "internet",
    "wifi",
    "pldt",
    "converge",
  ],
  "Fuel & Gas": ["gas", "lpg", "gasolina", "diesel", "petron", "shell", "caltex", "fuel"],
  Maintenance: [
    "repair",
    "tile",
    "grout",
    "paint",
    "fix",
    "hammer",
    "hardware",
    "screw",
    "nail",
    "plumbing",
    "electrical",
    "aircon",
    "wiring",
  ],
  Admin: ["paper", "ink", "printer", "office supply", "stapler", "folder"],
  Accounting: ["receipt book", "ledger", "calculator", "bookkeeper"],
  Compliance: ["bir", "permit", "dti", "sec", "lto", "license", "renewal"],
  Other: [],
};

/**
 * Returns the best-guess category for free-text input. Returns null when
 * nothing matches with any confidence, so the form can decline to show a
 * suggestion rather than guess wrong.
 *
 * Iterates the live category list so admin-added categories with extra
 * hints are picked up immediately. For built-ins, DEFAULT_HINTS and
 * `def.extraHints` are concatenated.
 */
export function suggestCategory(
  vendor: string,
  item: string,
): Category | null {
  const haystack = `${vendor} ${item}`.toLowerCase();
  if (haystack.trim().length === 0) return null;

  let best: { category: Category; hits: number } | null = null;
  for (const def of getCategoryDefs()) {
    if (def.id === "Other") continue;
    const keywords = [
      ...(DEFAULT_HINTS[def.id] ?? []),
      ...(def.extraHints ?? []),
    ];
    if (keywords.length === 0) continue;
    let hits = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) hits++;
    }
    if (hits === 0) continue;
    if (!best || hits > best.hits) {
      best = { category: def.id, hits };
    }
  }
  return best?.category ?? null;
}
