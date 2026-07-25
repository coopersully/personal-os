# Releasing ilo

Releases are immutable, semantically versioned Git tags. Use prereleases while
the hosted service remains invite-only: `v0.1.0-beta.1`, then `v0.1.0` when the
release is ready for broader use.

## Release checklist

1. Merge a reviewed pull request into `main` after `pnpm verify` passes.
2. Confirm that a staging deployment has applied the same migrations and that
   its backup/restore path has been exercised.
3. Update public documentation and write release notes with **Added**,
   **Changed**, **Fixed**, **Security**, **Self-hosting**, and **Known limits**
   sections as applicable.
4. Create and push an annotated `vX.Y.Z` tag. The release workflow builds the
   desktop installers and attaches them to a GitHub draft release.
5. Verify the downloaded macOS and Windows artifacts on clean machines before
   publishing the draft. Do not publish an unsigned desktop installer.
6. Build and deploy the API, MCP, and web images from the same release commit;
   keep exactly one API replica during migration-capable rollouts.
7. Publish the GitHub release, deployment notes, and any security advisory.

## Signing requirements

The macOS release needs `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID` GitHub secrets. Windows releases need a
base64-encoded `WINDOWS_CERTIFICATE` PFX plus
`WINDOWS_CERTIFICATE_PASSWORD`. Set `PERSONAL_OS_API_BASE_URL` as a GitHub
Actions variable. The release workflow intentionally fails before building if
any required signing or production-API value is missing.

Store all signing material only as GitHub Actions secrets. Never commit
certificates, provisioning profiles, Apple credentials, or updater private
keys.

## Compatibility

The desktop renderer is built with `VITE_API_BASE_URL`. Official installers
must point to the official HTTPS API; self-hosted builds may use their own API
address. Keep the desktop version in `apps/desktop/src-tauri/tauri.conf.json`
aligned with the release tag.
