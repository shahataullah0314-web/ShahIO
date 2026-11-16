# Architecture

ShahIO is a local Electron application. The main process owns project services, filesystem operations, Python processes, terminal processes, and dialogs. Editor pages use narrow preload APIs with Node.js integration disabled and context isolation enabled.

## Source map

| Path | Responsibility |
| --- | --- |
| `electron/main.js` | Application startup, settings, validated IPC, menus, and services |
| `electron/tabbed-window.js` | Workspace tabs and live child views inside one main window |
| `electron/workspace.js` | Shared project records, per-workspace sessions, port ownership |
| `electron/service.js` | Project build, dependency, upload, serial, and demo state |
| `electron/files.js` | Contained filesystem access, versioned saves, text limits, binary paging |
| `electron/boards.js`, `electron/projects.js` | Board catalog, environment changes, project scaffolding |
| `electron/pio.js` | Runtime discovery and fixed PlatformIO command arguments |
| `electron/serial_worker.py` | pyserial helper and line-based serial protocol |
| `electron/terminal.js`, `electron/terminal_worker.py` | Real Windows ConPTY terminal lifecycle and JSON transport |
| `ui/shell.*` | Browser-style workspace tab strip |
| `ui/renderer.js`, `ui/index.html`, `ui/styles.css` | Explorer, editor tabs, output and hardware panels |
| `ui/editor-entry.js`, `ui/terminal-entry.js` | CodeMirror and xterm.js bundle entry points |
| `ui/binary-view.js` | Bounded read-only hex and ASCII pages |
| `resources/starter-project` | Editable example copied on a clean installation |
| `src`, `platformio.ini` | Example firmware in the source tree |
| `scripts` | Runtime preparation, notices, and Windows installer generation |
| `installer` | C# setup UI, payload verification, and extraction |
| `test` | Node, DOM integration, and Python tests |

## Workspace and project lifetimes

One main window contains a shell tab strip and a separate live `WebContentsView` for each workspace. Switching visibility preserves each renderer's editor buffers, selections, output, and terminals. Closing a tab checks unsaved state and running builds before disposing its view and session. The final closed tab is replaced with a blank workspace.

A workspace can open multiple projects. Canonical folder paths identify shared project records, so opening the same folder in several workspaces shares one build and serial service. Different projects may build concurrently. A single project's build tasks are serialized, and serial/upload ownership prevents conflicting use of the same COM port.

The selected workspace and project folders are persisted. Editor buffers and shell processes are live-session state, not a disk-based crash-recovery system.

## Files and editing

Filesystem requests are scoped to opened project roots. The backend checks paths and canonical containment, rejects traversal and Windows alternate streams, and guards against overwrite conflicts using file versions. Text saves preserve UTF-8 BOM and line endings. The editor retains persistent document snapshots rather than copying a large document on every keystroke.

Files above 2 MiB use lighter editor extensions. The editable text maximum is 256 MiB. Binary detection happens before the text size check; binary previews read bounded pages and never load a whole executable just to display it.

## Commands and external tools

Build, upload, clean, and dependency actions construct fixed argument lists and launch a concrete Python executable without a shell. Upload requires an available COM port and releases the app's own serial connection. The integrated terminal is an intentional interactive shell with the user's permissions; it is separate from the fixed build-command API.

Bundled Python runs PlatformIO and serial/terminal helpers. A portable startup hook restores a launched script's sibling import directory and configures UTF-8 streams. The terminal helper communicates with Electron using JSON and connects the shell to Windows ConPTY, while xterm.js renders the virtual-terminal stream.

The application UI loads local packaged pages. Firmware dependencies, build scripts, and terminal commands can still access the computer and network through their own tools. Opening an unknown project should therefore be followed by reviewing its configuration before building it.
