@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

:: One-click full release package: NSIS installers + portable zips for BOTH
:: x64 and ARM64, mirroring the CI release pipeline (release.yml).
:: The host architecture builds natively; the other one cross-compiles via
:: --target. Cross ARM64 builds need the "MSVC v143 - ARM64 build tools"
:: component (see build-arm64.bat); cross x64 builds on an ARM64 host need
:: the x64 MSVC toolset (present in a default VCTools workload).

set "HOST_TRIPLE=x86_64-pc-windows-msvc"
set "OTHER_TRIPLE=aarch64-pc-windows-msvc"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "HOST_TRIPLE=aarch64-pc-windows-msvc"
    set "OTHER_TRIPLE=x86_64-pc-windows-msvc"
)

:: Make cargo visible even if the terminal was opened before Rust install
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo ============================================================
echo  TagLauncher - Full Release Package (x64 + ARM64)
echo  Host: %HOST_TRIPLE% ^| Cross: %OTHER_TRIPLE%
echo ============================================================

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Rust toolchain (cargo^) not found. Run setup.bat first.
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo Ensuring Rust target %OTHER_TRIPLE% is installed...
rustup target add %OTHER_TRIPLE%
if errorlevel 1 (
    echo [ERROR] Failed to add Rust target %OTHER_TRIPLE%.
    pause
    exit /b 1
)

echo.
echo [1/2] Building %HOST_TRIPLE% (host)...
call npm run tauri build
if errorlevel 1 goto :build_failed
call npm run pack:portable
if errorlevel 1 goto :pack_failed

echo.
echo [2/2] Building %OTHER_TRIPLE% (cross)...
call npm run tauri build -- --target %OTHER_TRIPLE%
if errorlevel 1 goto :build_failed
call npm run pack:portable -- --target %OTHER_TRIPLE%
if errorlevel 1 goto :pack_failed

echo.
echo ============================================================
echo  Full package complete!
echo  Host  bundle: src-tauri\target\release\bundle\
echo  Cross bundle: src-tauri\target\%OTHER_TRIPLE%\release\bundle\
echo  (NSIS setup.exe under nsis\, portable zips next to it)
echo ============================================================
explorer "src-tauri\target\release\bundle"
pause
exit /b 0

:build_failed
echo.
echo [ERROR] Build failed. See the log above.
echo Cross-compiling may require extra MSVC components - see build-arm64.bat header.
pause
exit /b 1

:pack_failed
echo.
echo [ERROR] Portable packaging failed. See the log above.
pause
exit /b 1
