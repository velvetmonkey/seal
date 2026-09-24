# Approval binds an exact request

An approval applies to the selected parsed call, rather than granting unrestricted future access to a tool. The request's identity includes its relevant tool and argument data. JSON member ordering is not a new permission; changing a meaningful argument is not the same request.

At-most-once means a consumed approval must not authorize a second execution through that boundary. It does not guarantee that a first attempt happens or succeeds. Expiry, refusal, process failure or a blocked decision can prevent execution.

The displayed tool, arguments and route help a person decide. A configured route label is not independently authenticated server identity. Review the consequences and the selected request before approving.

[Try the disposable demonstration](../guide/first-approval.md) to see a held call, one execution and a refused replay. For a real server, follow [tool selection](../guide/choosing-what-to-protect.md) and verify that the client route actually asks for approval.

Previous: [The gate and alternate routes](gate.md).
Up: [Concepts](README.md).
Next: [A decision is not an effect](decision-and-effect.md).
