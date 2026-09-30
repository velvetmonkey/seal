// SPDX-License-Identifier: Apache-2.0
// Host control: sign the configuration and the kernel's canonical challenge.
// There is no action resolution here. Every target byte comes from Lean.
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const utf8 = value => new TextEncoder().encode(value);

export async function authorizationSession(config) {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
  const sign = async bytes => hex(await crypto.subtle.sign("Ed25519", keys.privateKey, utf8(bytes)));
  // ToolSpecs are an explicit host-configuration input. Missing configuration
  // supplies no authority; neither a request nor synthesized policy rules may
  // create a spec. Existing host policy gates remain mandatory.
  const local = !Object.hasOwn(config, "authorization");
  const configured = local ? { ...config, authorization: {
    session: "host-policy", publicKey,
    manifestDigest: hex(await crypto.subtle.digest("SHA-256", utf8(JSON.stringify(config)))),
    policyVersion: String(config.epoch), maxApprovalTtl: 300,
    tools: Object.hasOwn(config, "toolSpecs") ? config.toolSpecs : [],
  } } : config;
  const { authorization, toolSpecs: _toolSpecs, ...policy } = configured;
  const payload = JSON.stringify({ policy, authorization });
  return { publicKey, envelope: JSON.stringify({ payload, signature: await sign(payload) }),
    async approve(M, step) {
      const input = JSON.parse(step);
      if (!local) return step;
      const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = JSON.parse(M.ccall("seal_challenge", "string",
        ["string", "string", "string", "string"],
        [input.line, String(input.now), String(input.now + 120), nonce]));
      input.signedApprovals = challenge.ok === true
        ? [{ signedMessage: challenge.signed_bytes, signature: await sign(challenge.signed_bytes) }]
        : [];
      return JSON.stringify(input);
    },
  };
}
