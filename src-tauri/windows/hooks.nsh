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
