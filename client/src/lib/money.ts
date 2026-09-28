const EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Formats an integer minor-unit string. Never parses the amount as a float. */
export function formatMinor(amountMinor: string, currency: string): string {
  const negative = amountMinor.startsWith("-");
  const digits = negative ? amountMinor.slice(1) : amountMinor;
  if (!/^\d+$/.test(digits)) return "—";
  const exponent = currencyExponent(currency);
  const padded = digits.padStart(exponent + 1, "0");
  const whole = exponent === 0 ? padded : padded.slice(0, padded.length - exponent);
  const fraction = exponent === 0 ? "" : padded.slice(padded.length - exponent);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const major = exponent === 0 ? grouped : `${grouped}.${fraction}`;
  return `${negative ? "-" : ""}${major} ${currency.toUpperCase()}`;
}

export function isMinorAmount(value: string): boolean {
  return /^\d+$/.test(value);
}
