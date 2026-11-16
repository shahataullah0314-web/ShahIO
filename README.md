# ShahIO

**ShahIO is a Windows desktop workspace for PlatformIO projects.** Edit firmware, choose microcontroller boards, install project dependencies, build and upload, and use serial and PowerShell tools in one application. VS Code is not required.

[Download the Windows installer](https://github.com/shahataullah0314-web/ShahIO/releases/latest) · [Installation](docs/INSTALLATION.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Build from source](docs/BUILDING.md)

## Install and start

1. Download `ShahIO-Setup-1.5.0-x64.exe` from [Releases](https://github.com/shahataullah0314-web/ShahIO/releases).
2. Run the installer, choose an application folder, and open **ShahIO** from its shortcut.
3. Choose **New project** to select a board, framework, project name, and parent folder. Use **Open folder** for an existing PlatformIO project.
4. Edit `src/main.cpp` and `platformio.ini`, select the environment, then click **Install dependencies** or **Build**.
5. To upload, connect a board, select its real COM port in **Serial monitor**, and click **Upload**.

The installer includes Electron, Python, PlatformIO Core, pip, pyserial, and portable Git. It does not require a separate Node.js, Python, Git, or VS Code installation. Internet access is needed when PlatformIO downloads a selected board's compiler, framework, libraries, or additional tools. A board may also need its manufacturer's USB driver.

## What ShahIO includes

| Feature | Behavior |
| --- | --- |
| Workspace tabs | Use **+** to open another workspace inside the main window. Each tab keeps its own projects, editor buffers, and terminals while switching. |
| File explorer | Open multiple projects and recent folders; `platformio.ini` appears first. |
| Code editor | Editable file tabs, syntax colors, line numbers, undo/redo, find/replace, copy/paste, and conflict-aware saves. |
| Large files | Edit UTF-8 text up to **256 MiB**. Files above **2 MiB** use a lighter mode without syntax parsing. Binary files use a paged, read-only hex viewer. |
| Board selection | Search PlatformIO's catalog by board name, ID, MCU, or platform and select a supported framework. |
| Project creation | Create a named folder containing `platformio.ini`, `src/main`, `include`, `lib`, and `test`. An existing folder is never overwritten. |
| Build tools | Install dependencies, Build, Clean, Cancel, and Upload for the selected environment. Different projects can build concurrently. |
| Terminal | Real PowerShell or Command Prompt in the project's directory, with bundled `python`, `pip`, `pio`, and `git` on its PATH. |
| Serial monitor | Discover COM ports, choose baud rate, connect, receive output, and send line-based commands. |
| MCP23017 grid | Display 16 GPIO levels from compatible firmware, with an explicitly labeled demo mode. |

Workspace folders and the selected workspace tab restore after restarting. Unsaved editor buffers are kept while switching tabs; they must be saved before the app closes. Opening the same folder in multiple workspaces shares its build and serial service. One physical COM port can be owned by one project at a time.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+T` or `Ctrl+Shift+N` | New workspace tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous workspace tab |
| `Ctrl+Shift+W` | Close workspace tab |
| `Ctrl+Shift+O` | Open project folder |
| `Ctrl+S` / `Ctrl+Shift+S` | Save current file / save all files |
| `Ctrl+F` | Find and replace in the editor |
| `Ctrl+W` | Close the current editor file |
| `Ctrl+Alt+B` | Build the active project |
| `Ctrl+Shift+M` | Show serial monitor |

## Project libraries and dependencies

Declare firmware libraries in the project's `platformio.ini`. A common `[env]` section can provide libraries to multiple environments:

```ini
[platformio]
default_envs = uno

[env]
monitor_speed = 9600
lib_deps =
    adafruit/Adafruit MCP23017 Arduino Library@^2.3.2

[env:uno]
platform = atmelavr
board = uno
framework = arduino

[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
```

Select the intended environment in ShahIO, then click **Install dependencies**. This runs `python -m platformio pkg install --environment <name>` and shows progress in **Output**. **Build** also lets PlatformIO resolve required packages. The MCP23017 library declares Adafruit BusIO as a dependency, so it is resolved with the library rather than copied manually. See [Dependency management](docs/DEPENDENCIES.md) for environments, versions, and source filters.

## Documentation

- [Installation and moving to another PC](docs/INSTALLATION.md)
- [Dependencies and example platformio.ini configurations](docs/DEPENDENCIES.md)
- [Troubleshooting and fixes for earlier problems](docs/TROUBLESHOOTING.md)
- [Building, testing, and packaging from source](docs/BUILDING.md)
- [Architecture and source layout](docs/ARCHITECTURE.md)
- [Serial protocol and optional MCP23017 firmware](docs/FIRMWARE.md)
- [Changelog](CHANGELOG.md), [contributing](CONTRIBUTING.md), and [security reports](SECURITY.md)

## Requirements and scope

The packaged application targets **64-bit Windows 10/11** and installs per user. The setup UI uses Windows' .NET Framework. Board support comes from PlatformIO's catalog; a matching board definition does not replace board-specific wiring, drivers, or framework setup. Arduino, ESP-IDF, and Mbed projects receive framework-specific starters; other frameworks receive a generic source skeleton that may need adaptation.

ShahIO is an independent project by Ataullah Shah and is not an official PlatformIO or Microsoft product. Builds and uploads are real commands. The optional MCP23017 firmware observes inputs; it does not actuate a machine. See the [firmware guide](docs/FIRMWARE.md) before using the hardware controls. Physical flashing and machine operation require validation on the user's own board.

## License

ShahIO's own code is available under the [MIT License](LICENSE). Bundled libraries and tools keep their respective licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md). The installer includes those notices and the licenses supplied by its bundled runtimes.
