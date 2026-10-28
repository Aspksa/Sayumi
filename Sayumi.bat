@echo off
rem ============================================================================
rem  Sayumi Launcher
rem  Universal Windows starter: drive pick, folder pick, portable / flash mode,
rem  Python autodetect and auto install, local server, browser open.
rem
rem  File encoding: UTF-8 without BOM. Code is ASCII only, text may be Cyrillic.
rem  Console codepage is switched to 65001 on the very first line.
rem ============================================================================
chcp 65001 >nul 2>&1
if errorlevel 1 set "SAYUMI_NOUTF=1"
setlocal EnableExtensions EnableDelayedExpansion

set "SAYUMI_VERSION=1.0.0"

rem ---------------------------------------------------------------- paths ----
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "CFG=%ROOT%\Sayumi.config.cmd"
set "WEB=%ROOT%\web"
set "SRV=%ROOT%\server"
set "TOOLS=%ROOT%\tools"
set "RUNTIME=%ROOT%\runtime"
set "PYPORT=%RUNTIME%\python"
set "LOGDIR=%ROOT%\logs"
set "TMPDIR=%ROOT%\.tmp"
set "DLDIR=%TMPDIR%\download"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass"

rem ------------------------------------------------------------- defaults ----
set "OPT_LANG=RU"
set "OPT_DATA=%ROOT%\data"
set "OPT_DRIVE="
set "OPT_PORT=8723"
set "OPT_PYTHON="
set "OPT_BROWSER=default"
set "OPT_PORTABLE=auto"
set "OPT_FIRSTRUN=1"
set "PF86=%ProgramFiles(x86)%"

call :load_config
if defined SAYUMI_NOUTF set "OPT_LANG=EN"
call :apply_lang
call :ensure_dirs
call :arch_detect
call :detect_media
call :have_ps

set "ARG=%~1"
if /i "%ARG%"=="/run"   goto :auto_go
if /i "%ARG%"=="-run"   goto :auto_go
if /i "%ARG%"=="/setup" goto :menu_python
if /i "%ARG%"=="/help"  goto :cli_help
if /i "%ARG%"=="-h"     goto :cli_help
if /i "%ARG%"=="/?"     goto :cli_help
if /i "%ARG%"=="/menu"  goto :menu
if /i "%ARG%"=="-menu"  goto :menu
goto :auto


rem ============================================================================
rem  AUTOMATIC START - what a double click does
rem  Finds Python, installs it if missing, starts the server, opens the site.
rem  Nothing is asked. Press M during the short countdown to get the menu.
rem ============================================================================
:auto
cls
color 06
title Sayumi
call :header
echo.
echo   !T_AUTO_TITLE!
echo.
call :line
echo.
echo   !T_AUTO_HINT!
echo.
where choice >nul 2>&1
if errorlevel 1 goto :auto_go
choice /c MZ /n /t 3 /d Z >nul 2>&1
if errorlevel 2 goto :auto_go
if errorlevel 1 goto :menu

:auto_go
set "AUTO=1"
goto :run_start


rem ============================================================================
rem  MAIN MENU
rem ============================================================================
:menu
cls
color 06
title Sayumi Launcher %SAYUMI_VERSION%
call :header
call :find_python
echo.
echo   !T_PATH_ROOT! %ROOT%
echo   !T_PATH_DATA! %OPT_DATA%
if defined MEDIA_LABEL echo   !T_MEDIA! !MEDIA_LABEL!
if defined PY (echo   !T_PY! !PY_VER!  -  !PY!) else (echo   !T_PY! !T_P_NOTFOUND!)
echo   !T_PORT! %OPT_PORT%
echo.
call :line
echo.
echo     1  !T_M_RUN!
echo     2  !T_M_DRIVE!
echo     3  !T_M_FOLDER!
echo     4  !T_M_PYTHON!
echo     5  !T_M_OPTIONS!
echo     6  !T_M_DEPLOY!
echo     7  !T_M_DIAG!
echo     8  !T_M_LANG!
echo     0  !T_M_EXIT!
echo.
call :line
echo.
set "CH="
set /p "CH=  !T_SELECT! "
if "%CH%"=="1" goto :run_start
if "%CH%"=="2" goto :menu_drive
if "%CH%"=="3" goto :menu_folder
if "%CH%"=="4" goto :menu_python
if "%CH%"=="5" goto :menu_options
if "%CH%"=="6" goto :menu_deploy
if "%CH%"=="7" goto :menu_diag
if "%CH%"=="8" goto :menu_lang
if "%CH%"=="0" goto :bye
goto :menu


rem ============================================================================
rem  START
rem ============================================================================
:run_start
cls
call :header
echo.
echo   !T_RUN_PREP!
echo.
if not exist "%WEB%\index.html" goto :run_noweb
call :ensure_dirs
if not exist "%OPT_DATA%" md "%OPT_DATA%" >nul 2>&1

call :find_python
if defined PY goto :run_server
if defined AUTO goto :auto_python

call :warn "!T_WARN_NOPY!"
echo.
echo     1  !T_PY_PORTABLE!
echo     2  !T_PY_SYSTEM!
echo     3  !T_PY_OFFLINE!
echo     0  !T_BACK!
echo.
set "CH2="
set /p "CH2=  !T_SELECT! "
if "%CH2%"=="1" goto :run_fix_portable
if "%CH2%"=="2" goto :run_fix_system
if "%CH2%"=="3" goto :run_offline
goto :menu

:auto_python
echo.
call :warn "!T_AUTO_NOPY!"
call :install_python_portable
call :find_python
if defined PY goto :run_server
echo.
call :warn "!T_AUTO_PYFAIL!"
goto :run_offline

