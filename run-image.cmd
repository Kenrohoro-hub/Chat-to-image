@echo off
setlocal
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 --version >nul 2>nul
if errorlevel 1 goto use_python
py -3 "%~dp0scripts\playground_image.py" %*
goto done
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing_python
python "%~dp0scripts\playground_image.py" %*
goto done
:missing_python
echo Python 3 was not found on PATH. 1>&2
pause
exit /b 1
:done
set "result=%errorlevel%"
if not "%~1"=="" exit /b %result%
pause
exit /b %result%
