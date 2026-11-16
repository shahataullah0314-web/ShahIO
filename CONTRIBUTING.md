# Contributing to ShahIO

Use a [GitHub issue](https://github.com/shahataullah0314-web/ShahIO/issues) for a reproducible bug or feature request. Include the ShahIO and Windows versions, board ID, framework, selected environment, steps, expected behavior, actual behavior, and the relevant error. A small source example and `platformio.ini` make build failures easier to reproduce. Remove secrets and personal paths before posting logs.

For code changes:

1. Follow [Build from source](docs/BUILDING.md) and use the committed lockfiles.
2. Keep changes focused. Preserve project source files, unsaved editor buffers, and shared COM-port ownership.
3. Run the relevant tests, `npm test`, and `npm run test:ui` for app changes. State any skipped or hardware-only checks in the pull request.
4. Include a screenshot for a visible UI change and explain how it was checked on Windows.
5. Do not commit `node_modules`, downloaded runtimes, board packages, `.pio`, generated installers, private logs, or credentials. Put release binaries in GitHub Releases.

Changes to fixed build targets, filesystem containment, IPC validation, terminal lifecycle, or installer extraction should include tests that exercise the behavior or failure case. Hardware-dependent changes must identify the board and firmware used for validation.

Use the private reporting guidance in [SECURITY.md](SECURITY.md) for a security issue.