:run_fix_portable
call :install_python_portable
call :find_python
if defined PY goto :run_server
goto :run_offline

:run_fix_system
call :install_python_system
call :find_python
if defined PY goto :run_server
goto :run_offline

:run_noweb
call :err "!T_ERR_NOWEB!"
echo        %WEB%\index.html
goto :after_run

:run_server
call :check_running
if defined ALREADY goto :run_attach
call :port_pick
set "OPT_FIRSTRUN=0"
call :save_config
call :ok "!T_RUN_SERVER! http://127.0.0.1:!OPT_PORT!"
echo.
pushd "%ROOT%"
start "Sayumi Server" /min "!PY!" "%SRV%\server.py" --port !OPT_PORT! --root "%ROOT%" --data "%OPT_DATA%"
popd
call :wait_port !OPT_PORT!
if errorlevel 1 (
  call :warn "!T_RUN_SLOW!"
)
call :open_url "http://127.0.0.1:!OPT_PORT!/"
call :ok "!T_RUN_DONE!"
echo.
echo   !T_RUN_STOP!
goto :after_run

:run_attach
call :ok "!T_RUN_ALREADY! http://127.0.0.1:!OPT_PORT!/"
call :open_url "http://127.0.0.1:!OPT_PORT!/"
goto :after_run

:run_offline
call :warn "!T_RUN_FILE!"
set "OPT_FIRSTRUN=0"
call :save_config
call :open_url "%WEB%\index.html"
goto :after_run

:after_run
echo.
call :line
echo.
if not defined AUTO goto :after_run_menu
echo   !T_AUTO_CLOSE!
echo.
where choice >nul 2>&1
if errorlevel 1 goto :bye
choice /c MZ /n /t 6 /d Z >nul 2>&1
if errorlevel 2 goto :bye
set "AUTO="
goto :menu

:after_run_menu
echo   !T_ANY_KEY!
pause >nul
goto :menu


rem ============================================================================
rem  DRIVE SELECTION
rem ============================================================================
:menu_drive
cls
call :header
echo.
echo   !T_D_TITLE!
echo.
call :line
echo.
set "DCOUNT=0"
if "%HAVE_PS%"=="1" if exist "%TOOLS%\drives.ps1" goto :drive_ps
goto :drive_fs

:drive_ps
for /f "usebackq tokens=1,2,3,4 delims=;" %%A in (`%PS% -File "%TOOLS%\drives.ps1"`) do (
  set /a DCOUNT+=1
  set "D!DCOUNT!=%%A"
  set "DKIND=!T_DT_OTHER!"
  if "%%B"=="2" set "DKIND=!T_DT_REMOVABLE!"
  if "%%B"=="3" set "DKIND=!T_DT_FIXED!"
  if "%%B"=="4" set "DKIND=!T_DT_NET!"
  if "%%B"=="5" set "DKIND=!T_DT_CD!"
  set "DNAME=%%C"
  if "!DNAME!"=="" set "DNAME=!T_NOLABEL!"
  echo      !DCOUNT!  %%A  [!DKIND!]  !DNAME!  -  %%D GB !T_FREE!
)
goto :drive_done

:drive_fs
for /f "skip=1 tokens=*" %%A in ('fsutil fsinfo drives 2^>nul') do (
  for %%B in (%%A) do (
    set "RAW=%%B"
    set "RAW=!RAW:\=!"
    if not "!RAW!"=="" (
      set /a DCOUNT+=1
      set "D!DCOUNT!=!RAW!"
      echo      !DCOUNT!  !RAW!
    )
  )
)
goto :drive_done

:drive_done
if "%DCOUNT%"=="0" (
  call :err "!T_D_NONE!"
  pause >nul
  goto :menu
)
echo.
echo      0  !T_BACK!
echo.
call :line
echo.
set "DC="
set /p "DC=  !T_D_PICK! "
if "%DC%"=="0" goto :menu
if "%DC%"=="" goto :menu_drive
set "PICK="
for /l %%i in (1,1,%DCOUNT%) do if "%DC%"=="%%i" set "PICK=!D%%i!"
if not defined PICK goto :menu_drive
if not exist "%PICK%\" (
  call :err "!T_D_UNAVAIL!"
  pause >nul
  goto :menu_drive
)
set "OPT_DRIVE=%PICK%"
set "NEWDIR=%PICK%\Sayumi\data"
goto :folder_apply


rem ============================================================================
rem  DATA FOLDER SELECTION
rem ============================================================================
:menu_folder
cls
call :header
echo.
echo   !T_F_TITLE!
echo   !T_F_NOW! %OPT_DATA%
echo.
call :line
echo.
echo     1  !T_F_DIALOG!
echo     2  !T_F_MANUAL!
echo     3  !T_F_NEXTTO!
echo     4  !T_F_DOCS!
echo     0  !T_BACK!
echo.
set "FC="
set /p "FC=  !T_SELECT! "
if "%FC%"=="0" goto :menu
if "%FC%"=="1" goto :folder_dialog
if "%FC%"=="2" goto :folder_manual
if "%FC%"=="3" goto :folder_nextto
if "%FC%"=="4" goto :folder_docs
goto :menu_folder

:folder_nextto
set "NEWDIR=%ROOT%\data"
goto :folder_apply

:folder_docs
set "NEWDIR=%USERPROFILE%\Documents\Sayumi"
goto :folder_apply

:folder_manual
echo.
set "NEWDIR="
set /p "NEWDIR=  !T_F_TYPE! "
if "%NEWDIR%"=="" goto :menu_folder
goto :folder_apply

