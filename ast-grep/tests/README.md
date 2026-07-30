# Structural Rule Tests

This document is for contributors maintaining the ast-grep rules.
It answers which source owns each structural contract and where to verify a violation.

The tests cover syntax contracts that must remain visible in source structure.
Fallow owns named import seams.
Behavior tests own runtime contracts.
The Standards Specialist evaluates semantic naming, module ownership, and documentation authority.

Update a rule test when a supported structural contract changes.
Use behavior tests instead when the requirement concerns runtime output, errors, persistence, or another public seam.
