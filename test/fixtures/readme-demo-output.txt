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
child calls observed: still 0 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count) — approval shown, nothing executed
Approve? [y/N] y
child replied through the shared proxy: "demo server: appended 26 bytes to data.txt; total tool calls: 1"
child calls observed: 1 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count)
replaying the identical retry with the same requestState…
BLOCKED   the shared proxy refused the replay: "approval refused: already_consumed — this one-use approval has already been consumed"
one-use held: the replay did not run the call again; child calls observed: still 1 (read from /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.count)
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1787867994562-610297-0001-INPUT_REQUIRED.json
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1787867995050-610297-0002-ALLOW.json
receipt written: /home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1787867995507-610297-0003-BLOCK.json

OUTSIDE THE SEAL PATH

Writing directly to /home/monkey/scratch/runner-temp/tty-demo/child/data.txt without calling the MCP server...

File changed: yes
Protected-server call count: still 1
New Seal decisions: 0

Seal did not observe or authorise this write.
receipts are claims, not proofs. The separately landed v2 checker replays the recorded kernel decision and reports five rows; a signature alone cannot establish that the event happened.
  From the checkout root: node checker/seal-receipt-v2.mjs "/home/monkey/scratch/runner-temp/tty-demo/receipts/receipt-1787867995507-610297-0003-BLOCK.json" --pubkey "$(cat "/home/monkey/scratch/runner-temp/tty-demo/receipt-signer.pub")"
  Note: that key is the very one this demo used to sign the receipt, so checking against it proves only self-consistency — a hostile sealer could sign its own. To prove anything, supply a key you obtained from a source you already trust.

ENFORCED
The approved demo.mutate call ran once; its replay was refused.

NOT APPROVAL-GATED
The direct write to /home/monkey/scratch/runner-temp/tty-demo/child/data.txt.

NOT OBSERVED
That direct write; protected-server call count stayed 1 and Seal made 0 new decisions.

ASSURANCE
authorization rule tested; product state and forwarding tested; client and machine trusted.
