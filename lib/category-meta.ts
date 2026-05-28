/**
 * Per-category metadata: Tagalog translation + icon.
 *
 * The Category enum values stay English (they're the canonical labels used
 * in storage, reports, and admin views). Staff-facing UI uses
 * `staffCategoryLabel()` to render the bilingual form: "Breakfast (Almusal)".
 *
 * Since categories are now editable at runtime (see lib/store.ts), this
 * module exposes lookup helpers that resolve from the live store rather
 * than a static map. Icons are resolved through an icon registry that
 * lists every icon a custom category can choose from.
 */

import {
  Bath,
  Box,
  Briefcase,
  Calculator,
  ChefHat,
  Coffee,
  Cookie,
  Folder,
  Fuel,
  GlassWater,
  Heart,
  MoreHorizontal,
  Package,
  Phone,
  Pizza,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  Tag,
  Users,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { getCategoryDef } from "./store";
import type { Category } from "./types";

/**
 * Icon registry. Built-in categories use a fixed subset; the rest of the
 * icons here are surfaced in the category-create form so admins can pick
 * something visually appropriate for a new category. Adding to this map
 * is the only step needed to expand the icon options.
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  // Built-in icons
  sun: Sun,
  utensils: Utensils,
  users: Users,
  coffee: Coffee,
  "chef-hat": ChefHat,
  bath: Bath,
  sparkles: Sparkles,
  shirt: Shirt,
  zap: Zap,
  "glass-water": GlassWater,
  phone: Phone,
  fuel: Fuel,
  wrench: Wrench,
  briefcase: Briefcase,
  calculator: Calculator,
  "shield-check": ShieldCheck,
  "more-horizontal": MoreHorizontal,

  // Extras for user-added categories
  package: Package,
  folder: Folder,
  star: Star,
  tag: Tag,
  box: Box,
  heart: Heart,
  "shopping-cart": ShoppingCart,
  cookie: Cookie,
  pizza: Pizza,
};

/**
 * Icons offered in the "create category" picker. Skips the built-in
 * icons that are already strongly associated with seeded categories so
 * admins don't accidentally make a custom category that looks like
 * a built-in.
 */
export const PICKABLE_ICON_KEYS: string[] = [
  "package",
  "folder",
  "star",
  "tag",
  "box",
  "heart",
  "shopping-cart",
  "cookie",
  "pizza",
  "sparkles",
];

export function iconFor(category: Category): LucideIcon {
  const def = getCategoryDef(category);
  if (def && ICON_REGISTRY[def.iconKey]) return ICON_REGISTRY[def.iconKey];
  return Package;
}

export function tagalogFor(category: Category): string | undefined {
  return getCategoryDef(category)?.tagalog;
}

/**
 * Renders a staff-facing category label with the Tagalog translation in
 * parentheses, e.g. "Breakfast (Almusal)". If no translation is set,
 * returns the English label unchanged.
 */
export function staffCategoryLabel(category: Category): string {
  const tagalog = tagalogFor(category);
  return tagalog ? `${category} (${tagalog})` : category;
}
