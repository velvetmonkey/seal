seal demo — one shared proxy, one hidden child, one real file
tool      demo.mutate  guarded
child     seal __demo-server (this same binary) mutating /home/monkey/scratch/runner-temp/tty-demo/child/data.txt
demo directory: /home/monkey/scratch/runner-temp/tty-demo (remains after the demo for the printed checker command)
child calls observed: 0 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count)
INPUT REQUIRED  the proxy holds this call's approval; the contract's message:
    Approval required
    Tool: demo.mutate
    Arguments:
      line: "seal demo wrote this line"
    Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min.
    Outside Seal: Bash, network, subprocesses, other tools and servers.
    Selection predicate: demo.mutate (bare tool name selects all calls)
child calls observed: still 0 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] y
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count)
replaying the identical elicitation response with the same id…
BLOCKED   the shared proxy recorded a BLOCK receipt for the replay: verdict BLOCK
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count)
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1788547289265-3933287-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1788547289713-3933287-0002-ALLOW.json
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1788547290172-3933287-0003-BLOCK.json

OUTSIDE THE SEAL PATH

Writing directly to /home/monkey/scratch/runner-temp/tty-demo/child/data.txt without calling the MCP server...

File changed: yes
Protected-server call count: still 1
New Seal decisions: 0

Seal did not observe or authorise this write.
receipts are claims, not proofs. To inspect the last receipt with the v2 checker, run:
  Run: (cd "/home/monkey/scratch/demoline3/work" && node checker/seal-receipt-v2.mjs "/home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1788547290172-3933287-0003-BLOCK.json" --pubkey "$(cat "/home/monkey/scratch/runner-temp/tty-demo/receipt-signer.pub")")
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.

ENFORCED
The approved demo.mutate call ran once; its replay produced a BLOCK receipt.

NOT APPROVAL-GATED
The direct write to /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.

NOT OBSERVED
That direct write; protected-server call count stayed 1 and Seal made 0 new decisions.
