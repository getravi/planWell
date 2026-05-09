/**
 * @module format
 * Pure formatting utilities for currency, numbers, and percentages.
 * All functions are deterministic and locale-pinned to `en-US`.
 */

/**
 * Formats a value as a full USD currency string with no decimal places.
 * @example currency(1234567) → "$1,234,567"
 */
export function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Formats a value as a compact USD currency string (e.g. $1.2M, $340K).
 * Used in chart axis labels where space is constrained.
 * @example compactCurrency(1234567) → "$1.2M"
 */
export function compactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Formats a numeric value with up to one decimal place (no currency symbol).
 * Used for headcount and other unitless metrics.
 * @example number(42.678) → "42.7"
 */
export function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

/**
 * Formats a ratio as a percentage string with up to one decimal place.
 * Returns "n/a" when the value is `null` or `undefined` (e.g. division-by-zero cases).
 * @example percent(0.1234) → "12.3%"
 * @example percent(null)   → "n/a"
 */
export function percent(value: number | null | undefined): string {
  return value == null
    ? "n/a"
    : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

/**
 * Formats a planning-cube cell value according to its account type.
 * Headcount cells use `number()`; all other accounts use `currency()`.
 * @param account - The account name (e.g. "Revenue", "Headcount")
 * @param value   - The raw numeric value to format
 */
export function formatCell(account: string, value: number): string {
  return account === "Headcount" ? number(value) : currency(value);
}
