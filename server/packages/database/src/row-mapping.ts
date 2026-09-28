import { Money } from '@ledgerflow/money';

/**
 * `node-postgres` returns `bigint` columns as strings, which is exactly what money needs:
 * parsing through `Number` would silently lose precision above 2^53. These helpers make the
 * conversion explicit at the repository boundary.
 */
export function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) {
    throw new TypeError('Expected a bigint column value, received null.');
  }
  return typeof value === 'bigint' ? value : BigInt(value);
}

export function toBigIntOrNull(value: string | number | bigint | null | undefined): bigint | null {
  return value === null || value === undefined ? null : toBigInt(value);
}

export function toMoney(amountMinor: string | number | bigint, currency: string): Money {
  return Money.of(toBigInt(amountMinor), currency);
}

export function toMoneyOrNull(
  amountMinor: string | number | bigint | null | undefined,
  currency: string | null | undefined,
): Money | null {
  if (amountMinor === null || amountMinor === undefined) return null;
  if (currency === null || currency === undefined) return null;
  return toMoney(amountMinor, currency);
}

/** Money is bound to SQL as a string so the driver sends it to a `bigint` column intact. */
export function moneyParam(money: Money): string {
  return money.amountMinor.toString();
}

export function bigIntParam(value: bigint): string {
  return value.toString();
}
