# Troubleshooting and earlier fixes

Start with the complete error in **Output**. Check the active project and environment before changing dependencies. Saving `platformio.ini` refreshes the environment list; build and dependency actions save the selected project's dirty files first.

## Libraries or board packages are not downloading

1. Open the folder containing the intended root `platformio.ini`.
2. Confirm that it has a valid `[env:name]` section, with a platform and board.
3. Select that environment in the bottom bar.
4. Put libraries under that environment's `lib_deps`, or under `[env]` when they must be shared.
5. Click **Install dependencies** and read **Output**. Check internet access and the first download error if the command fails.

The action runs `python -m platformio pkg install --environment <name>`. It does not upload firmware. Selecting a board or opening an INI file does not by itself trigger package installation. An unrelated environment does not inherit another environment's libraries just because both are in the same file. See the [configuration examples](DEPENDENCIES.md).

The earlier app gained a dedicated dependency action so downloads could be run and diagnosed without waiting for compilation. The bundled Python startup hook also restores the launched tool script's directory on its import path and uses UTF-8 for console streams. This addresses downloaded tool modules that live beside their entry script and Unicode progress errors from Windows console encodings.

## `platformio.ini` is missing from the explorer

ShahIO places the root `platformio.ini` first in each project's explorer. Click **Refresh explorer** if another program created it after the folder was opened. A folder without the file shows a **New project with platformio.ini** shortcut and an explanatory message.

Use **New project** to select a board and create a complete named child directory. Choose **Open folder** for an existing source project. A directory containing only a setup EXE is an installer download directory; it does not contain that EXE's editable application source.

## The old “2 MiB editor limit” error

The editable UTF-8 text limit is now **256 MiB**. Above **2 MiB**, the editor turns off syntax parsing and other expensive background features while retaining basic editing, history, copy/paste, and explicit find/replace. Large documents use persistent editor snapshots so every keystroke does not flatten the entire file into a new string.

An `.exe`, image, archive, or other binary file opens in a read-only, paged hex/ASCII viewer. Each page reads a bounded portion of the file. A compiled executable cannot be edited as C++ source: open the source project to change its code. The file is not converted to text or overwritten by the viewer. Non-UTF-8 files are also shown read-only; convert a copy to UTF-8 in a suitable encoding tool if text editing is needed.

## ESP32: missing `_contrib`, `esptool`, or Python helper dependencies

First update ShahIO to a release containing the portable Python import-path and UTF-8 fixes. Retry **Install dependencies** for the ESP32 environment and inspect the exact tool path in **Output**.

An incomplete cached `tool-esptoolpy` package can lack files or dependencies expected by its post-install script. An earlier affected cache was repaired by running that package's own official `package-postinstall.py`; the bundled interpreter's script-directory import fix was also required. A build or **Clean** does not necessarily rerun a damaged package's installation.

For a cache that still fails, stop builds and serial sessions, then use the integrated terminal to remove the affected managed tool and let the project install it again:

```powershell
pio pkg uninstall --global --tool platformio/tool-esptoolpy
pio pkg install --environment esp32dev
```

Replace `esp32dev` with the environment that actually uses ESP32. This affects the shared cached tool and may cause other ESP32 projects to download it again. Confirm the error identifies that package before using the command. The package manager is responsible for selecting a compatible version and running package installation; do not install random `esptool`, cryptography, or other Python versions globally to guess around the error. See the official [uninstall](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_uninstall.html) and [install](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_install.html) options.

## `LED_BUILTIN` redefinition or conflicting declaration

Arduino board packages often define `LED_BUILTIN` as a macro. A declaration such as `int LED_BUILTIN = 13;` then conflicts after preprocessing. Use a different variable name and keep any fallback conditional:

```cpp
#include <Arduino.h>

#if defined(LED_BUILTIN)
constexpr uint8_t LED_PIN = LED_BUILTIN;
#else
constexpr uint8_t LED_PIN = 13; // Adjust for the actual board or external LED.
#endif
```