:folder_dialog
if not "%HAVE_PS%"=="1" goto :folder_manual
if not exist "%TOOLS%\pickfolder.ps1" goto :folder_manual
echo.
echo   !T_F_WAIT!
set "NEWDIR="
for /f "usebackq delims=" %%P in (`%PS% -STA -File "%TOOLS%\pickfolder.ps1" -Start "%OPT_DATA%"`) do set "NEWDIR=%%P"
if "%NEWDIR%"=="" (
  call :warn "!T_F_CANCEL!"
  pause >nul
  goto :menu_folder
)
goto :folder_apply

:folder_apply
set "NEWDIR=%NEWDIR:"=%"
if "%NEWDIR:~-1%"=="\" set "NEWDIR=%NEWDIR:~0,-1%"
if not exist "%NEWDIR%" md "%NEWDIR%" >nul 2>&1
if not exist "%NEWDIR%" (
  call :err "!T_F_FAIL!"
  echo        %NEWDIR%
  pause >nul
  goto :menu_folder
)
>"%NEWDIR%\.sayumi_write_test" echo ok
if not exist "%NEWDIR%\.sayumi_write_test" (
  call :err "!T_F_RO!"
  pause >nul
  goto :menu_folder
)
del /q "%NEWDIR%\.sayumi_write_test" >nul 2>&1
set "OPT_DATA=%NEWDIR%"
call :save_config
echo.
call :ok "!T_F_SET! %OPT_DATA%"
echo.
pause >nul
goto :menu


rem ============================================================================
rem  PYTHON
rem ============================================================================
:menu_python
cls
call :header
echo.
echo   !T_P_TITLE!
echo.
call :line
echo.
call :find_python
if defined PY (
  call :ok "!T_P_FOUND! !PY_VER!"
  echo        !PY!
) else (
  call :warn "!T_P_NOTFOUND_FULL!"
)
echo.
echo     1  !T_P_RESCAN!
echo     2  !T_PY_PORTABLE!
echo     3  !T_PY_SYSTEM!
echo     4  !T_P_MANUAL!
echo     5  !T_P_CLEAR!
echo     0  !T_BACK!
echo.
set "PC="
set /p "PC=  !T_SELECT! "
if "%PC%"=="0" goto :menu
if "%PC%"=="1" goto :py_rescan
if "%PC%"=="2" goto :py_portable
if "%PC%"=="3" goto :py_system
if "%PC%"=="4" goto :py_manual
if "%PC%"=="5" goto :py_rescan
goto :menu_python

:py_rescan
set "OPT_PYTHON="
call :save_config
goto :menu_python

:py_portable
call :install_python_portable
echo.
pause >nul
goto :menu_python

:py_system
call :install_python_system
echo.
pause >nul
goto :menu_python

:py_manual
echo.
set "MP="
set /p "MP=  !T_P_TYPE! "
set "MP=%MP:"=%"
if not exist "%MP%" goto :py_manual_bad
call :test_python "%MP%"
if not defined TP_OK goto :py_manual_bad
set "OPT_PYTHON=%MP%"
call :save_config
call :ok "!T_P_SAVED!"
pause >nul
goto :menu_python

:py_manual_bad
call :err "!T_P_BAD!"
pause >nul
goto :menu_python


rem ----------------------------------------------------------- find python ---
:find_python
set "PY="
set "PY_VER="

if not defined OPT_PYTHON goto :fp_portable
if not exist "%OPT_PYTHON%" goto :fp_portable
call :test_python "%OPT_PYTHON%"
if defined TP_OK ( set "PY=%OPT_PYTHON%" & set "PY_VER=!TP_VER!" & goto :eof )

:fp_portable
if not exist "%PYPORT%\python.exe" goto :fp_drive
call :test_python "%PYPORT%\python.exe"
if defined TP_OK ( set "PY=%PYPORT%\python.exe" & set "PY_VER=!TP_VER!" & goto :eof )

:fp_drive
if not defined OPT_DRIVE goto :fp_launcher
if not exist "%OPT_DRIVE%\Sayumi\runtime\python\python.exe" goto :fp_launcher
call :test_python "%OPT_DRIVE%\Sayumi\runtime\python\python.exe"
if defined TP_OK ( set "PY=%OPT_DRIVE%\Sayumi\runtime\python\python.exe" & set "PY_VER=!TP_VER!" & goto :eof )

:fp_launcher
for /f "usebackq delims=" %%P in (`py -3 -c "import sys;print(sys.executable)" 2^>nul`) do (
  if exist "%%P" (
    call :test_python "%%P"
    if defined TP_OK ( set "PY=%%P" & set "PY_VER=!TP_VER!" & goto :eof )
  )
)

:fp_path
for %%N in (python.exe python3.exe) do (
  for /f "usebackq delims=" %%P in (`where %%N 2^>nul`) do (
    echo %%P | find /i "WindowsApps" >nul
    if errorlevel 1 (
      call :test_python "%%P"
      if defined TP_OK ( set "PY=%%P" & set "PY_VER=!TP_VER!" & goto :eof )
    )
  )
)

:fp_registry
for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Software\Python\PythonCore" /s /v ExecutablePath 2^>nul ^| find /i "REG_SZ"`) do (
  if exist "%%B" (
    call :test_python "%%B"
    if defined TP_OK ( set "PY=%%B" & set "PY_VER=!TP_VER!" & goto :eof )
  )
)
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\Software\Python\PythonCore" /s /v ExecutablePath 2^>nul ^| find /i "REG_SZ"`) do (
  if exist "%%B" (
    call :test_python "%%B"
    if defined TP_OK ( set "PY=%%B" & set "PY_VER=!TP_VER!" & goto :eof )
  )
)

