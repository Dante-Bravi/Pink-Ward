# Pink Ward

Pink Ward is a desktop workspace for preparing datasets, training YOLO models,
and running image or video inference.

## Windows downloads

Each GitHub release can contain:

- `Pink-Ward-Installer-<version>-Windows-x64.zip`: per-user installer kit.
- `Pink-Ward-<version>-Windows-x64.7z`: portable build; extract it before use.
- `SHA256SUMS.txt`: checksums for verifying the downloads.

The packaged application targets 64-bit Windows 10 and Windows 11. It includes
Electron, Python, PyTorch, Ultralytics YOLO, OpenCV, and the other runtime
dependencies. Users do not need to install Node.js or Python.

Windows on ARM can run the x64 package through Windows emulation. A native ARM64
package is not currently produced because the Python/PyTorch runtime would need
a separate ARM64 build.

The release includes CUDA 12.6-enabled PyTorch. Compatible NVIDIA GPUs use CUDA
acceleration when the installed NVIDIA driver supports it. The same package
falls back to CPU execution on systems without a compatible NVIDIA GPU, so it
still runs on computers with Intel or AMD graphics.

## Install

1. Download the installer ZIP from the repository's Releases page.
2. Extract the complete ZIP.
3. Double-click `Install-Pink-Ward.cmd`.
4. Launch Pink Ward from the Start menu or desktop shortcut.

The installer places Pink Ward in `%LOCALAPPDATA%\Programs\Pink Ward` without
requiring administrator access. It also adds an entry to Windows installed apps.

The application is currently unsigned. Windows may show a warning before
running the downloaded installer script or application until releases are
signed with a trusted Windows code-signing certificate.

Pink Ward stores project metadata and imported project files under its Electron
user-data folder in `%APPDATA%`. Uninstalling the app does not delete that data.

## Build a Windows release

Build prerequisites:

- 64-bit Windows 10 or Windows 11
- Node.js 20 or newer
- 64-bit Python 3.12
- Internet access while creating the bundled Python runtime

From PowerShell:

```powershell
cd Main
npm ci
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-python-runtime.ps1
npm test
npm run dist
```

Release artifacts are written to `Main\dist`.

To build with a runtime located somewhere else:

```powershell
$env:PINK_WARD_RUNTIME_DIR = "C:\path\to\python-runtime"
npm run dist
```

The runtime builder installs CUDA 12.6 PyTorch. A separately prepared compatible
runtime can be selected by setting `PINK_WARD_RUNTIME_DIR` before packaging.

## Automated releases

The workflow in `.github/workflows/windows-release.yml` builds and verifies the
runtime on GitHub's Windows runner. It uploads artifacts for manual runs and
attaches them to a GitHub Release when a tag beginning with `v` is pushed.

Example:

```powershell
git tag v0.1.0
git push origin v0.1.0
```
