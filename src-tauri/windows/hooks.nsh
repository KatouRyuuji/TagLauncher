; 卸载后清理钩子：应用数据目录位于 %LOCALAPPDATA%\TagLauncher，
; Tauri NSIS 模板默认只清 %APPDATA%/%LOCALAPPDATA%\<bundleId>，在此补齐真实数据目录。
; 与模板同一口径：仅在用户勾选「删除应用数据」且非升级覆盖安装时删除。
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$LOCALAPPDATA\TagLauncher"
  ${EndIf}
!macroend

; 资源管理器右键菜单与「发送到」（设置里手动开启，见 src-tauri/src/shell_integration.rs）：
; 卸载时无条件清理（不看「删除应用数据」勾选），升级覆盖安装（UpdateMode=1）时保留。
; 快捷方式按 ASCII 通配名删除，避免 .nsh 编码影响中文文件名。
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Classes\*\shell\TagLauncher.Collect"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\TagLauncher.Collect"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\TagLauncher.Collect"
    SetShellVarContext current
    Delete "$APPDATA\Microsoft\Windows\SendTo\*TagLauncher*.lnk"
  ${EndIf}
!macroend