Use `LED_PIN` in `pinMode` and `digitalWrite`. The project wizard uses this pattern. Some boards have no user LED, use a different pin, or have an active-low LED; check the board's documentation before uploading a Blink example.

## Duplicate `setup`, `loop`, or `main` definitions

Two source files with entry points are being compiled together. Use environment-specific `build_src_filter` values to select the intended source, as shown in [Dependencies](DEPENDENCIES.md#select-only-one-firmware-entry-point). Arduino needs `setup()` and `loop()`, ESP-IDF uses `app_main`, and a generic framework may need its own startup files.

## Terminal opens blank or ignores input

Use **Stop**, select PowerShell or Command Prompt, and start it again. Commands run in the selected project's folder. The bundled tools are added only to that terminal's PATH.

The earlier terminal issue came from a shell inheriting the Python helper's redirected JSON standard streams instead of ConPTY console handles. The helper now supplies explicit null standard handles with `STARTF_USESTDHANDLES`, allowing the pseudoconsole to provide the console handles. Native tests cover input, output, resize, and clean exit for both shells. The terminal requires Windows ConPTY support; the error shown in the panel is relevant if an operating-system policy prevents it from starting.

## New workspaces create separate windows

Update to a release with workspace tabs. Use the top **+** button, **New tab**, or `Ctrl+T`. `Ctrl+Tab` switches tabs and `Ctrl+Shift+W` closes the current workspace. Tabs use separate live editor views inside one main window, so switching does not recreate the editor or terminal. The folder grouping and selected tab restore at restart; unsaved buffers must be saved before closing.

## No COM port, busy port, or upload failure

- Use a USB data cable and check the board manufacturer's USB driver.
- Click **Refresh COM ports**, then select the port that actually appeared. A guessed COM number is not sufficient.
- Disconnect other serial monitors. One physical port cannot be used by two projects at the same time.
- ShahIO disconnects its own monitor before Upload; reconnect it afterward.
- Confirm the board definition, environment, and board-specific boot/reset procedure from the board documentation.
- Read the upload error before changing baud rate or package versions. Compilation failure and serial connection failure are different stages.

## MCP23017 grid stays gray or reports the wrong state

Blink does not emit the GPIO protocol. Use compatible firmware that sends `STATUS:` followed by 16 comma-separated `0`/`1` values. Choose the correct port and baud rate. The included `uno_mcp` example uses 9600 baud and the MCP23017 at I²C address `0x20`.

Check power, ground, address pins, reset, SDA/SCL, and valid input levels. Floating inputs can change unpredictably. The demo grid is simulated and labeled. A high GPIO level is not a current measurement or proof of a mechanical action. See [Firmware](FIRMWARE.md).

## Compiler or installer executable cannot run

Check whether the file exists and read Windows' exact error. A restricted process environment can block launching a compiler even when its packages downloaded successfully. Try the installed application in the normal desktop session. If the same executable remains blocked there, consult the system administrator with the full error; changing ShahIO's editor settings will not change Windows execution policy.

The supported setup builder uses the Windows x64 .NET Framework C# compiler and a checked ZIP payload. It avoids the earlier NSIS compiler launch problem. This does not bypass a machine's security controls. If packaging fails, use the build log to distinguish a missing compiler, a runtime preparation failure, and an execution-policy restriction.

## File changed outside ShahIO

The app compares file versions before saving. Reload the file to inspect the current disk content, or copy unsaved edits elsewhere before resolving the conflict. It preserves newer editor changes that arrive while a save or reload is in flight. Do not repeatedly retry a save expecting an external edit to be silently overwritten.

## Reporting another problem

Include the ShahIO version, Windows version, board ID, framework, selected environment, exact action, and relevant Output or terminal error in a [GitHub issue](https://github.com/shahataullah0314-web/ShahIO/issues). Include a minimal `platformio.ini` and source example when possible. Remove passwords, tokens, private repository URLs, and unrelated personal paths from logs before posting publicly.
