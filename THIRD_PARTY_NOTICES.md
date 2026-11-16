# Third-party software in ShahIO

ShahIO's own source is covered by the repository's [MIT license](LICENSE). The
components below keep their upstream licenses and copyright notices. Bundling
them does not change their licenses or imply endorsement by their authors.

## Windows application distribution

| Component | Version in this release | Upstream license / included notices |
| --- | --- | --- |
| Electron | 45.3.1 | Electron MIT license in the application folder's `LICENSE`; Chromium and other runtime notices in `LICENSES.chromium.html` |
| CodeMirror, Lezer, and browser editor dependencies | Exact versions in `package-lock.json` and the frontend license manifest | Full upstream MIT notices in `resources/licenses/` |
| xterm.js and FitAddon | 6.0.0 / 0.11.0 | Full upstream MIT notices in `resources/licenses/` |
| CPython Windows embedded runtime | 3.14.10 | PSF and bundled component notices in `resources/python/LICENSE.txt` |
| PlatformIO Core | 6.2.0 | Apache License 2.0 in `resources/python/Lib/site-packages/platformio-6.2.0.dist-info/licenses/LICENSE` |
| pip | 26.3 | MIT and vendored component notices in its `dist-info/licenses/` and `_vendor/` directories |
| pyserial | 3.5 | BSD-3-Clause; full upstream notice in `resources/licenses/pyserial-3.5-LICENSE.txt` |
| MinGit / Git for Windows | 2.56.1.windows.1 | Git GPL version 2 in `resources/git/LICENSE.txt`; additional bundled component licenses in the Git distribution |

`scripts/collect-licenses.py` copies complete notices for the npm libraries
included in the editor and terminal bundles. Its generated
`resources/licenses/frontend-license-manifest.json` records each package name,
version, stated license, and notice filename. Run it after `npm ci` when updating
dependencies. The application installer includes this directory.

## Portable Python packages

`vendor/runtime-requirements.txt` locks all resolved Python package versions used
by `scripts/prepare-python.py`. `vendor/runtime-manifest.json` records their
upstream wheel URLs, SHA-256 values, and runtime file inventory. Each package's
own notices remain in the installed `resources/python/Lib/site-packages` tree.
Examples include Apache-2.0, BSD, MIT, MPL-2.0, PSF, and public-domain notices;
consult each package's metadata and license files for its full terms.

The embedded runtime includes a small ShahIO `sitecustomize.py` adaptation to
make downloaded PlatformIO scripts import sibling files and emit UTF-8 progress
text. Its source is written explicitly by `scripts/prepare-python.py`.

## Git distribution and source

`vendor/git-manifest.json` lists the archive URL, pinned archive SHA-256, version,
and retained license-file paths. Those notices include Git itself and the
libraries/tools supplied by the official MinGit archive. Git is distributed as a
separate executable and is invoked by the app; it is not linked into ShahIO's
JavaScript.

- [Official Git for Windows release and distribution assets](https://github.com/git-for-windows/git/releases/tag/v2.56.1.windows.1)
- [Git for Windows source at the corresponding release tag](https://github.com/git-for-windows/git/tree/v2.56.1.windows.1)
- [Git for Windows build SDK and package sources](https://github.com/git-for-windows/build-extra)

## Other upstream sources

- [Electron](https://github.com/electron/electron)
- [CodeMirror](https://github.com/codemirror)
- [Lezer](https://github.com/lezer-parser)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Python 3.14.10](https://www.python.org/downloads/release/python-31410/)
- [PlatformIO Core](https://github.com/platformio/platformio-core)
- [pyserial](https://github.com/pyserial/pyserial)
- [pyserial 3.5 license source](https://github.com/pyserial/pyserial/blob/v3.5/LICENSE.txt)
- [pip](https://github.com/pypa/pip)

The source repository excludes downloaded runtimes and build products. The
release installer carries those runtime files and their included notices.
