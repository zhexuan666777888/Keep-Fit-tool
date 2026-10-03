# 在桌面创建 Fit Tool 快捷方式（最小化启动 + 自定义图标）
# 使用 $PSScriptRoot 自动定位项目目录，放在任何电脑、任何路径下都可用
# 用法：右键"使用 PowerShell 运行"，或在 PowerShell 中执行  .\tools\make-shortcut.ps1
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$root = Split-Path -Parent $PSScriptRoot

$lnkPath = Join-Path $desktop 'Fit Tool.lnk'
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = (Join-Path $root 'run-fit-tool.cmd')
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7   # 最小化启动
$lnk.IconLocation = (Join-Path $root 'fit-tool.ico') + ',0'
$lnk.Description = 'Fit Tool - Keep 校园跑数据生成器'
$lnk.Save()

$chk = $ws.CreateShortcut($lnkPath)
Write-Output "Created: $lnkPath"
Write-Output "Target: $($chk.TargetPath)"
Write-Output "Icon: $($chk.IconLocation)"
