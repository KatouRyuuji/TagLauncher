# 在资源管理器里右键文件，用 UIA 读取 Win11 一级菜单（XAML 弹层）里的条目；可选点击我们的条目。
# 资源管理器窗口按 Folder.Self.Path 绑定本例目录，不靠标题包含叶子名。clicked 只在实际尝试点击后为 True。
param([string]$Folder, [string]$FileName, [string]$Title, [string]$Shot, [string]$Marker = '', [switch]$Click, [string]$Tag = 'registered')
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Log($k, $v) { Write-Host "W11MENU ui_$($Tag)_$k=$v" }
function NormalizePath([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return '' }
    try { return [IO.Path]::GetFullPath($p).TrimEnd('\','/').ToLowerInvariant() } catch { return $p.TrimEnd('\','/').ToLowerInvariant() }
}
function FolderPathOf([int]$hwnd) {
    $shell = New-Object -ComObject Shell.Application
    foreach ($w in @($shell.Windows())) {
        try {
            if ([int]$w.HWND -eq $hwnd) { return [string]$w.Document.Folder.Self.Path }
        } catch {}
    }
    return $null
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static void Right(int x, int y) { SetCursorPos(x, y); mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero); }
}
'@
$A = [System.Windows.Automation.AutomationElement]
$T = [System.Windows.Automation.TreeScope]
$C = [System.Windows.Automation.Condition]::TrueCondition
$want = NormalizePath $Folder
# 关掉 runner 开机遗留的系统对话框（windows-11-arm 上有「临时分页文件」提示，会挡住右键菜单）
foreach ($d in $A::RootElement.FindAll($T::Children, (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')))) {
    $ok = $d.FindFirst($T::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'OK')))
    try {
        $d.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); Log 'dismissed_dialog' ($d.Current.Name + ' ok=' + [bool]$ok)
    } catch { Log 'dismissed_dialog' "fail $($_.Exception.Message -replace '\s+',' ')" }
}

Get-Process explorer -ErrorAction SilentlyContinue | Out-Null
Start-Process explorer.exe -ArgumentList "`"$Folder`""
$win = $null
for ($i = 0; $i -lt 40 -and -not $win; $i++) {
    Start-Sleep -Milliseconds 500
    $cond = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'CabinetWClass')
    foreach ($w in $A::RootElement.FindAll($T::Children, $cond)) {
        $p = FolderPathOf ([int]$w.Current.NativeWindowHandle)
        if ((NormalizePath $p) -eq $want) { $win = $w; break }
    }
}
Log 'explorer_window' ([bool]$win)
Log 'explorer_folder_bound' ([bool]$win)
if (-not $win) { Log 'clicked' $false; Log 'click_error' 'explorer_folder_unbound'; return }
Log 'explorer_pid' $win.Current.ProcessId
[Mouse]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
$item = $null
for ($i = 0; $i -lt 30 -and -not $item; $i++) {
    Start-Sleep -Milliseconds 500
    foreach ($n in @($FileName, [IO.Path]::GetFileNameWithoutExtension($FileName))) {
        if ($item) { break }
        $nc = New-Object System.Windows.Automation.AndCondition(
            (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $n)),
            (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
        $item = $win.FindFirst($T::Descendants, $nc)
    }
}
Log 'file_item' ([bool]$item)
if (-not $item) { Log 'clicked' $false; Log 'click_error' 'file_item_missing'; return }
$r = $item.Current.BoundingRectangle
[Mouse]::Right([int]($r.X + [Math]::Min(40, $r.Width / 2)), [int]($r.Y + $r.Height / 2))
Start-Sleep -Milliseconds 1500
$names = New-Object System.Collections.Generic.List[string]
$ours = New-Object System.Collections.Generic.List[object]
$tops = New-Object System.Collections.Generic.List[string]
foreach ($top in $A::RootElement.FindAll($T::Children, $C)) {
    $cls = $top.Current.ClassName
    $tops.Add($cls)
    if ($cls -eq 'Shell_TrayWnd' -or $cls -eq 'ConsoleWindowClass' -or $cls -eq 'CASCADIA_HOSTING_WINDOW_CLASS') { continue }
    foreach ($mi in $top.FindAll($T::Descendants, $C)) {
        $n = $mi.Current.Name
        if (-not $n) { continue }
        $ct = $mi.Current.ControlType
        if ($cls -eq 'CabinetWClass' -and $ct -ne [System.Windows.Automation.ControlType]::MenuItem -and $ct -ne [System.Windows.Automation.ControlType]::Button) { continue }
        $names.Add("$cls|$($mi.Current.ControlType.ProgrammaticName -replace 'ControlType.', '')|$n")
        if ($n -eq $Title) { $ours.Add($mi) }
    }
}
Log 'top_classes' (($tops | Select-Object -Unique) -join ',')
Log 'menu_items' (($names | Select-Object -First 40) -join ' ; ')
Log 'menu_modern' ([bool]($names | Where-Object { $_ -like '*Show more options*' -or $_ -like '*显示更多选项*' }))
Log 'our_item_visible' ($ours.Count -ge 1)
Log 'our_item_count' $ours.Count
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $g.Dispose()
$bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
if ($Click) {
    if ($ours.Count -ne 1) {
        Log 'clicked' $false
        Log 'click_path' ''
        Log 'click_error' "not_unique:$($ours.Count)"
    } else {
        $target = $ours[0]
        if ($Marker) { Remove-Item $Marker -ErrorAction SilentlyContinue }
        $path = 'uia_invoke'
        try {
            $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        } catch {
            Log 'uia_invoke_error' ($_.Exception.Message -replace '\s+',' ')
            $path = 'physical_mouse'
            $b = $target.Current.BoundingRectangle
            [Mouse]::SetCursorPos([int]($b.X + $b.Width / 2), [int]($b.Y + $b.Height / 2)) | Out-Null
            [Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        }
        Log 'click_path' $path
        Log 'clicked' $true
        if ($Marker) {
            $ok = $false
            for ($i = 0; $i -lt 20 -and -not $ok; $i++) { Start-Sleep -Milliseconds 250; $ok = (Test-Path $Marker) -and ((Get-Content $Marker -Raw) -like "*$FileName*") }
            Log 'click_invoked_marker' $ok
        }
    }
} else {
    Log 'clicked' $false
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
}
Start-Sleep -Milliseconds 300
try { $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close() } catch {}
