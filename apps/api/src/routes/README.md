# API route modules

Route modules are feature-owned registration functions. They receive services,
authentication middleware, request parsing, and audit helpers from the API
composition root. Route modules do not construct services or access provider
clients directly.

The current API remains behavior-compatible while routes are incrementally
extracted. See [`docs/engineering/feature-ownership.md`](../../../../docs/engineering/feature-ownership.md).
