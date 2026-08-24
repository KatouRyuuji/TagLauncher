@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  TagLauncher - One-Click Environment Setup
echo  Checks and installs: Node.js, Rust, VS Build Tools,
echo  WebView2 Runtime, then installs npm dependencies.
echo ============================================================
echo.

set "SETUP_FAILED=0"
set "NEED_RESTART=0"

:: Make freshly-installed cargo visible in this session
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

:: ---------------------------------------------------------
:: [1/5] Node.js (require v20+)
:: ---------------------------------------------------------
echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js not found. Installing via winget...
    call :ensure_winget || goto :winget_missing_node
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo   [ERROR] Node.js install failed. Install manually: https://nodejs.org/
        set "SETUP_FAILED=1"
    ) else (
        echo   Node.js installed. A new terminal may be required for PATH refresh.
        set "NEED_RESTART=1"
    )
    goto :node_done
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
echo   Node.js found:
node -v
if defined NODE_MAJOR if %NODE_MAJOR% LSS 20 (
    echo   [WARN] Node.js v20+ is recommended. Current version may not work.
)
goto :node_done
:winget_missing_node
echo   [ERROR] winget unavailable. Install Node.js v20+ manually: https://nodejs.org/
set "SETUP_FAILED=1"
:node_done
echo.

:: ---------------------------------------------------------
:: [2/5] Rust toolchain (rustup + cargo, MSVC host)
:: ---------------------------------------------------------
echo [2/5] Checking Rust toolchain...
where cargo >nul 2>nul
if errorlevel 1 (
    echo   Rust not found. Installing rustup...
    call :install_rust
) else (
    echo   Rust found:
    cargo -V
)
:: Ensure a default toolchain is set (winget silent install may skip it)
where rustup >nul 2>nul
if not errorlevel 1 (
    rustup show active-toolchain >nul 2>nul
    if errorlevel 1 (
        echo   No default toolchain. Installing stable...
        rustup default stable
        if errorlevel 1 (
            echo   [ERROR] Failed to install stable toolchain. Run: rustup default stable
            set "SETUP_FAILED=1"
        )
    )
)
echo.

:: ---------------------------------------------------------
:: [3/5] Visual Studio C++ Build Tools (MSVC linker)
:: ---------------------------------------------------------
echo [3/5] Checking Visual Studio C++ Build Tools...
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VC_FOUND=0"
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath 2^>nul`) do set "VC_FOUND=1"
)
if "%VC_FOUND%"=="1" (
    echo   VS C++ Build Tools found.
) else (
    echo   VS C++ Build Tools not found. They are required to compile Rust on Windows.
    echo   This download is large (several GB^). Installing via winget...
    call :ensure_winget || goto :winget_missing_vs
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if errorlevel 1 (
        echo   [ERROR] Build Tools install failed. Install manually:
        echo     https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo     Select workload: "Desktop development with C++"
        set "SETUP_FAILED=1"
    ) else (
        echo   VS Build Tools installed.
        set "NEED_RESTART=1"
    )
)
goto :vs_done
:winget_missing_vs
echo   [ERROR] winget unavailable. Install Build Tools manually:
echo     https://visualstudio.microsoft.com/visual-cpp-build-tools/
set "SETUP_FAILED=1"
:vs_done
echo.

:: ---------------------------------------------------------
:: [4/5] WebView2 Runtime
:: ---------------------------------------------------------
echo [4/5] Checking WebView2 Runtime...
set "WV2_FOUND=0"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "WV2_FOUND=1"
reg query "HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>nul && set "WV2_FOUND=1"
if "%WV2_FOUND%"=="1" (
    echo   WebView2 Runtime found.
) else (
    echo   WebView2 Runtime not found. Installing via winget...
    call :ensure_winget || goto :winget_missing_wv2
    winget install --id Microsoft.EdgeWebView2Runtime -e --accept-source-agreements --accept-package-agreements --silent
    if errorlevel 1 (
        echo   [ERROR] WebView2 install failed. Install manually:
        echo     https://developer.microsoft.com/microsoft-edge/webview2/
        set "SETUP_FAILED=1"
    )
)
goto :wv2_done
:winget_missing_wv2
echo   [ERROR] winget unavailable. Install WebView2 manually:
echo     https://developer.microsoft.com/microsoft-edge/webview2/
set "SETUP_FAILED=1"
:wv2_done
echo.

:: ---------------------------------------------------------
:: [5/5] npm dependencies
:: ---------------------------------------------------------
echo [5/5] Installing npm dependencies...
where npm >nul 2>nul
if errorlevel 1 (
    echo   [SKIP] npm not on PATH yet. Open a NEW terminal and run: npm install
    set "NEED_RESTART=1"
) else (
    call npm install
    if errorlevel 1 (
        echo   [ERROR] npm install failed. Check the log above.
        set "SETUP_FAILED=1"
    ) else (
        echo   npm dependencies installed.
    )
)
echo.

:: ---------------------------------------------------------
:: Summary
:: ---------------------------------------------------------
echo ============================================================
if "%SETUP_FAILED%"=="1" (
    echo  Setup finished WITH ERRORS. Fix the items above and re-run.
) else if "%NEED_RESTART%"=="1" (
    echo  Setup complete. Open a NEW terminal, then run dev.bat.
) else (
    echo  Setup complete. Run dev.bat to start developing.
)
echo ============================================================
pause
exit /b %SETUP_FAILED%

:: ---------------------------------------------------------
:: Helpers
:: ---------------------------------------------------------
:ensure_winget
where winget >nul 2>nul
exit /b %errorlevel%

:install_rust
where winget >nul 2>nul
if not errorlevel 1 (
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements --silent
    if not errorlevel 1 goto :rust_installed
    echo   winget install failed, falling back to rustup-init...
)
:: Fallback: download rustup-init.exe (curl ships with Windows 10 1803+)
:: Pick the rustup installer matching the CPU architecture (ARM64 or x86_64)
set "RUSTUP_URL=https://win.rustup.rs/x86_64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "RUSTUP_URL=https://win.rustup.rs/aarch64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "RUSTUP_URL=https://win.rustup.rs/aarch64"
curl -fsSL -o "%TEMP%\rustup-init.exe" "%RUSTUP_URL%"
if errorlevel 1 (
    echo   [ERROR] Could not download rustup. Install manually: https://rustup.rs/
    set "SETUP_FAILED=1"
    exit /b 1
)
"%TEMP%\rustup-init.exe" -y --default-toolchain stable
if errorlevel 1 (
    echo   [ERROR] rustup-init failed. Install manually: https://rustup.rs/
    set "SETUP_FAILED=1"
    exit /b 1
)
del /q "%TEMP%\rustup-init.exe" >nul 2>nul
:rust_installed
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
    echo   Rust installed. Open a NEW terminal so PATH takes effect.
    set "NEED_RESTART=1"
) else (
    echo   Rust installed:
    cargo -V
)
exit /b 0
