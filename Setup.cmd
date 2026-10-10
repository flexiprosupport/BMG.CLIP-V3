@echo off
setlocal
cd /d "%~dp0"
echo BMG.CLIP-V3 Windows setup
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
set "SETUP_RESULT=%ERRORLEVEL%"
echo.
if not "%SETUP_RESULT%"=="0" echo Setup did not finish. Read the message above before trying again.
pause
exit /b %SETUP_RESULT%
