# Changelog

## 1.5.0 — ShahIO public release

- Renamed the application, executable, installer, and project identity to ShahIO.
- Prepared the public source repository with setup, dependencies, development, architecture, firmware, and troubleshooting documentation.
- Documented the earlier dependency, editor, configuration, terminal, and packaging fixes.

## 1.4.0 — Workspace tabs

- Replaced separate new workspace windows with browser-style tabs and a **+** button inside one main window.
- Kept each workspace's editor, terminal, and project state alive while switching.
- Added tab close checks, keyboard shortcuts, folder grouping restoration, and protection against late tab-loading/IPC responses.

## 1.3.0 — Large files, project creation, terminal

- Raised the editable UTF-8 text limit from 2 MiB to 256 MiB, with a lighter large-file editor mode.
- Added bounded, read-only binary previews for executables and other non-text files.
- Pinned `platformio.ini` first in the explorer and added missing-configuration guidance.
- Added complete named-project creation from board selection, including framework-specific starter files.
- Added per-project PowerShell and Command Prompt terminals using Windows ConPTY.
- Fixed redirected standard-handle inheritance so shell output and input use the pseudoconsole.

## 1.2.1 — Dependency fixes

- Added **Install dependencies** for the selected environment, with live Output progress.
- Added the bundled Python script-directory import and UTF-8 stream fixes for downloaded tools.
- Corrected shared library configuration and documented source filtering and `LED_BUILTIN` conflicts.
- Diagnosed and repaired an incomplete ESP32 esptool package cache.

## 1.2.0 — Self-contained Windows setup

- Bundled Electron, portable CPython, PlatformIO, pip, pyserial, and Git.
- Added a per-user x64 installer with verified payload extraction and shortcuts.
- Used the Windows x64 .NET Framework compiler for the setup bootstrap.

## Earlier development

- Added the editable explorer, file tabs, recent folders, concurrent projects, searchable board catalog, build/upload actions, serial monitoring, and MCP23017 telemetry/demo panels.
