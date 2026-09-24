# Check finite monitor adequacy

Adequacy asks whether equal monitor evidence always has equal labels in the supplied sample. Each state needs an identity, a label and a value for every declared monitor. It cannot establish adequacy over unobserved traces.

Run the passing fixture:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal adequacy check fixtures/adequacy-pass.json
```

Captured output excerpt (exit 0):
```text
  scope: finite supplied sample only; PASS is not universal adequacy over all traces
  PASS  ADEQUATE over observed finite sample: monitor evidence refines labels in this input
  certificate: 2 monitor(s), 2 evidence fibre(s), 2 label(s), 0 collision(s)
```

Now find a collision in the failing fixture:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal adequacy find-collision fixtures/adequacy-fail.json
```

Captured output excerpt (exit 1):
```text
  FAIL  monitor evidence does not refine labels over the observed finite sample
  collision: deploy-staging vs deploy-prod
    labels: "allow" vs "block"
    shared evidence: risk_score="medium", has_approval=true
    missing distinguisher (heuristic): environment
  FAIL  1 collision(s); no monitor-based policy over these monitors can be correct on this sample
```

Here the evidence cannot distinguish states whose labels differ. The suggested missing distinguisher is a heuristic: decide which observation is actually available and relevant, add it consistently to the data, then check again. Do not merely relabel a counterexample to force agreement.

A single-label sample can produce vacuous success:
Kit · Linux Bash · working directory: the pinned seal-assurance-kit checkout.

```bash
node bin/seal adequacy check fixtures/adequacy-vacuous.json
```

Captured output excerpt (exit 0):
```text
  scope: finite supplied sample only; PASS is not universal adequacy over all traces
  WARN  VACUOUS over observed finite sample: all 2 state(s) share label "allow"
  WARN  refinement holds, but this sample does not exercise a policy distinction
```

Exit 0 alone therefore does not establish useful distinction. Preserve the VACUOUS warning. The implementation's reference to a Lean warrant concerns the finite model described by seal-host; it does not make these user labels universally adequate.

Previous: [Compare receipt authorization surfaces](receipt-diff.md).
Up: [Assurance CLI](README.md).
Next: [Run the boundary conformance corpus](conformance.md).
