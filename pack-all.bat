@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

:: One-click local release package: NSIS installer + portable zip for x64.
:: Local packaging covers Windows x64 only; ARM64 artifacts are built by CI
:: (release.yml dual-arch pipeline on tag push).

set "HOST_TRIPLE=x86_64-pc-windows-msvc"

:: Make cargo visible even if the terminal was opened before Rust install
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo ============================================================
echo  TagLauncher - Local Release Package (x64)
echo  (ARM64 artifacts are produced by CI, not locally)
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

echo.
echo Building %HOST_TRIPLE%...
call npm run tauri build
if errorlevel 1 goto :build_failed
call npm run pack:portable
if errorlevel 1 goto :pack_failed

echo.
echo ============================================================
echo  Local package complete (x64)!
echo  Bundle: src-tauri\target\release\bundle\
echo  (NSIS setup.exe under nsis\, portable zip next to it)
echo ============================================================
explorer "src-tauri\target\release\bundle"
pause
exit /b 0

:build_failed
echo.
echo [ERROR] Build failed. See the log above.
pause
exit /b 1

:pack_failed
echo.
echo [ERROR] Portable packaging failed. See the log above.
pause
exit /b 1
