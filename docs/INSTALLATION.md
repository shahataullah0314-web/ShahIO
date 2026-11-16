# Installation

## Windows application

Use a 64-bit Windows 10 or Windows 11 PC with free space for the application and the board packages you plan to use. The bundled application occupies roughly 500 MiB before PlatformIO's board caches. Large SDKs and toolchains require additional space.

1. Open the repository's [Releases page](https://github.com/shahataullah0314-web/ShahIO/releases).
2. Download the `ShahIO-Setup-<version>-x64.exe` asset and its `.sha256` file.
3. Run the installer and select an application folder. Installation is per user; administrator access is not required for the default location.
4. Start **ShahIO** using the Desktop or Start menu shortcut.

On a clean PC, ShahIO creates an editable example under **Documents\ShahIO Projects\ShahIO Example**. If that name already exists, it chooses a new numbered folder rather than replacing source files.

The installer contains the application and its runtime dependencies. It validates its compressed payload before extraction. Windows' .NET Framework supplies the installer UI. The application itself runs with Electron and does not need a separately installed Node.js or .NET SDK.

To verify the downloaded file in PowerShell:

```powershell
Get-FileHash .\ShahIO-Setup-1.5.0-x64.exe -Algorithm SHA256
Get-Content .\ShahIO-Setup-1.5.0-x64.exe.sha256
```

Compare the hash with the release checksum. Checksums detect a corrupted or changed download; they are separate from a Windows publisher signature. If Windows or an organization blocks an executable, inspect the exact message and consult the responsible administrator.

## Create or open a project

**New project** opens the board selector. Select a board, supported framework, project name, and parent directory. ShahIO creates a new child folder containing the configuration and source structure. Arduino uses `src/main.cpp`; ESP-IDF uses `src/main.c` and the required CMake files. Mbed has its own starter. Generic frameworks may require additional initialization.

Use **Open folder** for an existing folder containing `platformio.ini`. The configuration belongs at the project root, alongside `src`, rather than inside `src`. Clicking `platformio.ini` in the explorer opens it for editing. An installer download folder is not automatically a firmware source project.

Choose an environment and click **Install dependencies**. The download progress appears in **Output**. A fresh project needs internet access for its platform, compiler, framework, libraries, and sometimes board-specific Python tools. After those packages are cached, many builds can run offline; fetching a new package still requires internet access.

## Upload and serial use

Connect a board with a USB data cable. If no port appears, install the appropriate driver supplied by the board or USB bridge manufacturer. Select the detected COM port in **Serial monitor** and use the correct baud rate for the firmware.

**Upload** writes the selected environment's firmware to the selected board. ShahIO releases its own serial monitor before uploading. Other applications holding the port must also disconnect. Reconnect ShahIO's serial monitor after the upload completes.

## Workspaces and terminals

The top **+** button creates another workspace tab in the same window. File buffers, outputs, and terminals remain alive while switching tabs. **Open folder** can add several projects to one workspace. Workspace folders and the selected workspace tab restore after restarting; save file edits before closing.

Click **Terminal** in the bottom bar to start PowerShell or Command Prompt in the active project's folder. Each project has its own terminal session. Use **Stop** before switching shells. Closing a project or workspace also closes its terminal. Commands run with the user's normal permissions.

## Moving to another PC

Copy the setup EXE to the other Windows x64 PC and install it there. Python, PlatformIO, pip, serial support, and Git are included. Board toolchains and firmware libraries are downloaded for the projects used on that PC.

Copy the complete source project folder, including `platformio.ini`, `src`, and any project-specific files. The `.pio` build folder can be regenerated. Update absolute paths and custom platform settings if the project uses them. USB port numbers can differ between PCs.

## Updating and removing the app

Install a new release into a new application version folder. Existing application directories are not overwritten by setup; when a target already exists, setup selects a suffixed folder. Projects and PlatformIO's downloaded caches are stored separately from the application.

ShahIO keeps its settings under `%APPDATA%\ShahIO`. On the first renamed launch, it can import valid settings from the earlier `embosser-control` profile when no ShahIO settings exist. Existing firmware directories are reopened by their saved paths; the rename does not move or rename a user's source projects.

To remove an installed copy, close it, remove that application's version folder, and remove its shortcuts. Keep the firmware source folders that you want to retain. Deleting the app folder does not uninstall a USB driver or remove PlatformIO's separate package cache.
