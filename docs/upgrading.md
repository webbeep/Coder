# Upgrading OpenCode (maintainers)

Coder runs exactly the OpenCode version pinned in [upstream.json](../upstream.json). Nobody's copy
updates itself. A new version reaches the team through one reviewed PR:

1. Read the release notes (https://github.com/anomalyco/opencode/releases), especially security
   fixes and changes to the plugin API, config keys or permission names.
2. Pin it:
   ```sh
   bun scripts/pin-upstream.ts 2.3.0
   git diff upstream.json
   ```
   This writes the npm integrity hash for each platform's CLI package, and the release's SHA-256
   for each desktop build.
3. If the GUI plugin SDK changed, update `@opencode/plugin` in `plugins/coder-editor/package.json`
   and run `./coder editor build`.
4. Open the PR. CI runs the unit tests, then an end-to-end agent run with the new binary against
   a mock model server on Windows, macOS and Linux, plus the sandbox self-test.
5. After merge, colleagues `git pull`. Their next `./coder` start downloads and verifies the new
   build.

Upgrading sandbox-runtime or Bun works the same way: change the version in `package.json` /
`bun.lock` (run `bun install`), or the Bun version and SHA-256 values in `coder` and `coder.ps1`
together with `upstream.json` → `bun.version`.
