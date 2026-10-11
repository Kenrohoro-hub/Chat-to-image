@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 goto path_error

where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 --version >nul 2>nul
if errorlevel 1 goto use_python
py -3 -B "%~dp0scripts\sync_app.py" %*
goto finished

:use_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python -B "%~dp0scripts\sync_app.py" %*
goto finished

:missing_python
echo Python 3.10 or newer is required. Install it and try again.
popd
pause
exit /b 1

:finished
set "APP_EXIT=%ERRORLEVEL%"
popd
if not "%APP_EXIT%"=="0" pause
exit /b %APP_EXIT%

:path_error
echo Cannot access the project folder.
pause
exit /b 1
