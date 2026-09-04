/**
 * Colombian Peso money helpers.
 * Display format: "$ 1.234" — integer pesos only, dots for thousands,
 * no decimals (cents are rounded to the nearest peso for display).
 * Amounts are stored as integer centavos to avoid floating-point errors.
 */

export function formatCOP(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const pesos = Math.round(Math.abs(cents) / 100);
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$ ${grouped}`;
}

export function centsToPesos(cents: number): number {
  return cents / 100;
}

/**
 * Parse a user-entered amount into integer centavos.
 * Accepts: "$ 1.234,56", "$12.345", "1.234.567,89", "1,234.56", "1234.56", "1234", "1'234".
 * Rules: if both separators appear, the last one is the decimal separator.
 * If only one appears and it is followed by 1–2 digits, it is the decimal separator.
 * Returns null when the input cannot be parsed.
 */
export function parseAmountToCents(input: string): number | null {
  let s = input.trim().replace(/\s/g, '').replace(/^\$/, '').replace(/'/g, '');
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let decimalSep: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    decimalSep = after > 0 && after <= 2 ? ',' : null;
  } else if (lastDot >= 0) {
    const after = s.length - lastDot - 1;
    decimalSep = after > 0 && after <= 2 ? '.' : null;
  }

  let intPart: string;
  let fracPart = '';
  if (decimalSep) {
    const i = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, i);
    fracPart = s.slice(i + 1);
    if (fracPart.length > 2) fracPart = fracPart.slice(0, 2);
  } else {
    intPart = s;
  }
  intPart = intPart.replace(/[.,]/g, '');

  if (!/^\d+$/.test(intPart)) return null;
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null;

  const cents = Number(intPart) * 100 + (fracPart ? Number(fracPart.padEnd(2, '0')) : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}
