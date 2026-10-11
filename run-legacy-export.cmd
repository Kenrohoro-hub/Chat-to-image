@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 goto path_error
where pyw >nul 2>nul
if errorlevel 1 goto use_python
start "" pyw -3 -B "%~dp0scripts\legacy_export.pyw"
goto finished
:use_python
where pythonw >nul 2>nul
if errorlevel 1 goto missing_python
start "" pythonw -B "%~dp0scripts\legacy_export.pyw"
goto finished
:missing_python
echo Python 3.10 or newer is required.
popd
pause
exit /b 1
:finished
popd
exit /b 0
:path_error
echo Cannot access the project folder.
pause
exit /b 1
