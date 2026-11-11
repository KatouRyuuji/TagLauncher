# 在资源管理器里右键文件，用 UIA 读取 Win11 一级菜单（XAML 弹层）里的条目；可选点击我们的条目并核对调用标记。
param([string]$Folder, [string]$FileName, [string]$Title, [string]$Shot, [string]$Marker, [switch]$Click, [string]$Tag = 'registered')
$ErrorActionPreference = 'Continue'
function Log($k, $v) { Write-Host "W11MENU ui_$($Tag)_$k=$v" }
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
$leaf = Split-Path -Leaf $Folder

Get-Process explorer -ErrorAction SilentlyContinue | Out-Null
Start-Process explorer.exe -ArgumentList "`"$Folder`""
$win = $null
for ($i = 0; $i -lt 40 -and -not $win; $i++) {
    Start-Sleep -Milliseconds 500
    $cond = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'CabinetWClass')
    foreach ($w in $A::RootElement.FindAll($T::Children, $cond)) { if ($w.Current.Name -like "*$leaf*") { $win = $w } }
}
Log 'explorer_window' ([bool]$win)
if (-not $win) { return }
[Mouse]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
$item = $null
for ($i = 0; $i -lt 20 -and -not $item; $i++) {
    Start-Sleep -Milliseconds 500
    $nc = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $FileName)
    $item = $win.FindFirst($T::Descendants, $nc)
}
Log 'file_item' ([bool]$item)
if (-not $item) { return }
$r = $item.Current.BoundingRectangle
[Mouse]::Right([int]($r.X + [Math]::Min(40, $r.Width / 2)), [int]($r.Y + $r.Height / 2))
Start-Sleep -Milliseconds 1500
$names = New-Object System.Collections.Generic.List[string]
$ours = $null
$menuCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)
foreach ($top in $A::RootElement.FindAll($T::Children, $C)) {
    $cls = $top.Current.ClassName
    if ($cls -notmatch 'Popup|Xaml|#32768|Flyout|Menu') { continue }
    foreach ($mi in $top.FindAll($T::Descendants, $menuCond)) {
        $n = $mi.Current.Name
        if ($n) { $names.Add("$cls|$n") }
        if ($n -eq $Title) { $ours = $mi }
    }
}
Log 'menu_items' (($names | Select-Object -First 40) -join ' ; ')
Log 'menu_modern' ([bool]($names | Where-Object { $_ -notlike '#32768|*' }))
Log 'our_item_visible' ([bool]$ours)
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $g.Dispose()
$bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
if ($ours -and $Click) {
    Remove-Item $Marker -ErrorAction SilentlyContinue
    try { $ours.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {
        $b = $ours.Current.BoundingRectangle
        [Mouse]::SetCursorPos([int]($b.X + $b.Width / 2), [int]($b.Y + $b.Height / 2)) | Out-Null
        [Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) { Start-Sleep -Milliseconds 250; $ok = (Test-Path $Marker) -and ((Get-Content $Marker -Raw) -like "*$FileName*") }
    Log 'click_invoked_marker' $ok
} else {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
}
Start-Sleep -Milliseconds 300
try { $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close() } catch {}
