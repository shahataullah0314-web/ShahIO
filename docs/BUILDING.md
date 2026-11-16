# Building and testing ShahIO

These instructions build the Windows x64 application from the public source checkout. Installing the release EXE does not require this development toolchain.

## Build requirements

| Requirement | Use |
| --- | --- |
| Windows 10/11 x64 | Electron packaging, ConPTY tests, and setup execution |
| Node.js 24.15 or newer in the 24.x line, with npm | JavaScript installation, tests, and packaging; Node 24.20 was used during development |
| Python 3.11 or newer with pip | Runtime preparation and installer scripts; CI uses Python 3.14 |
| Git | Clone the source and inspect changes |
| Windows .NET Framework x64 C# compiler | Compile `installer/Setup.cs` into the setup bootstrap |
| Internet access | Fetch locked npm packages, Python wheels, CPython, and MinGit |

The complete JavaScript test toolchain's current Node engine range is `^22.22.2 || ^24.15.0 || >=26.0.0`, set by jsdom. The Electron package's lower minimum alone is not sufficient for all tests. Use Node 24.x as in the Windows workflows.

The installer script looks for `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`; an alternate compiler path can be supplied with `--compiler`. A native C++ compiler is not needed for ShahIO's serial or terminal helpers. Firmware projects will download their own board toolchains through PlatformIO.

## Clone and install

Open PowerShell in a development directory:

```powershell
git clone https://github.com/shahataullah0314-web/ShahIO.git
Set-Location ShahIO
npm ci
python -m pip install -r requirements-build.txt
python scripts/prepare-python.py
python scripts/prepare-git.py
python scripts/collect-licenses.py
npm run build:editor
```

Use a concrete working `python` executable. If Windows resolves its Store shortcut instead, install a build Python and use its executable path or your working Python launcher. `requirements-build.txt` supplies pyserial for hardware-free Python tests. Bundled application dependencies are independently pinned in `vendor/runtime-requirements.txt`.

`prepare-python.py` downloads a checksum-pinned official embedded CPython ZIP and installs the locked Windows x64 wheel set into `vendor/python`. It writes the portable import/UTF-8 hook, excludes generated launchers and bytecode, performs smoke checks, and writes the runtime manifest. `prepare-git.py` downloads and verifies MinGit and retains its license notices. `collect-licenses.py` generates full JavaScript license notices for the packaged frontend dependencies.

Downloaded runtimes, caches, `node_modules`, `.pio`, generated editor bundles, and application installers are build products. They are not source-control dependencies. Do not add them to Git to make a local build work.

## Start during development

```powershell
$env:PIO_PYTHON = (Resolve-Path .\vendor\python\python.exe).Path
npm start
```

`PIO_PYTHON` selects the concrete prepared interpreter for the development app. The packaged app discovers its own bundled Python. Rebuild editor bundles after changing `ui/editor-entry.js` or `ui/terminal-entry.js`; changes to ordinary renderer HTML/JS/CSS require restarting or reloading the development app.

## Run checks

```powershell
npm test
npm run test:ui
python -m unittest discover -s test -p '*_test.py'
```

The Node suite covers contained project files, conflict-safe saves, large text/binary handling, board and project creation, dependency/build actions, project sharing, serial ownership, workspace tabs, and terminal lifecycle. DOM integration exercises the actual CodeMirror editor, project wizard, workspace shell, and UI actions. Windows terminal tests use the prepared Python and real PowerShell/CMD through ConPTY. Serial bridge unit tests do not require a board.

Some environments cannot create a symlink/junction needed by a path-containment test; that test reports its skip reason. Other errors should be investigated. A test suite does not verify electrical wiring, actual firmware flashing, or machine actuation.

## Package the app

After preparing runtimes and notices:

```powershell
npm run pack -- --config.electronDist=node_modules/electron/dist
```

The command builds CodeMirror/xterm.js assets and produces `dist/win-unpacked/ShahIO.exe` with its accompanying runtime files. Keep that whole folder together when using the unpacked application. The explicit Electron distribution option uses the distribution installed by `npm ci`.

Build the supported setup EXE:

```powershell
python scripts/build-installer.py --output-dir release --compression-level 3
python scripts/build-installer.py --verify-only release/ShahIO-Setup-1.5.0-x64.exe
```

Versioned outputs include the setup EXE, `.exe.sha256`, and `.build.json`. The build metadata records payload and installer hashes, sizes, architecture, and CRC verification. `--output-dir` avoids assumptions about the checkout's parent directory. The version in `package.json`, installer constants, manifest, and release tag must agree.

The supported setup builder compiles an x64 WinForms bootstrap with the Windows .NET compiler, appends a ZIP payload, and verifies its paths, required runtimes, CRCs, and SHA-256 before finalizing the EXE. It does not depend on NSIS. The optional `npm run dist` target uses electron-builder's portable/NSIS path and may have separate prerequisites or policy restrictions; it is not the documented release build.

## Installer smoke test

Use a fresh temporary application directory and a report path. This extracts the app without creating shortcuts or launching it:

```powershell
$smokeDir = Join-Path $env:TEMP ('ShahIO-smoke-' + [guid]::NewGuid().ToString('N'))
$report = Join-Path $env:TEMP 'ShahIO-smoke-report.txt'
$setup = (Resolve-Path .\release\ShahIO-Setup-1.5.0-x64.exe).Path
$run = Start-Process -FilePath $setup -ArgumentList @('--quiet', '--install-dir', ('"' + $smokeDir + '"'), '--no-shortcuts', '--no-launch', '--report', ('"' + $report + '"')) -WindowStyle Hidden -Wait -PassThru
if ($run.ExitCode -ne 0) { throw 'Installer smoke test failed.' }
Get-Content -LiteralPath $report
& (Join-Path $smokeDir 'resources/python/python.exe') -m platformio --version
& (Join-Path $smokeDir 'resources/git/cmd/git.exe') --version
```

Also open the installed app in a normal Windows desktop session and check project opening, save, workspace tabs, terminal startup, and serial UI. Use a real board only when performing an explicit hardware validation.

## GitHub Actions and publication

The **Windows checks** workflow runs the source audit, locked dependency installation, runtime preparation, editor build, Node/DOM tests, and Python serial tests on Windows.

The **Build Windows release** workflow is manually dispatched with an existing version tag such as `v1.5.0`. The tag must match `package.json`. Its default `publish: false` builds and verifies the installer and uploads workflow artifacts. Selecting `publish: true` enables the separate publication job after the build succeeds. Release binaries belong in GitHub Releases, not the Git source history.

Before publishing a prepared checkout, review the staged files and run:

```powershell
python scripts/check-public-source.py
```

This checks Git-selected source paths and common accidental credential patterns without printing matching secret values. It is a small guard, not a comprehensive secret scanner. Confirm that the source tree contains no personal project files, private paths, downloaded tool binaries, or credentials before pushing.
