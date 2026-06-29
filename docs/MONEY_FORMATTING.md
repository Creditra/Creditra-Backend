# Money formatting rules for API responses

To remove client-side ambiguity around precision, rounding, and currency, all
money-like fields in API responses use a single canonical shape produced by
`formatMoney` (`src/utils/money.ts`).

## Response shape

```jsonc
{
  "minorUnits": "123456", // integer, smallest currency unit, as a string (lossless)
  "amount": "1234.56",    // human-readable decimal string derived from minorUnits
  "currency": "USD",      // ISO-4217-style code, upper-cased
  "decimals": 2            // fractional digits used to derive `amount`
}
```

## Rules

- **`minorUnits` is the source of truth.** It is always an integer string in the
  currency's smallest unit (cents for USD, stroops for XLM, etc.). Clients should
  do arithmetic on `minorUnits`, never on `amount`.
- **No floating point.** Inputs that are non-integer numbers or malformed strings
  are rejected, because IEEE-754 floats cannot represent money losslessly.
- **No rounding on output.** `amount` is an exact decimal rendering of
  `minorUnits` at the given `decimals`; nothing is rounded away.
- **Currency precision is explicit.** Zero-decimal (JPY) and high-precision
  (XLM, 7) currencies are supported via the `decimals` argument.

## Usage

```ts
import { formatMoney } from '../utils/money.js';

res.json({ creditLimit: formatMoney(creditLimit, 'USD', 2) });
```

## Migration note

Existing endpoints that returned money as a bare number/string should adopt this
object shape. This is a breaking change for those fields: clients must read
`minorUnits`/`amount` instead of the scalar. Roll out behind an API version bump
where backwards compatibility is required.
