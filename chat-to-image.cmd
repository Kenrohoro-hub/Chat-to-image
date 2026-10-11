@echo off
setlocal
if not exist "%~dp0runtime\python.exe" goto system_python
"%~dp0runtime\python.exe" -B "%~dp0scripts\chat_to_image.py" %*
exit /b %errorlevel%
:system_python
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 --version >nul 2>nul
if errorlevel 1 goto use_python
py -3 -B "%~dp0scripts\chat_to_image.py" %*
exit /b %errorlevel%
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python -B "%~dp0scripts\chat_to_image.py" %*
exit /b %errorlevel%
:missing_python
echo Python 3.10 or newer was not found on PATH. 1>&2
exit /b 1
