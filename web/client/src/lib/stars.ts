/**
 * R3 belt-and-suspenders: a poisoned rating already persisted in session or the
 * shared cache (e.g. 9.2) must never reach `"☆".repeat(negative)` → RangeError.
 */
export function starString(rating: number): string {
  const full = Math.min(5, Math.max(0, Math.round(rating)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}
