# The gate and alternate routes

Seal places approval in selected Claude Code MCP routes. A selected tool call reaches the local wrapper before its child server; the boundary can hold that routed call for approval. Exact tool selection and argument predicates determine what is gated.

That route is not the whole machine. Bash, network access, subprocesses, other tools and other servers can reach the same data by different paths. Choosing a sensitive read matters even when the tool does not mutate data.

Coverage is an observation about known configuration, not proof that no alternate route exists. ACTIVE status is local route/runtime information; it does not prove the client actually used the route for a particular effect.

[Choose protection by consequence](../guide/choosing-what-to-protect.md), then inspect [current protection](../guide/what-is-protected-right-now.md). The disposable demo deliberately performs a direct write after the gated call to make this limit visible.

Previous: [Concepts](README.md).
Up: [Concepts](README.md).
Next: [Approval binds an exact request](approval.md).