:fp_scan
for %%D in ("%LOCALAPPDATA%\Programs\Python" "%ProgramFiles%" "%PF86%" "C:\" "D:\") do (
  if exist "%%~D" (
    for /d %%F in ("%%~D\Python3*") do (
      if exist "%%~F\python.exe" (
        call :test_python "%%~F\python.exe"
        if defined TP_OK ( set "PY=%%~F\python.exe" & set "PY_VER=!TP_VER!" & goto :eof )
      )
    )
  )
)
goto :eof

rem ----------------------------------------------------------- test python ---
:test_python
set "TP_OK="
set "TP_VER="
set "TP_RAW="
if "%~1"=="" goto :eof
for /f "usebackq delims=" %%V in (`"%~1" -c "import sys;sys.stdout.write('PYOK '+str(sys.version_info[0])+'.'+str(sys.version_info[1]))" 2^>nul`) do set "TP_RAW=%%V"
if not defined TP_RAW goto :eof
echo !TP_RAW! | find "PYOK" >nul
if errorlevel 1 goto :eof
set "TP_VER=!TP_RAW:PYOK =!"
if "!TP_VER:~0,1!"=="2" goto :eof
set "TP_OK=1"
goto :eof


rem ------------------------------------------------- portable python setup ---
:install_python_portable
echo.
call :line
echo.
echo   !T_PI_TITLE!
echo.
set "PYV=3.12.7"
set "PYZIP=python-%PYV%-embed-%PYARCH%.zip"
set "PYURL=https://www.python.org/ftp/python/%PYV%/%PYZIP%"
if not exist "%DLDIR%" md "%DLDIR%" >nul 2>&1

echo   !T_PI_DOWN! %PYURL%
call :download "%PYURL%" "%DLDIR%\%PYZIP%"
if not exist "%DLDIR%\%PYZIP%" (
  call :err "!T_PI_DLFAIL!"
  echo        %PYURL%
  echo        !T_PI_MANUAL! %PYPORT%
  goto :eof
)

echo   !T_PI_UNZIP!
if exist "%PYPORT%" rd /s /q "%PYPORT%" >nul 2>&1
md "%PYPORT%" >nul 2>&1
call :unzip "%DLDIR%\%PYZIP%" "%PYPORT%"
if not exist "%PYPORT%\python.exe" (
  call :err "!T_PI_UNZIPFAIL!"
  goto :eof
)

if exist "%TOOLS%\fixpth.ps1" if "%HAVE_PS%"=="1" %PS% -File "%TOOLS%\fixpth.ps1" -Dir "%PYPORT%" >nul 2>&1

echo   !T_PI_PIP!
call :download "https://bootstrap.pypa.io/get-pip.py" "%DLDIR%\get-pip.py"
if exist "%DLDIR%\get-pip.py" "%PYPORT%\python.exe" "%DLDIR%\get-pip.py" --no-warn-script-location >nul 2>&1

call :test_python "%PYPORT%\python.exe"
if not defined TP_OK (
  call :err "!T_PI_BAD!"
  goto :eof
)
set "OPT_PYTHON=%PYPORT%\python.exe"
call :save_config
call :ok "!T_PI_DONE! !TP_VER!"
goto :eof


rem --------------------------------------------------- system python setup ---
:install_python_system
echo.
call :line
echo.
echo   !T_PS_TITLE!
echo.
set "PYV=3.12.7"
if "%PYARCH%"=="win32" (set "PYEXE=python-%PYV%.exe") else (set "PYEXE=python-%PYV%-%PYARCH%.exe")
set "PYURL=https://www.python.org/ftp/python/%PYV%/%PYEXE%"
if not exist "%DLDIR%" md "%DLDIR%" >nul 2>&1

echo   !T_PI_DOWN! %PYURL%
call :download "%PYURL%" "%DLDIR%\%PYEXE%"
if not exist "%DLDIR%\%PYEXE%" (
  call :err "!T_PI_DLFAIL!"
  echo        %PYURL%
  goto :eof
)
echo   !T_PS_RUN!
"%DLDIR%\%PYEXE%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0
set "OPT_PYTHON="
call :save_config
call :find_python
if defined PY (
  call :ok "!T_PI_DONE! !PY_VER!"
) else (
  call :warn "!T_PS_RESTART!"
)
goto :eof


rem --------------------------------------------------------------- net io ----
:download
set "DL_URL=%~1"
set "DL_OUT=%~2"
if exist "%DL_OUT%" del /q "%DL_OUT%" >nul 2>&1
where curl.exe >nul 2>&1
if errorlevel 1 goto :dl_ps
curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 20 -o "%DL_OUT%" "%DL_URL%"
if exist "%DL_OUT%" goto :eof
:dl_ps
if not "%HAVE_PS%"=="1" goto :dl_bits
if exist "%TOOLS%\fetch.ps1" (
  %PS% -File "%TOOLS%\fetch.ps1" -Url "%DL_URL%" -Out "%DL_OUT%" >nul 2>&1
  if exist "%DL_OUT%" goto :eof
)
:dl_bits
bitsadmin /transfer SayumiDL /download /priority normal "%DL_URL%" "%DL_OUT%" >nul 2>&1
goto :eof

:unzip
where tar.exe >nul 2>&1
if errorlevel 1 goto :uz_ps
tar.exe -xf "%~1" -C "%~2" >nul 2>&1
if exist "%~2\python.exe" goto :eof
:uz_ps
if not "%HAVE_PS%"=="1" goto :eof
%PS% -Command "Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force" >nul 2>&1
goto :eof


