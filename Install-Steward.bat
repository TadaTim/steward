@echo off
setlocal EnableExtensions
title Install Steward
cd /d "%~dp0"

echo.
echo ============================================================
echo   Welcome to the Steward installer
echo ============================================================
echo.
echo This will set Steward up on this computer. It takes a few
echo minutes, and you do not need to know anything technical.
echo Just read each message and follow along.
echo.
echo If you have run this installer before, that is fine - it
echo simply freshens everything up and keeps all of your
echo information exactly as it was.
echo.

rem ---------------------------------------------------------------
rem Step 1 of 5: Steward runs on a free program called Node.js,
rem version 22 or newer. Check whether it is already here.
rem ---------------------------------------------------------------
echo Step 1 of 5: Checking that this computer has what Steward needs...

call :checknode
if defined NODE_OK goto step2

echo.
echo Steward needs a free program called Node.js, version 22 or
echo newer, and this computer does not have it yet.
echo.
where winget >nul 2>nul
if errorlevel 1 goto no_winget

echo The good news: Windows can install it for you automatically.
echo A Windows prompt may appear asking for permission - please
echo click Yes on it. The installation can take a few minutes.
echo.
pause
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto node_install_failed

rem This window's list of program locations may be out of date
rem after an install, so read it fresh from Windows and look again.
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USR_PATH=%%b"
if defined SYS_PATH set "PATH=%SYS_PATH%;%PATH%"
if defined USR_PATH set "PATH=%USR_PATH%;%PATH%"

call :checknode
if defined NODE_OK goto step2

echo.
echo Node.js seems to have installed, but this window cannot see
echo it yet. That is easy to fix:
echo   1. Close this window.
echo   2. Double-click Install-Steward again.
echo It will pick up right where it left off.
echo.
pause
exit /b 0

rem ---------------------------------------------------------------
rem Step 2 of 5: install Steward's parts from the list in this folder.
rem ---------------------------------------------------------------
:step2
echo Node.js is ready.
echo.
echo Step 2 of 5: Installing Steward's parts. This can take a
echo few minutes - it is safe to leave it running.
call npm install
if errorlevel 1 goto npm_failed
echo Done.
echo.

rem ---------------------------------------------------------------
rem Step 3 of 5: the "data" folder holds everything Steward
rem remembers, and Start-Steward is the button that runs Steward.
rem ---------------------------------------------------------------
echo Step 3 of 5: Setting up Steward's home in this folder...
if not exist "data" mkdir "data"

> "Start-Steward.bat" echo @echo off
>>"Start-Steward.bat" echo title Steward
>>"Start-Steward.bat" echo cd /d "%%~dp0"
>>"Start-Steward.bat" echo where node ^>nul 2^>nul
>>"Start-Steward.bat" echo if errorlevel 1 goto nonode
>>"Start-Steward.bat" echo if not exist "data" mkdir "data"
>>"Start-Steward.bat" echo set "STEWARD_DB=%%~dp0data\steward.db"
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo echo Steward is starting. Your web browser will open at the
>>"Start-Steward.bat" echo echo Steward page in a few seconds.
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo echo Please keep this window open while you use Steward.
>>"Start-Steward.bat" echo echo To stop Steward, close this window.
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo start "" /min cmd /c "timeout /t 6 /nobreak ^>nul ^& start http://localhost:4173"
>>"Start-Steward.bat" echo call npm run console
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo echo Steward has stopped. You can close this window now.
>>"Start-Steward.bat" echo pause
>>"Start-Steward.bat" echo exit /b 0
>>"Start-Steward.bat" echo :nonode
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo echo Steward needs a free program called Node.js, and it
>>"Start-Steward.bat" echo echo seems to be missing. Please double-click
>>"Start-Steward.bat" echo echo Install-Steward in this folder - it will sort this
>>"Start-Steward.bat" echo echo out for you.
>>"Start-Steward.bat" echo echo.
>>"Start-Steward.bat" echo pause
>>"Start-Steward.bat" echo exit /b 1
echo Done.
echo.

