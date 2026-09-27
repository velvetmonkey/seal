// SPDX-License-Identifier: Apache-2.0
"use strict";

// Ed25519 verification keys the receipt checker refuses
// (checker/seal-receipt-v2.mjs, checkPublicKey). Shared by the checker tests
// and the checker/WASM differential so both read one vector list.

// Published torsion-coordinate list: libsodium 1.0.18,
// src/libsodium/crypto_core/ed25519/ref10/ed25519_ref10.c,
// ge25519_has_small_order (https://github.com/jedisct1/libsodium/blob/1.0.18/src/libsodium/crypto_core/ed25519/ref10/ed25519_ref10.c).
// The two order-8 and the order-4 coordinates each have two x signs;
// identity and order-2 have x=0. These give all eight torsion points.
function torsionKeys() {
  const signs = (hex) => [hex, hex.slice(0, -2) + (parseInt(hex.slice(-2), 16) | 128).toString(16)];
  return ["01" + "00".repeat(31), "ec" + "ff".repeat(30) + "7f",
    ...signs("00".repeat(32)),
    ...signs("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"),
    ...signs("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a")];
}

// Every y at or above p = 2^255 - 19, with both x sign bits.
function noncanonicalKeys() {
  const p = (1n << 255n) - 19n;
  const keys = [];
  for (let y = p; y < (1n << 255n); y++) {
    for (const sign of [0n, 1n << 255n]) {
      keys.push(Buffer.from((y | sign).toString(16).padStart(64, "0"), "hex").reverse().toString("hex"));
    }
  }
  return keys;
}

// The identity and order-2 encodings with the x sign bit set. The checker
// clears that bit before comparing y, so it refuses these as small order too.
function signedZeroXKeys() {
  return ["01" + "00".repeat(30) + "80", "ec" + "ff".repeat(31)];
}

module.exports = { noncanonicalKeys, signedZeroXKeys, torsionKeys };
