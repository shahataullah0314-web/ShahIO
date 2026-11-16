# Security reporting

Report a suspected security vulnerability privately through the repository's **Security → Report a vulnerability** option when available. If that option is unavailable, open an issue asking for a private contact route without publishing exploit details, tokens, private files, or a working exploit against another person.

Include the affected ShahIO version, Windows version, component, reproduction steps, impact, and a minimal test case. The project does not currently promise a fixed response time or long-term support period. Update to the latest release before checking whether a problem has already been corrected.

ShahIO loads local application pages with isolated renderer contexts and validates its IPC requests. Filesystem actions are scoped to opened projects, and its build buttons use fixed PlatformIO command targets. These controls do not sandbox a firmware project's own build scripts or an interactive terminal. Review unfamiliar projects and dependency sources before building or running commands.

Only download release installers from the project's own [Releases page](https://github.com/shahataullah0314-web/ShahIO/releases) and compare the published SHA-256 checksum. Do not include credentials in public issues or logs. Bundled tools and firmware packages have their own upstream security advisories and licenses.
