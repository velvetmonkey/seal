// SPDX-License-Identifier: Apache-2.0
// Parsed values that must authorize without rounding or changing scalar types.
module.exports = [
  { name: "decimal amount", args: { amount: 12.5 } },
  { name: "coordinates", args: { latitude: -33.8688, longitude: 151.2093 } },
  { name: "binary64 arithmetic result", args: { value: 0.1 + 0.2 } },
  { name: "scientific notation", args: { rate: 1e-7 } },
  { name: "fraction with leading zeroes", args: { rate: 1.2345678901234567e-6 } },
  { name: "small scientific notation", args: { rate: 1e-20 } },
  { name: "smallest positive binary64", args: { rate: Number.MIN_VALUE } },
  { name: "nested decimals", args: { data: { amount: 1.5, values: [2.5, -3.75] } } },
  { name: "control characters", args: { text: "a\tb\bc\fd" } },
  { name: "literal escape text", args: { text: "a\\tb\\bc\\fd" } },
  { name: "Unicode key ordering", args: { "\ue000": 1, "\ud800\udc00": 2 } },
  { name: "nested Unicode keys", args: { data: { "\ue000": 1, "\ud83d\ude00": 0.1 } } },
];