rem ============================================================================
rem  LAUNCH OPTIONS
rem ============================================================================
:menu_options
cls
call :header
echo.
echo   !T_O_TITLE!
echo.
call :line
echo.
echo     1  !T_O_PORT! %OPT_PORT%
echo     2  !T_O_BROWSER! %OPT_BROWSER%
echo     3  !T_O_PORTMODE! %OPT_PORTABLE%
echo     4  !T_O_OPENDATA!
echo     5  !T_O_OPENLOG!
echo     6  !T_O_RESET!
echo     0  !T_BACK!
echo.
set "OC="
set /p "OC=  !T_SELECT! "
if "%OC%"=="0" goto :menu
if "%OC%"=="1" goto :opt_port
if "%OC%"=="2" goto :opt_browser
if "%OC%"=="3" goto :opt_portable
if "%OC%"=="4" goto :opt_opendata
if "%OC%"=="5" goto :opt_openlog
if "%OC%"=="6" goto :opt_reset
goto :menu_options

:opt_port
echo.
set "NP="
set /p "NP=  !T_O_PORT_ASK! "
if not "%NP%"=="" set "OPT_PORT=%NP%"
call :save_config
goto :menu_options

:opt_browser
echo.
echo     1  default     2  chrome     3  msedge     4  firefox
echo.
set "BC="
set /p "BC=  !T_SELECT! "
if "%BC%"=="1" set "OPT_BROWSER=default"
if "%BC%"=="2" set "OPT_BROWSER=chrome"
if "%BC%"=="3" set "OPT_BROWSER=msedge"
if "%BC%"=="4" set "OPT_BROWSER=firefox"
call :save_config
goto :menu_options

:opt_portable
if /i "%OPT_PORTABLE%"=="on" (set "OPT_PORTABLE=off") else (set "OPT_PORTABLE=on")
if /i "%OPT_PORTABLE%"=="on" set "OPT_DATA=%ROOT%\data"
call :save_config
goto :menu_options

:opt_opendata
if not exist "%OPT_DATA%" md "%OPT_DATA%" >nul 2>&1
start "" "%OPT_DATA%"
goto :menu_options

:opt_openlog
if exist "%LOGDIR%" start "" "%LOGDIR%"
goto :menu_options

:opt_reset
echo.
set "RC="
set /p "RC=  !T_O_RESET_ASK! "
if /i not "%RC%"=="Y" goto :menu_options
if exist "%CFG%" del /q "%CFG%" >nul 2>&1
call :ok "!T_O_RESET_OK!"
pause >nul
goto :bye


rem ============================================================================
rem  DEPLOY COPY
rem ============================================================================
:menu_deploy
cls
call :header
echo.
echo   !T_DEP_TITLE!
echo.
call :line
echo.
echo   !T_DEP_HINT!
echo.
set "TGT="
set /p "TGT=  !T_DEP_ASK! "
if "%TGT%"=="" goto :menu
set "TGT=%TGT:"=%"
if "%TGT:~-1%"=="\" set "TGT=%TGT:~0,-1%"
if not exist "%TGT%" md "%TGT%" >nul 2>&1
if not exist "%TGT%" (
  call :err "!T_F_FAIL!"
  pause >nul
  goto :menu
)
echo.
echo   !T_DEP_COPY!
where robocopy >nul 2>&1
if errorlevel 1 goto :dep_xcopy
robocopy "%ROOT%" "%TGT%" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 /XD ".git" ".tmp" "logs" "runtime" >nul
goto :dep_check
:dep_xcopy
xcopy "%ROOT%\web" "%TGT%\web\" /E /I /Y >nul 2>&1
xcopy "%ROOT%\server" "%TGT%\server\" /E /I /Y >nul 2>&1
xcopy "%ROOT%\tools" "%TGT%\tools\" /E /I /Y >nul 2>&1
copy /y "%ROOT%\Sayumi.bat" "%TGT%\" >nul 2>&1
:dep_check
if not exist "%TGT%\Sayumi.bat" (
  call :err "!T_DEP_FAIL!"
  pause >nul
  goto :menu
)
>"%TGT%\portable.flag" echo sayumi portable
call :ok "!T_DEP_OK! %TGT%"
echo.
pause >nul
goto :menu


rem ============================================================================
rem  DIAGNOSTICS
rem ============================================================================
:menu_diag
cls
call :header
echo.
echo   !T_DG_TITLE!
echo.
call :line
echo.
echo   Arch        : %PROCESSOR_ARCHITECTURE%  ^>  %PYARCH%
echo   User        : %USERNAME%
echo   Root        : %ROOT%
echo   Data        : %OPT_DATA%
echo   Portable    : %OPT_PORTABLE%
if exist "%CFG%" (echo   Config      : OK) else (echo   Config      : -)
if exist "%WEB%\index.html" (echo   web         : OK) else (echo   web         : MISSING)
if exist "%SRV%\server.py" (echo   server      : OK) else (echo   server      : MISSING)
if exist "%TOOLS%\drives.ps1" (echo   tools       : OK) else (echo   tools       : MISSING)
call :find_python
if defined PY (echo   Python      : !PY_VER!  !PY!) else (echo   Python      : -)
if "%HAVE_PS%"=="1" (echo   PowerShell  : OK) else (echo   PowerShell  : -)
where curl.exe >nul 2>&1 && (echo   curl        : OK) || (echo   curl        : -)
where tar.exe  >nul 2>&1 && (echo   tar         : OK) || (echo   tar         : -)
if defined MEDIA_LABEL echo   Media       : !MEDIA_LABEL!
echo   Port        : %OPT_PORT%
netstat -ano 2>nul | find ":%OPT_PORT% " >nul && (echo   Port state  : BUSY) || (echo   Port state  : FREE)
echo.
call :line
echo.
echo   !T_ANY_KEY!
pause >nul
goto :menu


