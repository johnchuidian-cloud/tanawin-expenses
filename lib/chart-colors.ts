/**
 * Palette for category/tag charts (pie + bar).
 *
 * Led by the Tanawin brand maroon (the biggest slice stays on-brand), then
 * spread across distinct earthy hues — ochre, teal, slate blue, terracotta,
 * plum, olive, amber, dusty blue, rose — so adjacent slices are easy to tell
 * apart instead of being a wall of similar reds. The hues vary but saturation
 * and value are kept muted so the set still reads warm and cohesive rather
 * than a primary-colour rainbow.
 *
 * These are raw hex values (not Tailwind classes) because SVG `fill`/`stroke`
 * and inline styles can't use Tailwind tokens.
 */
export const TAG_PALETTE = [
  "#9A3518", // maroon — brand accent (largest slice)
  "#C99030", // ochre / gold
  "#3F8074", // teal green
  "#4E6E94", // slate blue
  "#C2603E", // terracotta
  "#7E5079", // plum
  "#8A9A4E", // olive
  "#E08A3C", // amber
  "#5E8CA6", // dusty blue
  "#B05A6B", // rose
];

// Colour for the rolled-up "Other" slice/bar (everything past the top N).
export const TAG_OTHER_COLOR = "#C7C0AF"; // ink-100

/**
 * Deterministic colour for the slice at rank `index` (0 = largest). Wraps
 * around the palette if there are more visible slices than colours.
 */
export function tagColorAt(index: number): string {
  return TAG_PALETTE[index % TAG_PALETTE.length];
}
