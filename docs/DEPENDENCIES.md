# Dependencies

ShahIO has three dependency layers: the desktop application, its bundled tools, and the packages selected by each firmware project.

## Desktop and bundled tools

| Component | Version in this release | Purpose |
| --- | --- | --- |
| Electron | 45.3.1 | Desktop runtime and isolated editor views |
| CodeMirror | 6, resolved by `package-lock.json` | Source editor |
| xterm.js | 6.0.0 | Terminal display |
| CPython | 3.14.10, Windows x64 embedded distribution | Runs PlatformIO and Python helpers |
| PlatformIO Core | 6.2.0 | Board catalog, packages, builds, and uploads |
| pip | 26.3 | Python package installation support |
| pyserial | 3.5 | COM port discovery and serial communication |
| MinGit | 2.56.1.windows.1 | Git-based firmware dependencies and terminal Git commands |

`package-lock.json` records the JavaScript dependency tree. `vendor/runtime-requirements.txt` pins the bundled Python packages. `vendor/runtime-manifest.json` and `vendor/git-manifest.json` record download sources, checksums, versions, and files from the prepared runtimes. Runtime binaries are prepared during packaging rather than committed to the source repository.

The application uses Windows PowerShell and Command Prompt supplied by Windows. Its ConPTY helper is written in Python/ctypes, so it does not require compiling an Electron native terminal add-on. The terminal adds the bundled tools to its own PATH; it does not require changing the user's system PATH.

## Firmware packages

PlatformIO reads the project's `platformio.ini`:

| Setting | Selects |
| --- | --- |
| `platform` | A development platform, such as `atmelavr` or `espressif32` |
| `board` | A board definition within that platform |
| `framework` | Arduino, ESP-IDF, Mbed, or another supported framework |
| `lib_deps` | Registry libraries, compatible version ranges, or external sources |
| `platform_packages` | Explicit tool/framework overrides, when a project needs them |
| `build_src_filter` | Which source files are compiled for an environment |

**Install dependencies** uses the selected environment and runs:

```powershell
pio pkg install --environment uno
```

It downloads packages without compiling or uploading firmware. **Build** runs `pio run --environment uno`, which also resolves needed packages. Selecting a board alone creates configuration; it does not download every board tool or upload anything. [PlatformIO's package command reference](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_install.html) describes these package types and environment selection.

## Share libraries across environments

Put shared options under `[env]`. A library declared only under `[env:uno]` is not automatically a dependency of an unrelated ESP32 environment. Use the common section or explicit inheritance/interpolation. [PlatformIO documents common `lib_deps` configuration here](https://docs.platformio.org/en/latest/projectconf/sections/env/options/library/lib_deps.html).

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

Install for each environment you plan to build:

```powershell
pio pkg install -e uno
pio pkg install -e esp32dev
```

The selected MCP23017 library uses `Adafruit_MCP23X17.h`. Its package dependencies include Adafruit BusIO. Keep these as managed library dependencies instead of copying files into an unrelated Python or Arduino installation.

## Select only one firmware entry point

The included example offers Blink and optional MCP23017 telemetry. Both sources have `setup()` and `loop()`, so an environment must compile only the intended source:

```ini
[env]
monitor_speed = 9600
lib_deps =
    adafruit/Adafruit MCP23017 Arduino Library@^2.3.2

[env:uno]
platform = atmelavr
board = uno
framework = arduino
build_src_filter = +<*> -<mcp_monitor.cpp>

[env:uno_mcp]
extends = env:uno
build_src_filter = -<*> +<mcp_monitor.cpp>
```

`Clean` removes generated firmware build products. It does not delete source files or reliably repair an incomplete global tool package. Use the targeted package repair in [Troubleshooting](TROUBLESHOOTING.md) for that case.

## External dependency sources

PlatformIO can fetch Git repositories and other package sources specified by a project. Bundled Git supports Git-based downloads. Such dependencies and project build scripts run on the local PC during a build; review a source project before running its build or terminal commands. Proxy, certificate, firewall, and network policy settings can affect downloads independently of the editor.