rem ============================================================================
rem  LANGUAGE
rem ============================================================================
:menu_lang
if /i "%OPT_LANG%"=="RU" (set "OPT_LANG=EN") else (set "OPT_LANG=RU")
call :apply_lang
call :save_config
goto :menu


rem ============================================================================
rem  SUPPORT ROUTINES
rem ============================================================================
:header
echo.
echo   ================================================================
echo       S A Y U M I       launcher v%SAYUMI_VERSION%
echo   ================================================================
goto :eof

:line
echo   ----------------------------------------------------------------
goto :eof

:ok
echo   [ OK ]   %~1
goto :eof

:warn
echo   [ ... ]  %~1
goto :eof

:err
echo   [ ERR ]  %~1
goto :eof

:ensure_dirs
if not exist "%LOGDIR%" md "%LOGDIR%" >nul 2>&1
if not exist "%TMPDIR%" md "%TMPDIR%" >nul 2>&1
if not exist "%OPT_DATA%" md "%OPT_DATA%" >nul 2>&1
goto :eof

:have_ps
set "HAVE_PS=0"
powershell -NoProfile -Command "exit 0" >nul 2>&1
if not errorlevel 1 set "HAVE_PS=1"
goto :eof

:arch_detect
set "PYARCH=amd64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "PYARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "PYARCH=win32"
goto :eof

:detect_media
set "MEDIA_LABEL="
set "MEDIA_TYPE="
set "DRV=%ROOT:~0,2%"
if exist "%ROOT%\portable.flag" set "OPT_PORTABLE=on"
if not "%HAVE_PS%"=="1" goto :dm_done
if not exist "%TOOLS%\drivetype.ps1" goto :dm_done
for /f "usebackq delims=" %%T in (`%PS% -File "%TOOLS%\drivetype.ps1" -Drive "%DRV%"`) do set "MEDIA_TYPE=%%T"
if "%MEDIA_TYPE%"=="2" set "MEDIA_LABEL=!T_DT_REMOVABLE! %DRV%"
if "%MEDIA_TYPE%"=="3" set "MEDIA_LABEL=!T_DT_FIXED! %DRV%"
if "%MEDIA_TYPE%"=="4" set "MEDIA_LABEL=!T_DT_NET! %DRV%"
if "%MEDIA_TYPE%"=="5" set "MEDIA_LABEL=!T_DT_CD! %DRV%"
if "%MEDIA_TYPE%"=="2" if /i "%OPT_PORTABLE%"=="auto" set "OPT_PORTABLE=on"
:dm_done
if /i "%OPT_PORTABLE%"=="auto" set "OPT_PORTABLE=off"
if /i "%OPT_PORTABLE%"=="on" set "OPT_DATA=%ROOT%\data"
goto :eof

:check_running
set "ALREADY="
netstat -ano 2>nul | find ":%OPT_PORT% " >nul
if errorlevel 1 goto :eof
where curl.exe >nul 2>&1
if errorlevel 1 goto :eof
curl.exe -s --max-time 3 "http://127.0.0.1:%OPT_PORT%/api/health" 2>nul | find "Sayumi" >nul
if errorlevel 1 goto :eof
set "ALREADY=1"
goto :eof

:port_pick
set /a _tries=0
:pp_loop
set /a _tries+=1
netstat -ano 2>nul | find ":%OPT_PORT% " >nul
if errorlevel 1 goto :eof
set /a _np=%OPT_PORT%+1
set "OPT_PORT=%_np%"
if %_tries% lss 30 goto :pp_loop
goto :eof

:wait_port
if not "%HAVE_PS%"=="1" goto :wp_ping
if not exist "%TOOLS%\waitport.ps1" goto :wp_ping
%PS% -File "%TOOLS%\waitport.ps1" -Port %~1 -Tries 25
goto :eof
:wp_ping
>nul ping -n 4 127.0.0.1
exit /b 0

:open_url
if /i "%OPT_BROWSER%"=="default" goto :ou_default
start "" "%OPT_BROWSER%" "%~1"
if not errorlevel 1 goto :eof
:ou_default
start "" "%~1"
goto :eof

:load_config
if exist "%CFG%" call "%CFG%" >nul 2>&1
goto :eof

:save_config
> "%CFG%" echo @rem Sayumi launcher config. ASCII values only.
>>"%CFG%" echo set "OPT_LANG=%OPT_LANG%"
>>"%CFG%" echo set "OPT_DATA=%OPT_DATA%"
>>"%CFG%" echo set "OPT_DRIVE=%OPT_DRIVE%"
>>"%CFG%" echo set "OPT_PORT=%OPT_PORT%"
>>"%CFG%" echo set "OPT_PYTHON=%OPT_PYTHON%"
>>"%CFG%" echo set "OPT_BROWSER=%OPT_BROWSER%"
>>"%CFG%" echo set "OPT_PORTABLE=%OPT_PORTABLE%"
>>"%CFG%" echo set "OPT_FIRSTRUN=%OPT_FIRSTRUN%"
goto :eof

:cli_help
echo.
echo   Sayumi.bat          start everything and open the site
echo   Sayumi.bat /menu    interactive menu
echo   Sayumi.bat /run     same as no argument
echo   Sayumi.bat /setup   python setup screen
echo   Sayumi.bat /help    this help
echo.
goto :bye

