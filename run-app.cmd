@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 goto path_error

where pyw >nul 2>nul
if errorlevel 1 goto use_python
start "" pyw -3 -B "%~dp0scripts\desktop_app.pyw"
goto finished

:use_python
where pythonw >nul 2>nul
if errorlevel 1 goto missing_python
start "" pythonw -B "%~dp0scripts\desktop_app.pyw"
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
