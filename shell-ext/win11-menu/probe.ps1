# Win11 一级右键菜单原型探针（只在 CI runner 上运行）。
# 验证：未签名稀疏包 + IExplorerCommand 进程外 COM 能否在“非开发者模式、无证书”条件下注册、显示、调用与完全卸载。
# 每个结论打印为 `W11MENU key=value`，便于从日志 grep。
param(
    [string]$Work = (Join-Path $env:RUNNER_TEMP 'win11menu'),
    [switch]$SkipUi
)
$ErrorActionPreference = 'Continue'
$Clsid = '6F3B7A51-2C1E-4E8B-9A57-3D8E1B4C9F21'
$PkgName = 'TagLauncher.ShellMenu'
$Title = '用 TagLauncher 收纳'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
function Log($k, $v) { Write-Host "W11MENU $k=$v" }

New-Item -ItemType Directory -Force -Path $Work | Out-Null
$ext = Join-Path $Work 'app'
$pkgDir = Join-Path $Work 'pkg'
New-Item -ItemType Directory -Force -Path $ext, $pkgDir | Out-Null

# ---- 环境 ----
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
Log 'os' "$($cv.ProductName) $($cv.DisplayVersion) build=$($cv.CurrentBuild).$($cv.UBR)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Log 'admin' $isAdmin
$unlock = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$dev = (Get-ItemProperty $unlock -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
Log 'devmode_initial' $dev
# 显式关闭开发者模式，确保结论不依赖它（runner 是一次性机器）
New-Item -Force -Path $unlock -ErrorAction SilentlyContinue | Out-Null
Set-ItemProperty -Path $unlock -Name AllowDevelopmentWithoutDevLicense -Value 0 -Type DWord
Log 'devmode_forced' (Get-ItemProperty $unlock).AllowDevelopmentWithoutDevLicense
Log 'allowunsigned_param' ((Get-Command Add-AppxPackage).Parameters.ContainsKey('AllowUnsigned'))

# ---- 构建 COM DLL ----
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
Push-Location $Work
cmd /c "`"$vcvars`" >nul && cl /nologo /LD /EHsc /O2 /std:c++17 /utf-8 /DUNICODE /D_UNICODE `"$Here\tl_menu.cpp`" /Fe:tl_menu.dll /link /DEF:`"$Here\tl_menu.def`" shlwapi.lib shell32.lib ole32.lib" | Out-Host
Pop-Location
Log 'dll_built' (Test-Path (Join-Path $Work 'tl_menu.dll'))
Copy-Item (Join-Path $Work 'tl_menu.dll') $ext -Force
Copy-Item "$env:windir\System32\whoami.exe" (Join-Path $ext 'tag-launcher.exe') -Force

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 44, 44
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::SteelBlue); $g.Dispose()
$bmp.Save((Join-Path $ext 'tl_menu_logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
Copy-Item (Join-Path $ext 'tl_menu_logo.png') $pkgDir -Force
Copy-Item (Join-Path $Here 'AppxManifest.xml') $pkgDir -Force

# ---- 打包（未签名）----
$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
$msix = Join-Path $Work "$PkgName.msix"
& $sdkBin.FullName pack /o /nv /d $pkgDir /p $msix | Out-Host
Log 'msix_built' (Test-Path $msix)

function Get-Pkg { Get-AppxPackage -Name $PkgName -ErrorAction SilentlyContinue }
function Remove-Pkg { $p = Get-Pkg; if ($p) { Remove-AppxPackage -Package $p.PackageFullName -ErrorAction SilentlyContinue } }

# ---- 注册：A) msix + -AllowUnsigned（开发者模式关） ----
$registered = $null
Remove-Pkg
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
    Add-AppxPackage -Path $msix -ExternalLocation $ext -AllowUnsigned -ErrorAction Stop
    Log 'register_A_msix_allowunsigned_devoff' "ok ms=$($sw.ElapsedMilliseconds)"
    $registered = 'A'
} catch { Log 'register_A_msix_allowunsigned_devoff' "fail $($_.Exception.Message -replace '\s+',' ')" }

# ---- B) 不带 -AllowUnsigned（对照：证明未签名包确实需要该开关） ----
if ($registered) {
    Remove-Pkg
    try {
        Add-AppxPackage -Path $msix -ExternalLocation $ext -ErrorAction Stop
        Log 'register_B_msix_no_flag_devoff' 'ok'
    } catch { Log 'register_B_msix_no_flag_devoff' "fail $($_.Exception.Message -replace '\s+',' ')" }
    Remove-Pkg
    Add-AppxPackage -Path $msix -ExternalLocation $ext -AllowUnsigned -ErrorAction SilentlyContinue
}

# ---- C) 若 A 失败：-Register 清单（开发者模式关），再开开发者模式试 ----
if (-not $registered) {
    try {
        Add-AppxPackage -Register (Join-Path $pkgDir 'AppxManifest.xml') -ExternalLocation $ext -ErrorAction Stop
        Log 'register_C_manifest_devoff' 'ok'; $registered = 'C'
    } catch { Log 'register_C_manifest_devoff' "fail $($_.Exception.Message -replace '\s+',' ')" }
}
if (-not $registered) {
    Set-ItemProperty -Path $unlock -Name AllowDevelopmentWithoutDevLicense -Value 1 -Type DWord
    try {
        Add-AppxPackage -Path $msix -ExternalLocation $ext -AllowUnsigned -ErrorAction Stop
        Log 'register_D_msix_allowunsigned_devon' 'ok'; $registered = 'D'
    } catch { Log 'register_D_msix_allowunsigned_devon' "fail $($_.Exception.Message -replace '\s+',' ')" }
    Set-ItemProperty -Path $unlock -Name AllowDevelopmentWithoutDevLicense -Value 0 -Type DWord
}
Log 'registered_via' $registered
$pkg = Get-Pkg
if ($pkg) {
    Log 'package' "$($pkg.PackageFullName) signature=$($pkg.SignatureKind) installLocation=$($pkg.InstallLocation)"
}
Log 'packagedcom_class' (Test-Path "Registry::HKEY_CLASSES_ROOT\PackagedCom\ClassIndex\{$Clsid}")

# ---- COM 激活与调用 ----
$target = Join-Path $Work 'probe-target.txt'
Set-Content -Path $target -Value 'probe'
$marker = Join-Path $env:LOCALAPPDATA 'TagLauncher\win11-menu-invoked.txt'
Remove-Item $marker -ErrorAction SilentlyContinue
if ($pkg) {
    try {
        Add-Type -Path (Join-Path $Here 'ComProbe.cs')
        Log 'com_invoke' ([ComProbe]::Run($Clsid, $target))
    } catch { Log 'com_invoke' "fail $($_.Exception.Message -replace '\s+',' ')" }
    Start-Sleep -Milliseconds 500
    Log 'com_marker_has_target' ((Test-Path $marker) -and ((Get-Content $marker -Raw) -like "*probe-target.txt*"))
}

# ---- 资源管理器 Win11 一级菜单（UIA）----
if ($pkg -and -not $SkipUi) {
    & (Join-Path $Here 'ui_probe.ps1') -Folder $Work -FileName 'probe-target.txt' -Title $Title -Shot (Join-Path $Work 'menu-registered.png') -Marker $marker -Click
}

# ---- 卸载与清理 ----
if ($pkg) {
    Get-Process dllhost -ErrorAction SilentlyContinue | ForEach-Object {
        try { if ($_.Modules.ModuleName -contains 'tl_menu.dll') { Log 'dllhost_holding' $_.Id } } catch {}
    }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Remove-AppxPackage -Package $pkg.PackageFullName
    Log 'unregister_ms' $sw.ElapsedMilliseconds
    Log 'after_remove_package' ([bool](Get-Pkg))
    Log 'after_remove_packagedcom_class' (Test-Path "Registry::HKEY_CLASSES_ROOT\PackagedCom\ClassIndex\{$Clsid}")
    Start-Sleep -Seconds 2
    $deleted = $false
    for ($i = 0; $i -lt 10 -and -not $deleted; $i++) {
        try { Remove-Item (Join-Path $ext 'tl_menu.dll') -ErrorAction Stop; $deleted = $true } catch { Start-Sleep -Milliseconds 500 }
    }
    Log 'dll_deletable_after_remove' $deleted
    if (-not $SkipUi) {
        & (Join-Path $Here 'ui_probe.ps1') -Folder $Work -FileName 'probe-target.txt' -Title $Title -Shot (Join-Path $Work 'menu-removed.png') -Marker $marker -Tag 'after_remove'
    }
    Log 'hkcu_clsid_leftover' (Test-Path "Registry::HKEY_CURRENT_USER\Software\Classes\CLSID\{$Clsid}")
}
Set-ItemProperty -Path $unlock -Name AllowDevelopmentWithoutDevLicense -Value $(if ($dev) { $dev } else { 0 }) -Type DWord
