// --- Display formats shared by the UI and the exports ---

/** Price tier as dollar signs ("$$"), at most 4 */
export function priceTier(level: number): string {
  return "$".repeat(Math.min(level, 4));
}

/** Meters as kilometers with one decimal ("12.3") */
export function km(meters: number): string {
  return (meters / 1000).toFixed(1);
}
