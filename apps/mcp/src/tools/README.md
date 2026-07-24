# MCP tool modules

Tool modules are feature-owned adapters over the typed API client. They must not
contain domain rules, provider calls, or policy bypasses. The MCP composition
root registers feature modules and remains responsible for server setup only.

See [`docs/engineering/feature-ownership.md`](../../../../docs/engineering/feature-ownership.md).
