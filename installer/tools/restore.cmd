@echo off
rem Restores the Billing Software database from a backup file. Run as administrator.
setlocal
if "%~1"=="" (
  echo Usage: restore.cmd "C:\ProgramData\BillingSoftware\backups\billing-YYYYMMDD-HHMMSS.tar.gz"
  exit /b 1
)
if not exist "%~1" (
  echo Backup file not found: %~1
  exit /b 1
)

set "APP=%~dp0.."

echo Stopping the Billing Software service...
"%APP%\service\billing-service.exe" stop

echo Restoring...
pushd "%APP%\server"
"%APP%\node\node.exe" dist\scripts\restore.js "%~1"
set "RESULT=%ERRORLEVEL%"
popd

echo Starting the Billing Software service...
"%APP%\service\billing-service.exe" start

if not "%RESULT%"=="0" (
  echo Restore FAILED. Your previous database was not deleted.
  exit /b %RESULT%
)
echo Done.
endlocal