:bye
echo.
echo   !T_BYE!
echo.
endlocal
exit /b 0


rem ============================================================================
rem  LOCALISATION
rem ============================================================================
:apply_lang
if /i "%OPT_LANG%"=="EN" goto :lang_en
goto :lang_ru

:lang_ru
set "T_SELECT=Выбор:"
set "T_BACK=Назад"
set "T_ANY_KEY=Нажмите любую клавишу для возврата в меню..."
set "T_BYE=До встречи."
set "T_FREE=свободно"
set "T_NOLABEL=без метки"
set "T_PATH_ROOT=Папка программы :"
set "T_PATH_DATA=Папка данных    :"
set "T_MEDIA=Носитель        :"
set "T_PY=Python          :"
set "T_PORT=Порт            :"
set "T_M_RUN=Запустить Sayumi"
set "T_M_DRIVE=Выбрать диск"
set "T_M_FOLDER=Выбрать папку данных"
set "T_M_PYTHON=Python: проверка и установка"
set "T_M_OPTIONS=Настройки запуска"
set "T_M_DEPLOY=Развернуть копию на диск или флешку"
set "T_M_DIAG=Диагностика"
set "T_M_LANG=Язык / Language"
set "T_M_EXIT=Выход"
set "T_AUTO_TITLE=Запускаю Sayumi"
set "T_AUTO_HINT=Всё делается само. Нажмите M, чтобы открыть меню."
set "T_AUTO_NOPY=Python не найден, ставлю переносимую версию в папку проекта."
set "T_AUTO_PYFAIL=Установить Python не вышло, открываю интерфейс без сервера."
set "T_AUTO_CLOSE=Окно закроется само. Нажмите M, чтобы открыть меню."
set "T_RUN_ALREADY=Sayumi уже запущена, открываю:"
set "T_RUN_PREP=Подготовка к запуску..."
set "T_RUN_SERVER=Сервер:"
set "T_RUN_DONE=Готово. Браузер открыт."
set "T_RUN_STOP=Чтобы остановить сервер, закройте окно Sayumi Server."
set "T_RUN_SLOW=Сервер отвечает медленно, открываю браузер."
set "T_RUN_FILE=Запуск без сервера, прямо из файла. Часть функций будет ограничена."
set "T_ERR_NOWEB=Не найден веб-интерфейс:"
set "T_WARN_NOPY=Python не найден. Выберите вариант:"
set "T_PY_PORTABLE=Скачать переносимый Python в папку проекта"
set "T_PY_SYSTEM=Скачать и установить Python в систему"
set "T_PY_OFFLINE=Открыть интерфейс без сервера"
set "T_D_TITLE=Доступные диски"
set "T_D_PICK=Номер диска:"
set "T_D_NONE=Диски не обнаружены."
set "T_D_UNAVAIL=Диск недоступен."
set "T_DT_REMOVABLE=съёмный"
set "T_DT_FIXED=локальный"
set "T_DT_NET=сетевой"
set "T_DT_CD=оптический"
set "T_DT_OTHER=другой"
set "T_F_TITLE=Папка для данных Sayumi"
set "T_F_NOW=Сейчас:"
set "T_F_DIALOG=Выбрать через проводник"
set "T_F_MANUAL=Ввести путь вручную"
set "T_F_NEXTTO=Рядом с программой"
set "T_F_DOCS=В папке Документы"
set "T_F_TYPE=Полный путь:"
set "T_F_WAIT=Открывается окно выбора папки..."
set "T_F_CANCEL=Выбор отменён."
set "T_F_FAIL=Не удалось создать папку."
set "T_F_RO=Папка только для чтения, запись невозможна."
set "T_F_SET=Папка данных установлена:"
set "T_P_TITLE=Python"
set "T_P_FOUND=Python найден, версия"
set "T_P_NOTFOUND=не найден"
set "T_P_NOTFOUND_FULL=Python не найден в системе."
set "T_P_RESCAN=Искать заново"
set "T_P_MANUAL=Указать путь к python.exe"
set "T_P_CLEAR=Сбросить сохранённый путь"
set "T_P_TYPE=Путь к python.exe:"
set "T_P_SAVED=Путь сохранён."
set "T_P_BAD=Это не рабочий python.exe версии 3."
set "T_PI_TITLE=Установка переносимого Python"
set "T_PI_DOWN=Загрузка:"
set "T_PI_UNZIP=Распаковка..."
set "T_PI_PIP=Установка pip..."
set "T_PI_DONE=Python готов, версия"
set "T_PI_BAD=Python распакован, но не запускается."
set "T_PI_DLFAIL=Не удалось скачать. Проверьте интернет или скачайте вручную:"
set "T_PI_MANUAL=и распакуйте в папку:"
set "T_PI_UNZIPFAIL=Не удалось распаковать архив."
set "T_PS_TITLE=Установка Python в систему"
set "T_PS_RUN=Запуск установщика, подождите..."
set "T_PS_RESTART=Установка завершена. Перезапустите Sayumi.bat."
set "T_O_TITLE=Настройки запуска"
set "T_O_PORT=Порт сервера       :"
set "T_O_BROWSER=Браузер            :"
set "T_O_PORTMODE=Переносимый режим  :"
set "T_O_OPENDATA=Открыть папку данных"
set "T_O_OPENLOG=Открыть папку логов"
set "T_O_RESET=Сбросить все настройки"
set "T_O_PORT_ASK=Новый порт:"
set "T_O_RESET_ASK=Подтвердите сброс, введите Y:"
set "T_O_RESET_OK=Настройки сброшены."
set "T_DEP_TITLE=Развернуть копию Sayumi"
set "T_DEP_HINT=Укажите папку назначения, например  E:\Sayumi"
set "T_DEP_ASK=Путь назначения:"
set "T_DEP_COPY=Копирование файлов..."
set "T_DEP_OK=Копия готова:"
set "T_DEP_FAIL=Копирование не удалось."
set "T_DG_TITLE=Диагностика"
goto :eof

