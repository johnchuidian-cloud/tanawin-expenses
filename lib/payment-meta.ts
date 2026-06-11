/**
 * Funding-source colour coding, used everywhere an entry appears.
 *
 * Every expense row is tinted by where the money came from so Lexi can see
 * the PCF / Other-fund split at a glance in any list:
 *   - PCF (petty cash)  → light red
 *   - Other fund        → blue
 *
 * These use Tailwind's stock red/blue ramps (the brand config extends rather
 * than replaces the default palette). Keep all paid-from colouring in this
 * file so the scheme can be retuned in one place.
 */

import type { PaymentSource } from "./types";

/** Card/row surface tint: soft fill + a solid colour edge + hover. */
export function paidFromRowClasses(paidFrom: PaymentSource): string {
  return paidFrom === "other"
    ? "bg-blue-50 border-blue-200 border-l-4 border-l-blue-400 hover:bg-blue-100/70"
    : "bg-red-50 border-red-200 border-l-4 border-l-red-400 hover:bg-red-100/70";
}

/** Same tint without hover, for non-interactive surfaces. */
export function paidFromSurfaceClasses(paidFrom: PaymentSource): string {
  return paidFrom === "other"
    ? "bg-blue-50 border-blue-200 border-l-4 border-l-blue-400"
    : "bg-red-50 border-red-200 border-l-4 border-l-red-400";
}

/** Badge colouring for the PCF / Other fund chip. */
export function paidFromBadgeClasses(paidFrom: PaymentSource): string {
  return paidFrom === "other"
    ? "bg-blue-100 text-blue-800"
    : "bg-red-100 text-red-800";
}

export function paidFromLabel(paidFrom: PaymentSource): string {
  return paidFrom === "other" ? "Other fund" : "PCF";
}
