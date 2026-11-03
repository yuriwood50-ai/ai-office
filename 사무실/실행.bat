@echo off
chcp 65001 >nul
cd /d "%~dp0"
set OFFICE_MODE=real
set OFFICE_ALLOW_REAL=1
set OFFICE_NOTICE_ONLY=1
node notice/setup.cjs
if errorlevel 1 exit /b 1
node server.js --open
echo.
echo Server stopped. Press any key to close.
pause >nul
