/**
 * StreamPay Money Utilities
 * BigInt-only arithmetic for token amounts. No floating point.
 */

const USDC_DECIMALS = 6;
const USDC_FACTOR = 10n ** BigInt(USDC_DECIMALS);

/**
 * Format base units to human-readable USDC string.
 * Example: 1500000n → "1.50"
 */
export function formatUSDC(baseUnits: bigint, maxDecimals = 6): string {
  if (baseUnits < 0n) return '-' + formatUSDC(-baseUnits, maxDecimals);

  const whole = baseUnits / USDC_FACTOR;
  const frac = baseUnits % USDC_FACTOR;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0');

  if (maxDecimals === 0) return whole.toString();
  const trimmed = fracStr.slice(0, maxDecimals).replace(/0+$/, '') || '0';
  return `${whole}.${trimmed}`;
}

/**
 * Parse a human-readable USDC string to base units.
 * Example: "1.50" → 1500000n
 */
export function parseUSDC(amount: string): bigint {
  const parts = amount.split('.');
  const whole = BigInt(parts[0] || '0') * USDC_FACTOR;
  if (parts.length === 1) return whole;

  const fracStr = (parts[1] || '0').slice(0, USDC_DECIMALS).padEnd(USDC_DECIMALS, '0');
  return whole + BigInt(fracStr);
}

// Aliases for lower/camelCase imports
export const formatUsdc = formatUSDC;
export const parseUsdc = parseUSDC;

/**
 * Calculate the cost for a given number of billable units.
 */
export function calculateCost(units: bigint, unitPrice: bigint): bigint {
  return units * unitPrice;
}

/**
 * Calculate maximum affordable units given a deposit and unit price.
 */
export function maxAffordableUnits(deposit: bigint, unitPrice: bigint): bigint {
  if (unitPrice === 0n) return 0n;
  return deposit / unitPrice;
}

/**
 * Format seconds to human-readable duration.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

/**
 * Format a rate comparison string.
 */
export function formatRateComparison(unitPrice: bigint): string {
  const hourCost = unitPrice * 3600n;
  return `At this rate, 1 hour costs $${formatUSDC(hourCost, 2)}`;
}
