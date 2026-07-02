@echo off
REM Reapunta el entorno de pruebas (app TPV + Laragon) a la IP LAN actual del PC.
REM Doble-clic para autodetectar la IP de la Wi-Fi, o pasa una IP:
REM    actualizar-ip.bat 192.168.0.70
setlocal
set "SCRIPT=%~dp0update-lan-ip.ps1"

if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Ip %1
)

echo.
pause
