' Stop BMG.CLIP-V3.vbs — closing the browser tab does not quit the app (the
' server keeps running so your edit isn't lost if you close the tab by
' accident). Use this shortcut to actually shut it down.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command " & _
  """$Root = '" & Replace(dir, "'", "''") & "'; " & _
  "$pidFile = Join-Path $Root '.pid'; " & _
  "$portFile = Join-Path $Root '.port'; $py = Join-Path $Root '.venv\Scripts\python.exe'; if (-not (Test-Path $py)) { $py = Join-Path $Root 'python\python.exe' }; " & _
  "if (Test-Path $pidFile) { try { $id = [int]((Get-Content $pidFile -Raw).Trim()); $proc = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($proc -and $proc.Path -ieq $py) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } catch {} }; " & _
  "Remove-Item $pidFile, $portFile -Force -ErrorAction SilentlyContinue"""

shell.Run cmd, 0, True
MsgBox "BMG.CLIP-V3 has been stopped.", 64, "BMG.CLIP-V3"
