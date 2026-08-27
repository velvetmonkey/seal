seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /tmp/seal-provedlie-fixture.jakdPd/child/data.txt
demo directory: /tmp/seal-provedlie-fixture.jakdPd (remains after the demo for the printed checker command)
child calls observed: 0 (read from /tmp/seal-provedlie-fixture.jakdPd/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal demo wrote this line"
    Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
child calls observed: still 0 (read from /tmp/seal-provedlie-fixture.jakdPd/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /tmp/seal-provedlie-fixture.jakdPd/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /tmp/seal-provedlie-fixture.jakdPd/child/data.txt.count)
receipt written: /tmp/seal-provedlie-fixture.jakdPd/receipts/receipt-1787838329924-3295419-0001-INPUT_REQUIRED.json
receipt written: /tmp/seal-provedlie-fixture.jakdPd/receipts/receipt-1787838330371-3295419-0002-ALLOW.json
receipt written: /tmp/seal-provedlie-fixture.jakdPd/receipts/receipt-1787838330374-3295419-0003-BLOCK.json

OUTSIDE THE SEAL PATH

Writing directly to /tmp/seal-provedlie-fixture.jakdPd/child/data.txt without calling the MCP server...

File changed: yes
Protected-server call count: still 1
New Seal decisions: 0

Seal did not observe or authorise this write.
receipts are claims, not proofs. Check one with the separate-process checker (V11-RECEIPT-01). This installed payload does not include checker/seal-receipt-check.mjs. Clone https://github.com/velvetmonkey/seal and run the checker from that source checkout. It imports no Seal module at check time, but carries a byte-identical copy of Seal's canonicalisation rule and uses the same Node crypto platform. It can detect a changed canonical parsed value against your trusted key; semantically irrelevant JSON formatting differences are not distinguished. It cannot detect a defect shared by that rule or platform.
  From the checkout root: node checker/seal-receipt-check.mjs "/tmp/seal-provedlie-fixture.jakdPd/receipts/receipt-1787838330374-3295419-0003-BLOCK.json" --pubkey "/tmp/seal-provedlie-fixture.jakdPd/receipt-signer.pub"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.
  Online: https://velvetmonkey.github.io/seal-check/ re-checks a decision receipt you paste in your browser and reports its receipt checks; no backend, accounts, or telemetry. It does not establish that this setup routes calls through Seal, and it is not the checker command above.

ENFORCED
The approved demo.mutate call ran once; its replay was refused.

NOT APPROVAL-GATED
The direct write to /tmp/seal-provedlie-fixture.jakdPd/child/data.txt.

NOT OBSERVED
That direct write; protected-server call count stayed 1 and Seal made 0 new decisions.

ASSURANCE
authorization rule tested; product state and forwarding tested; client and machine trusted.
