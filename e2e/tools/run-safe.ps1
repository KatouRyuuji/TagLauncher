# 只跑不接管鼠标键盘的 E2E（CLI / UI / 视觉），排除 physical_input。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File e2e\tools\run-safe.ps1 [-RunDir .tmp-test/e2e/safe] [其余 pytest 参数/路径]
param([string]$RunDir = ".tmp-test/e2e/safe", [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
Remove-Item Env:TL_E2E_ALLOW_PHYSICAL -ErrorAction SilentlyContinue
Set-Location (Join-Path $PSScriptRoot "..\..")
$paths = @($Rest | Where-Object { $_ -like "e2e/*" -or $_ -like "e2e\*" })
$opts = @($Rest | Where-Object { -not ($_ -like "e2e/*" -or $_ -like "e2e\*") })
if ($paths.Count -eq 0) { $paths = @("e2e/tests/cli", "e2e/tests/ui", "e2e/tests/visual") }
python -m pytest -c e2e/pytest.ini @paths -m "not physical_input and not visible_window" --run-dir $RunDir @opts
exit $LASTEXITCODE
