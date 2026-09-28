import { AppError, ErrorCode } from '@ledgerflow/errors';

/**
 * ISO 4217 currency with its minor-unit exponent.
 *
 * The exponent is data, not a constant: JPY has no minor unit and KWD has three, so hardcoding
 * "two decimal places" anywhere in a payment platform is a bug waiting for its first customer.
 */
export interface Currency {
  readonly code: string;
  readonly exponent: number;
  readonly name: string;
}

const CURRENCIES = {
  INR: { code: 'INR', exponent: 2, name: 'Indian Rupee' },
  USD: { code: 'USD', exponent: 2, name: 'US Dollar' },
  EUR: { code: 'EUR', exponent: 2, name: 'Euro' },
  GBP: { code: 'GBP', exponent: 2, name: 'Pound Sterling' },
  SGD: { code: 'SGD', exponent: 2, name: 'Singapore Dollar' },
  AED: { code: 'AED', exponent: 2, name: 'UAE Dirham' },
  AUD: { code: 'AUD', exponent: 2, name: 'Australian Dollar' },
  JPY: { code: 'JPY', exponent: 0, name: 'Japanese Yen' },
  KWD: { code: 'KWD', exponent: 3, name: 'Kuwaiti Dinar' },
  BHD: { code: 'BHD', exponent: 3, name: 'Bahraini Dinar' },
} as const satisfies Record<string, Currency>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const SUPPORTED_CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export class UnsupportedCurrencyError extends AppError {
  constructor(code: string) {
    super({
      code: ErrorCode.UNSUPPORTED_CURRENCY,
      message: `Currency "${code}" is not supported.`,
      httpStatus: 400,
      category: 'PERMANENT',
      details: { currency: code, supported: SUPPORTED_CURRENCY_CODES },
    });
  }
}

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function getCurrency(code: string): Currency {
  if (!isSupportedCurrency(code)) {
    throw new UnsupportedCurrencyError(code);
  }
  return CURRENCIES[code];
}
