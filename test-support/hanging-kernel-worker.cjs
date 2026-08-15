// SPDX-License-Identifier: Apache-2.0
// Deliberately ignores input and soft termination so the product must use a hard deadline.
process.on("SIGTERM", () => {});
for (;;) {}
