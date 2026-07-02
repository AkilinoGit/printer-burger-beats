<#
.SYNOPSIS
  Reapunta el entorno de pruebas (app TPV + Laragon) a la IP LAN actual del PC.

.DESCRIPTION
  Cuando el PC cambia de IP (DHCP), este script:
    1. Detecta la IP LAN actual (Wi-Fi por defecto) o usa la que le pases con -Ip.
    2. Actualiza EXPO_PUBLIC_API_BASE_URL en tpv/.env.
    3. Actualiza el ServerAlias del vhost de acceso por IP de Laragon.
    4. Recarga Apache (Laragon lo corre como proceso, no como servicio).
    5. Verifica GET /api/v1/health por la IP nueva.

  Tras ejecutarlo hay que reiniciar Metro con cache limpia y recompilar el APK,
  porque EXPO_PUBLIC_* se incrusta en el bundle:  npx expo start -c

.EXAMPLE
  # Autodetecta la IP de la Wi-Fi
  powershell -ExecutionPolicy Bypass -File scripts\update-lan-ip.ps1

.EXAMPLE
  # Forzar una IP concreta
  powershell -ExecutionPolicy Bypass -File scripts\update-lan-ip.ps1 -Ip 192.168.0.65
#>
[CmdletBinding()]
param(
    [string]$Ip,
    [string]$InterfaceAlias = 'Wi-Fi'
)

$ErrorActionPreference = 'Stop'

# --- Rutas (ajustar solo si mueves el proyecto o cambias la version de Apache) ---
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$EnvFile    = Join-Path $RepoRoot 'tpv\.env'
$VhostFile  = 'C:\laragon\etc\apache2\sites-enabled\burger-beats-ip.conf'
$ApacheRoot = (Get-ChildItem 'C:\laragon\bin\apache' -Directory | Where-Object { $_.Name -like 'httpd-*' } | Select-Object -First 1).FullName
$Httpd      = Join-Path $ApacheRoot 'bin\httpd.exe'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }

# --- 1. Determinar la IP -----------------------------------------------------
if (-not $Ip) {
    Write-Step "Detectando IP LAN de la interfaz '$InterfaceAlias'..."
    $Ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $InterfaceAlias -ErrorAction SilentlyContinue |
           Where-Object { $_.IPAddress -notlike '169.254.*' } |
           Select-Object -First 1 -ExpandProperty IPAddress)
    if (-not $Ip) {
        # Fallback: cualquier IP privada que no sea virtual/localhost.
        $Ip = (Get-NetIPAddress -AddressFamily IPv4 |
               Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.' -and $_.IPAddress -notlike '172.22.*' } |
               Select-Object -First 1 -ExpandProperty IPAddress)
    }
    if (-not $Ip) { throw "No pude detectar una IP LAN. Pasa una manualmente con -Ip <x.x.x.x>." }
}
if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "IP invalida: '$Ip'" }
Write-Ok "IP objetivo: $Ip"

# --- 2. Actualizar tpv/.env --------------------------------------------------
# Se lee/escribe con UTF-8 SIN BOM via .NET para no romper acentos ni meter BOM
# (Get-Content/Set-Content de PS 5.1 doble-codifican los acentos y anaden BOM).
Write-Step "Actualizando $EnvFile ..."
if (-not (Test-Path $EnvFile)) { throw ".env no encontrado en $EnvFile" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$envContent = [System.IO.File]::ReadAllText($EnvFile, $utf8NoBom)
$newLine = "EXPO_PUBLIC_API_BASE_URL=http://$Ip"
if ($envContent -match '(?m)^EXPO_PUBLIC_API_BASE_URL=.*$') {
    $envContent = [regex]::Replace($envContent, '(?m)^EXPO_PUBLIC_API_BASE_URL=.*$', $newLine)
} else {
    $envContent = $envContent.TrimEnd() + "`n$newLine`n"
}
[System.IO.File]::WriteAllText($EnvFile, $envContent, $utf8NoBom)
Write-Ok $newLine

# --- 3. Actualizar el ServerAlias del vhost ----------------------------------
Write-Step "Actualizando ServerAlias en $VhostFile ..."
if (-not (Test-Path $VhostFile)) { throw "vhost no encontrado en $VhostFile" }
$vhost = Get-Content $VhostFile -Raw
if ($vhost -match '(?m)^\s*ServerAlias\s+.*$') {
    $vhost = [regex]::Replace($vhost, '(?m)^\s*ServerAlias\s+.*$', "    ServerAlias $Ip")
} else {
    $vhost = [regex]::Replace($vhost, '(?m)^(\s*ServerName\s+.*)$', "`$1`n    ServerAlias $Ip")
}
Set-Content -Path $VhostFile -Value $vhost -Encoding ascii
Write-Ok "ServerAlias $Ip"

# --- 4. Recargar Apache ------------------------------------------------------
# Nota: NO usar '2>&1' sobre httpd (PS 5.1 envuelve su stderr como error y aborta,
# aunque la sintaxis sea correcta). Se redirige stderr a un temporal y se mira ExitCode.
Write-Step "Validando config y recargando Apache..."
$errTmp = New-TemporaryFile
$check = Start-Process -FilePath $Httpd -ArgumentList '-t' -NoNewWindow -Wait -PassThru -RedirectStandardError $errTmp.FullName
$syntax = (Get-Content $errTmp.FullName -Raw).Trim()
Remove-Item $errTmp -Force -ErrorAction SilentlyContinue
if ($check.ExitCode -ne 0) { throw "Config de Apache invalida: $syntax" }
Write-Ok $syntax
Get-Process httpd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process -FilePath $Httpd -ArgumentList @('-d', ($ApacheRoot -replace '\\','/')) -WindowStyle Hidden
Start-Sleep -Seconds 2
Write-Ok "Apache recargado"

# --- 5. Verificar ------------------------------------------------------------
Write-Step "Verificando http://$Ip/api/v1/health ..."
try {
    $resp = (Invoke-WebRequest -Uri "http://$Ip/api/v1/health" -UseBasicParsing -TimeoutSec 5).Content
    Write-Ok $resp
    Write-Host ""
    Write-Host "Listo. Ahora en el movil (misma Wi-Fi) abre http://$Ip/api/v1/health para confirmar." -ForegroundColor Green
    Write-Host "Recuerda recompilar la app:  cd tpv; npx expo start -c" -ForegroundColor Green
} catch {
    Write-Warn "El health por IP no respondio: $($_.Exception.Message)"
    Write-Warn "Revisa que Laragon/Apache este arrancado y que la Wi-Fi este activa."
}
