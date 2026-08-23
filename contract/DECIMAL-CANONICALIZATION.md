# Decimal canonicalisation for the approval contract

## Status and scope

This is the normative extension of `contract/canonical.cjs` for JavaScript
`number` values.  It changes no other JSON value rule: strings use
`JSON.stringify`, object member names sort by UTF-8 byte comparison, arrays keep
their order, and object rendering remains compact.

The receiver MUST treat the input as an IEEE 754 binary64 value, not as its
source spelling.  A conforming encoder applies the following ordered rule.

1. If the value is not finite, refuse with exactly `non-finite number has no
   canonical form`.
2. If its numeric value is less than `-Number.MAX_SAFE_INTEGER` or greater than
   `Number.MAX_SAFE_INTEGER`, refuse with exactly `number outside the safe
   canonical range`.
3. Otherwise emit `JSON.stringify(value)`, as an ECMAScript JSON number token.
   The emitted token is the ECMAScript shortest decimal representation that
   parses back to that same binary64 value.  It has no whitespace or quotes.

`JSON.stringify` in step 3 is normative, including its `Number::toString`
formatting: fixed notation for magnitudes in its fixed-notation interval,
lower-case `e` outside it, and an explicit `+` on a positive exponent.  A
non-JavaScript implementation MUST produce the same token as ECMAScript
`JSON.stringify` for the same IEEE 754 binary64 bit pattern; using a correctly
rounded shortest-round-trip formatter configured to those ECMAScript notation
rules is conforming.

## Decisions

| Question | Decision | Reason | Cost |
| --- | --- | --- | --- |
| 1 | Wire form is an unquoted JSON number token: decimal digits, optional decimal point, and ECMAScript exponent where selected. | It stays in the existing compact-JSON family and preserves numeric type. | Implementations outside ECMAScript must match its formatter exactly. |
| 2 | `1.50` and `1.5` both encode as `1.5`. | The contract binds parsed binary64 values, not source lexemes; shortest round-trip text is unique. | Source-scale/trailing-zero intent is lost. |
| 3 | `-0.0` encodes as `0`; it is not distinct. | This preserves the existing integer-path rule at `canonical.cjs:21` and ECMAScript JSON output. | The sign bit of negative zero is irrecoverable. |
| 4 | Use ECMAScript exponent choice: `1e-7` encodes `1e-7`; exponent tokens use lower-case `e` and a positive sign when ECMAScript emits one (for example `1e+21`, if in range). | Reusing the exact JSON formatter makes the threshold and spelling deterministic. | It is not a universally fixed decimal-only presentation. |
| 5 | The accepted domain is finite binary64 values in inclusive `[-9007199254740991, 9007199254740991]`; at either boundary encode normally, immediately outside refuse with `number outside the safe canonical range`. | This inherits the contract's existing `MAX_SAFE_INTEGER` bound rather than silently widening what can be signed. | Very large finite doubles, including `1e21` and `Number.MAX_VALUE`, remain unavailable. |
| 6 | Canonicalise the actual binary64 value without rounding, decimal quantisation, or intent recovery. Thus `0.1 + 0.2` encodes `0.30000000000000004`, while literal `0.3` encodes `0.3`. | Any presentation-level repair would create an unstated rounding policy and can collapse distinct doubles. | Callers computing the same intended quantity differently can receive different signatures; this rule does not solve that application-level issue. |
| 7 | `NaN`, `Infinity`, and `-Infinity` remain refused with `non-finite number has no canonical form`. | They are not JSON numbers and `NaN` has multiple IEEE payloads, so accepting them would undermine a single portable numeric meaning. | Tools must represent such states explicitly (for example with strings) if needed. |
| 8 | It is reversible to the accepted binary64 numeric value: parsing the emitted token as an ECMAScript JSON number recovers the same value, except `-0` recovers as `+0`. | Shortest-round-trip serialization gives verifiers the same numeric value from the signed bytes. | It cannot recover source spelling, arithmetic provenance, decimal scale, integer-versus-float intent, or the negative-zero sign. |

## Compatibility and verification requirements

The receiver MUST reject an input string that is not this canonical token if it
is checking bytes rather than merely parsing JSON.  The vector table in
`contract/decimal-canonical-vectors.json` is normative.  A future product change
must update all canonicalizers that seal or verify the same commitment: the
approval-contract encoder, `spine/receipt-seal.cjs`, and
`checker/seal-receipt-check.mjs`, after confirming their domains and receipt
compatibility.

Existing integer output is unchanged: every accepted safe integer still uses its
ordinary decimal digits, and `-0` remains `0`.
