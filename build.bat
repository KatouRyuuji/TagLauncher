@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

:: Optional first argument: a Rust target triple (e.g. aarch64-pc-windows-msvc).
:: When omitted, builds for the host architecture (x64 on a typical PC).
set "TARGET=%~1"

:: Make cargo visible even if the terminal was opened before Rust install
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo ============================================================
echo  TagLauncher - Release Build
if defined TARGET echo  Target: %TARGET%
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

if defined TARGET (
    echo Ensuring Rust target %TARGET% is installed...
    rustup target add %TARGET%
    if errorlevel 1 (
        echo [ERROR] Failed to add Rust target %TARGET%.
        pause
        exit /b 1
    )
    echo Building Windows installers for %TARGET%...
    call npm run tauri build -- --target %TARGET%
) else (
    echo Building Windows installers...
    call npm run tauri build
)
if errorlevel 1 (
    echo [ERROR] Build failed. See the log above.
    pause
    exit /b 1
)

echo Packing portable zip...
if defined TARGET (
    call npm run pack:portable -- --target %TARGET%
) else (
    call npm run pack:portable
)
if errorlevel 1 (
    echo [ERROR] Portable packaging failed.
    pause
    exit /b 1
)

if defined TARGET (
    echo Build complete! Output: src-tauri\target\%TARGET%\release\bundle\
    explorer "src-tauri\target\%TARGET%\release\bundle"
) else (
    echo Build complete! Output: src-tauri\target\release\bundle\
    explorer "src-tauri\target\release\bundle"
)
pause
exit /b 0
