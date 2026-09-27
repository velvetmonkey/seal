/* SPDX-License-Identifier: Apache-2.0
 *
 * Lean FFI shim for Ed25519 signature verification (seal v2, M5).
 *
 * TCB(A3) boundary: the actual Ed25519 verification is performed by vendored
 * TweetNaCl (c/tweetnacl.c, pure Ed25519 / RFC 8032, SHA-512). This shim only
 * marshals Lean `ByteArray` arguments and adapts TweetNaCl's ATTACHED
 * `crypto_sign_open` into a detached-verify predicate. No proof in the Lean core
 * depends on this code being correct; origin authentication is a trusted
 * assumption (A3 = "vendored ed25519 verify is correct"), not a Lean theorem.
 */

#include <lean/lean.h>
#include <string.h>
#include <stdlib.h>
#include "tweetnacl.h"

/* TweetNaCl declares `extern void randombytes(u8*, u64);` and references it from
 * crypto_box_keypair / crypto_sign_keypair only. The verify path (crypto_sign_open)
 * never calls it. We neither generate keys nor sign on the C side, so provide a
 * loud-failing stub: if it is ever reached, that is a misuse, not a silent weakness. */
void randombytes(unsigned char *x, unsigned long long xlen) {
    (void)x; (void)xlen;
    abort();
}

/* Detached Ed25519 verify: returns 1 iff `sig` (64 bytes) is a valid signature of
 * `msg` under public key `pk` (32 bytes), else 0. TweetNaCl ships only the attached
 * form, so reconstruct the signed message sm = sig || msg and check it opens cleanly. */
LEAN_EXPORT uint8_t lean_seal_ed25519_verify(b_lean_obj_arg pk_obj,
                                             b_lean_obj_arg msg_obj,
                                             b_lean_obj_arg sig_obj) {
    size_t pk_len  = lean_sarray_size(pk_obj);
    size_t msg_len = lean_sarray_size(msg_obj);
    size_t sig_len = lean_sarray_size(sig_obj);

    /* Ed25519: public key 32 bytes, signature 64 bytes. Reject anything else. */
    if (pk_len != 32 || sig_len != 64) return 0;

    const uint8_t *pk  = lean_sarray_cptr(pk_obj);
    const uint8_t *msg = lean_sarray_cptr(msg_obj);
    const uint8_t *sig = lean_sarray_cptr(sig_obj);

    /* RFC 8032 sec 5.1.7 step 1: decode the second signature half as an integer
     * S "in the range 0 <= s < L"; if S is out of range the signature is invalid.
     * Vendored TweetNaCl crypto_sign_open (c/tweetnacl.c:796) feeds S straight to
     * scalarbase with no range test, which per RFC 8032 sec 8.4 is exactly what
     * makes an Ed25519 verifier malleable (S' = S + m*L verifies too). We enforce
     * the check HERE, above the leaf, so the vendored file stays byte-for-byte
     * upstream. sig[32..63] is S in little-endian; L is the group order. */
    {
        /* L = 2^252 + 27742317777372353535851937790883648493, little-endian. */
        static const uint8_t ED25519_L[32] = {
            0xed,0xd3,0xf5,0x5c,0x1a,0x63,0x12,0x58,0xd6,0x9c,0xf7,0xa2,0xde,0xf9,0xde,0x14,
            0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x10 };
        const uint8_t *S = sig + 32;
        /* Lexicographic compare from the most-significant byte: reject unless
         * S < L. Operates on public signature bytes, so timing is not secret. */
        int lt = 0, gt = 0;
        for (int i = 31; i >= 0; i--) {
            int s = S[i], l = ED25519_L[i];
            lt |= (~gt) & (s < l);
            gt |= (~lt) & (s > l);
        }
        if (!lt) return 0;  /* S >= L (or S == L): out of range, invalid. */
    }

    /* Refuse exactly the verification keys the receipt checker refuses
     * (checker/seal-receipt-v2.mjs, checkPublicKey): with the x sign bit
     * (bit 255) cleared, a y coordinate at or above p = 2^255 - 19 is
     * noncanonical, and the five small-order y coordinates cover all eight
     * torsion points. TweetNaCl unpack25519 reduces y mod p and accepts
     * small-order points, under which forged signatures verify. The y value
     * is compared as encoded and never reduced. Operates on public key bytes,
     * so timing is not secret. */
    {
        /* p = 2^255 - 19, little-endian. */
        static const uint8_t ED25519_P[32] = {
            0xed,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
            0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f };
        /* Small-order y coordinates: 0, 1, p - 1, and the two order-8 values. */
        static const uint8_t SMALL_ORDER_Y[5][32] = {
            { 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
              0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 },
            { 0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
              0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 },
            { 0xec,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
              0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f },
            { 0x26,0xe8,0x95,0x8f,0xc2,0xb2,0x27,0xb0,0x45,0xc3,0xf4,0x89,0xf2,0xef,0x98,0xf0,
              0xd5,0xdf,0xac,0x05,0xd3,0xc6,0x33,0x39,0xb1,0x38,0x02,0x88,0x6d,0x53,0xfc,0x05 },
            { 0xc7,0x17,0x6a,0x70,0x3d,0x4d,0xd8,0x4f,0xba,0x3c,0x0b,0x76,0x0d,0x10,0x67,0x0f,
              0x2a,0x20,0x53,0xfa,0x2c,0x39,0xcc,0xc6,0x4e,0xc7,0xfd,0x77,0x92,0xac,0x03,0x7a } };
        uint8_t y[32];
        memcpy(y, pk, 32);
        y[31] &= 0x7f;
        int lt = 0, gt = 0;
        for (int i = 31; i >= 0; i--) {
            int a = y[i], b = ED25519_P[i];
            lt |= (~gt) & (a < b);
            gt |= (~lt) & (a > b);
        }
        if (!lt) return 0;  /* y >= p: noncanonical encoding, refused. */
        for (int k = 0; k < 5; k++) {
            if (memcmp(y, SMALL_ORDER_Y[k], 32) == 0) return 0;  /* small order, refused. */
        }
    }

    unsigned long long smlen = (unsigned long long)sig_len + (unsigned long long)msg_len;
    uint8_t *sm = (uint8_t *)malloc((size_t)smlen ? (size_t)smlen : 1);
    uint8_t *m  = (uint8_t *)malloc((size_t)smlen ? (size_t)smlen : 1);
    if (sm == NULL || m == NULL) { free(sm); free(m); return 0; }

    memcpy(sm, sig, 64);
    if (msg_len) memcpy(sm + 64, msg, msg_len);

    unsigned long long mlen = 0;
    int rc = crypto_sign_open(m, &mlen, sm, smlen, pk);

    free(sm);
    free(m);
    return (rc == 0) ? 1 : 0;
}
