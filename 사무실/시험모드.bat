@echo off
chcp 65001 >nul
cd /d "%~dp0"
set OFFICE_MODE=mock
set OFFICE_ALLOW_REAL=
set OFFICE_NOTICE_ONLY=1
node server.js --open
pause >nul
