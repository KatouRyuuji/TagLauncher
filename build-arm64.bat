@echo off
setlocal enableextensions
chcp 65001 >nul
cd /d "%~dp0"

:: Build a native Windows on ARM (ARM64) release.
:: Requires the aarch64-pc-windows-msvc Rust target and the ARM64 MSVC C++
:: build tools component. setup.bat installs the x64 toolchain; on an ARM64
:: host the VS Build Tools ARM64 component is added automatically by this
:: script's rustup target step only for Rust - if the linker complains about
:: a missing ARM64 toolset, install "MSVC v143 - ARM64 build tools" via the
:: Visual Studio Installer.

echo ============================================================
echo  TagLauncher - Windows ARM64 (aarch64) Release Build
echo ============================================================
call "%~dp0build.bat" aarch64-pc-windows-msvc