:lang_en
set "T_SELECT=Select:"
set "T_BACK=Back"
set "T_ANY_KEY=Press any key to return to the menu..."
set "T_BYE=See you."
set "T_FREE=free"
set "T_NOLABEL=no label"
set "T_PATH_ROOT=Program folder :"
set "T_PATH_DATA=Data folder    :"
set "T_MEDIA=Media          :"
set "T_PY=Python         :"
set "T_PORT=Port           :"
set "T_M_RUN=Start Sayumi"
set "T_M_DRIVE=Select drive"
set "T_M_FOLDER=Select data folder"
set "T_M_PYTHON=Python: check and install"
set "T_M_OPTIONS=Launch options"
set "T_M_DEPLOY=Deploy a copy to drive or flash stick"
set "T_M_DIAG=Diagnostics"
set "T_M_LANG=Language / Язык"
set "T_M_EXIT=Exit"
set "T_AUTO_TITLE=Starting Sayumi"
set "T_AUTO_HINT=Everything runs by itself. Press M to open the menu."
set "T_AUTO_NOPY=Python not found, installing a portable copy into the project folder."
set "T_AUTO_PYFAIL=Could not install Python, opening the interface without a server."
set "T_AUTO_CLOSE=This window closes by itself. Press M to open the menu."
set "T_RUN_ALREADY=Sayumi is already running, opening:"
set "T_RUN_PREP=Preparing to start..."
set "T_RUN_SERVER=Server:"
set "T_RUN_DONE=Done. Browser opened."
set "T_RUN_STOP=To stop the server close the Sayumi Server window."
set "T_RUN_SLOW=Server is slow to answer, opening the browser anyway."
set "T_RUN_FILE=Starting without a server, directly from file. Some features are limited."
set "T_ERR_NOWEB=Web interface not found:"
set "T_WARN_NOPY=Python not found. Choose an option:"
set "T_PY_PORTABLE=Download portable Python into the project folder"
set "T_PY_SYSTEM=Download and install Python system wide"
set "T_PY_OFFLINE=Open the interface without a server"
set "T_D_TITLE=Available drives"
set "T_D_PICK=Drive number:"
set "T_D_NONE=No drives detected."
set "T_D_UNAVAIL=Drive is not available."
set "T_DT_REMOVABLE=removable"
set "T_DT_FIXED=local"
set "T_DT_NET=network"
set "T_DT_CD=optical"
set "T_DT_OTHER=other"
set "T_F_TITLE=Folder for Sayumi data"
set "T_F_NOW=Current:"
set "T_F_DIALOG=Pick with the explorer dialog"
set "T_F_MANUAL=Type the path manually"
set "T_F_NEXTTO=Next to the program"
set "T_F_DOCS=In the Documents folder"
set "T_F_TYPE=Full path:"
set "T_F_WAIT=Opening the folder dialog..."
set "T_F_CANCEL=Selection cancelled."
set "T_F_FAIL=Could not create the folder."
set "T_F_RO=Folder is read only, cannot write."
set "T_F_SET=Data folder set to:"
set "T_P_TITLE=Python"
set "T_P_FOUND=Python found, version"
set "T_P_NOTFOUND=not found"
set "T_P_NOTFOUND_FULL=Python was not found on this system."
set "T_P_RESCAN=Scan again"
set "T_P_MANUAL=Set the path to python.exe"
set "T_P_CLEAR=Clear the saved path"
set "T_P_TYPE=Path to python.exe:"
set "T_P_SAVED=Path saved."
set "T_P_BAD=This is not a working python.exe version 3."
set "T_PI_TITLE=Installing portable Python"
set "T_PI_DOWN=Downloading:"
set "T_PI_UNZIP=Extracting..."
set "T_PI_PIP=Installing pip..."
set "T_PI_DONE=Python ready, version"
set "T_PI_BAD=Python was extracted but does not run."
set "T_PI_DLFAIL=Download failed. Check the internet or download manually:"
set "T_PI_MANUAL=and extract it into:"
set "T_PI_UNZIPFAIL=Could not extract the archive."
set "T_PS_TITLE=System wide Python installation"
set "T_PS_RUN=Running the installer, please wait..."
set "T_PS_RESTART=Installation finished. Restart Sayumi.bat."
set "T_O_TITLE=Launch options"
set "T_O_PORT=Server port       :"
set "T_O_BROWSER=Browser           :"
set "T_O_PORTMODE=Portable mode     :"
set "T_O_OPENDATA=Open the data folder"
set "T_O_OPENLOG=Open the log folder"
set "T_O_RESET=Reset all settings"
set "T_O_PORT_ASK=New port:"
set "T_O_RESET_ASK=Confirm reset, type Y:"
set "T_O_RESET_OK=Settings were reset."
set "T_DEP_TITLE=Deploy a copy of Sayumi"
set "T_DEP_HINT=Enter the destination folder, for example  E:\Sayumi"
set "T_DEP_ASK=Destination path:"
set "T_DEP_COPY=Copying files..."
set "T_DEP_OK=Copy is ready:"
set "T_DEP_FAIL=Copy failed."
set "T_DG_TITLE=Diagnostics"
goto :eof
