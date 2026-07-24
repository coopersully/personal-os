# Google connector modules

Google OAuth and credential lifecycle are shared infrastructure. Calendar and
Mail adapters must be separate capability-specific modules so work on one does
not alter the other's synchronization behavior.

See [`docs/engineering/feature-ownership.md`](../../../../docs/engineering/feature-ownership.md).