rem ---------------------------------------------------------------
rem Step 4 of 5: a shortcut on the desktop, so Steward is one
rem double-click away from now on.
rem ---------------------------------------------------------------
echo Step 4 of 5: Putting a Steward shortcut on your desktop...
set "STEWARD_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Steward.lnk'); $sc.TargetPath=$env:STEWARD_DIR+'Start-Steward.bat'; $sc.WorkingDirectory=$env:STEWARD_DIR; $sc.Description='Start Steward'; $sc.Save()"
if errorlevel 1 echo We could not add the desktop shortcut, but that is not a problem: you can always start Steward by double-clicking Start-Steward in this folder.
if not errorlevel 1 echo Done - look for "Steward" on your desktop.
echo.

rem ---------------------------------------------------------------
rem Step 5 of 5: one choice - should Steward start by itself
rem each time this computer is logged on to?
rem ---------------------------------------------------------------
echo Step 5 of 5: One last choice.
echo.
set "AUTO="
set /p "AUTO=Should Steward start by itself each time you log on to Windows? Press Enter for Yes, or type N for No: "
if /i "%AUTO%"=="N" goto skip_auto
if /i "%AUTO%"=="NO" goto skip_auto
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut([Environment]::GetFolderPath('Startup')+'\Steward.lnk'); $sc.TargetPath=$env:STEWARD_DIR+'Start-Steward.bat'; $sc.WorkingDirectory=$env:STEWARD_DIR; $sc.Description='Start Steward at logon'; $sc.Save()"
if errorlevel 1 echo We could not set that up automatically, but that is not a problem: Steward will still start from its desktop shortcut whenever you like.
if not errorlevel 1 echo Done. Steward will now start by itself when you log on. You can change your mind any time - Uninstall-Steward removes the shortcuts and never touches your information.
goto auto_done
:skip_auto
echo No problem. Steward will only run when you open it from the
echo desktop shortcut.
:auto_done
echo.

rem ---------------------------------------------------------------
rem All finished. Offer to start Steward right away.
rem ---------------------------------------------------------------
echo ============================================================
echo   Steward is installed.
echo ============================================================
echo.
echo From now on, start Steward with the Steward shortcut on your
echo desktop. Everything Steward remembers lives in the "data"
echo folder next to this installer, it stays on this computer,
echo and it belongs to you.
echo.
set "NOW="
set /p "NOW=Would you like to start Steward now? Press Enter for Yes, or type N for No: "
if /i "%NOW%"=="N" goto finish_no
if /i "%NOW%"=="NO" goto finish_no
start "" "%~dp0Start-Steward.bat"
echo Steward is starting - look for it in your web browser.
goto finish_end
:finish_no
echo Whenever you are ready, double-click the Steward shortcut on
echo your desktop.
:finish_end
echo.
pause
exit /b 0

rem ---------------------------------------------------------------
rem Friendly endings for the ways step 1 or 2 can stop.
rem ---------------------------------------------------------------
:no_winget
echo.
echo This computer does not have the Windows installer helper, so
echo Node.js needs to be installed by hand. It only takes a few
echo clicks:
echo   1. Go to https://nodejs.org in your web browser.
echo   2. Download the version marked LTS and run the download,
echo      accepting the usual choices.
echo   3. When it finishes, double-click Install-Steward again.
echo Nothing you have done so far will be lost.
echo.
pause
exit /b 0

:node_install_failed
echo.
echo Something went wrong while Windows was installing Node.js.
echo Nothing has been changed on your computer. You can close
echo this window, check your internet connection, and try again.
echo If it keeps failing, install Node.js LTS from
echo https://nodejs.org and then run this installer again.
echo.
pause
exit /b 1

:npm_failed
echo.
echo Something went wrong while installing Steward's parts.
echo Your information has not been touched. The usual cause is a
echo lost internet connection - check it and double-click
echo Install-Steward again. It will pick up where it left off.
echo.
pause
exit /b 1

rem ---------------------------------------------------------------
rem Subroutine: sets NODE_OK if Node.js version 22 or newer exists.
rem ---------------------------------------------------------------
:checknode
set "NODE_OK="
set "NODE_MAJOR="
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR exit /b 0
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if not defined NODE_MAJOR exit /b 0
if %NODE_MAJOR% GEQ 22 set "NODE_OK=1"
exit /b 0
