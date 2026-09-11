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
:: If no registered VS instance ships the target toolset, a known standalone
:: BuildTools path (VC\Auxiliary\Build\vcvarsall.bat) is probed and loaded
:: automatically, because cc-rs/vswhere only see registered instances.

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
if /i "%OTHER_TRIPLE%"=="aarch64-pc-windows-msvc" (
    call :ensure_msvc arm64 x64_arm64
) else (
    call :ensure_msvc x64 arm64_x64
)
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

:: 确保交叉目标的 MSVC 工具链就绪：%1=目标架构目录名(arm64|x64)，%2=vcvarsall 参数。
:: vswhere 只枚举已注册实例；未注册的 BuildTools（手动部署/残留）不在其列，
:: 此时探测其标准路径并 call vcvarsall 注入 PATH/INCLUDE/LIB。
:ensure_msvc
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 0
"%VSWHERE%" -latest -find **\Hostx64\%1\cl.exe 2>nul | findstr /i "cl.exe" >nul
if not errorlevel 1 exit /b 0
set "VCVARSALL=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
if exist "%VCVARSALL%" (
    echo No registered MSVC %1 toolset found; loading unregistered BuildTools instance...
    call "%VCVARSALL%" %2 >nul
)
exit /b 0
