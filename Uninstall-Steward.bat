@echo off
setlocal EnableExtensions
title Remove Steward shortcuts

echo.
echo ============================================================
echo   Remove Steward's shortcuts
echo ============================================================
echo.
echo This removes the Steward shortcut from your desktop and from
echo the Windows start-up folder, so Steward will no longer start
echo by itself when you log on.
echo.
echo It does NOT delete Steward itself, and it does NOT touch any
echo of your information. Everything Steward remembers stays safe
echo in the "data" folder next to this file.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=[Environment]::GetFolderPath('Startup'); Remove-Item (Join-Path $d 'Steward.lnk') -Force -ErrorAction SilentlyContinue; Remove-Item (Join-Path $s 'Steward.lnk') -Force -ErrorAction SilentlyContinue"

echo Done. The shortcuts are gone.
echo.
echo If you ever want them back, just run Install-Steward again.
echo To remove Steward completely, delete this folder - but first
echo remember that the "data" folder inside it holds everything
echo Steward knows, so you may want to keep a copy of it.
echo.
pause
exit /b 0
