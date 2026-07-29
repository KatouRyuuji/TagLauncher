@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

:: Make cargo visible even if the terminal was opened before Rust install
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo ============================================================
echo  TagLauncher - Dev Mode
echo ============================================================

:: Preflight: Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Preflight: Rust / cargo
where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Rust toolchain (cargo^) not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Preflight: npm dependencies
if not exist "node_modules" (
    echo node_modules missing. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check the log above.
        pause
        exit /b 1
    )
)

echo Starting Tauri dev (first run compiles Rust, may take minutes^)...
call npm run tauri dev
if errorlevel 1 (
    echo.
    echo Dev mode exited with a non-zero code.
    echo If you stopped it with Ctrl+C, this is normal and not an error.
    echo Otherwise see the log above; if the environment is broken, run setup.bat to repair it.
    pause
    exit /b 1
)
exit /b 0
