/**
 * Per-category metadata: Tagalog translation + icon.
 *
 * The Category enum values stay English (they're the canonical labels used
 * in storage, reports, and admin views). Staff-facing UI uses
 * `staffCategoryLabel()` to render the bilingual form: "Breakfast (Almusal)".
 *
 * Translations chosen to match what palengke/B&B staff actually say day-to-day.
 * If a term has no widely-used Tagalog (Accounting, Compliance), we keep
 * the English so it doesn't read as fake.
 */

import {
  Bath,
  Briefcase,
  Calculator,
  ChefHat,
  Coffee,
  Droplet,
  Flame,
  Fuel,
  GlassWater,
  MoreHorizontal,
  Phone,
  ShieldCheck,
  Shirt,
  Sparkles,
  Sun,
  Users,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "./types";

export interface CategoryMeta {
  tagalog: string; // empty string means "no commonly used Tagalog word"
  icon: LucideIcon;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  Breakfast: { tagalog: "Almusal", icon: Sun },
  "Lunch/Dinner": { tagalog: "Tanghalian/Hapunan", icon: Utensils },
  "Staff Meals": { tagalog: "Pagkain ng staff", icon: Users },
  Coffee: { tagalog: "Kape", icon: Coffee },
  Kitchen: { tagalog: "Kusina", icon: ChefHat },
  "Room Supplies": { tagalog: "Gamit sa kwarto", icon: Bath },
  "Cleaning Supplies": { tagalog: "Panlinis", icon: Sparkles },
  Laundry: { tagalog: "Labada", icon: Shirt },
  Utilities: { tagalog: "Kuryente/Tubig", icon: Zap },
  "Drinking Water": { tagalog: "Inuming tubig", icon: GlassWater },
  Communications: { tagalog: "Telepono/Internet", icon: Phone },
  "Fuel & Gas": { tagalog: "Gasolina/LPG", icon: Fuel },
  Maintenance: { tagalog: "Pagkumpuni", icon: Wrench },
  Admin: { tagalog: "Pamamahala", icon: Briefcase },
  Accounting: { tagalog: "", icon: Calculator },
  Compliance: { tagalog: "", icon: ShieldCheck },
  Other: { tagalog: "Iba pa", icon: MoreHorizontal },
};

// Re-exports so consumers don't need a second import.
export { Droplet, Flame };

/**
 * Renders a staff-facing category label with the Tagalog translation in
 * parentheses, e.g. "Breakfast (Almusal)". If no translation is set,
 * returns the English label unchanged.
 */
export function staffCategoryLabel(category: Category): string {
  const tagalog = CATEGORY_META[category]?.tagalog;
  return tagalog ? `${category} (${tagalog})` : category;
}
