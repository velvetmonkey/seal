# Archive

This directory preserves documentation moved out of the main navigation.
This archive has eighteen files registered with claim-bearing-file-inventory; removing its WHAT-IS document makes that check fail, removing AUTHORIZATION-RECORD.md makes claim-coverage-inventory fail, and removing this README makes claims-drift fail.

## Claim coverage scope

This INJECTED claim-coverage relationship check establishes that the covering file references the covered file by path, or shares a specific literal with it, so a declaration cannot name a wholly unrelated file. It does not establish that the covering file actually tests the claim: it does not trace runtime dataflow, check that an assertion runs, or judge whether a claim is true. Known gaps are that one exact-path reference in a comment passes, one unused shared string of sixteen characters or more passes, a dead path reference passes, and a copied true literal passes. It is accepted because the residual forgery requires deliberate effort; the cold frisk recorded `accidental no`.
