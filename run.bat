@echo off
setlocal

rem ---------------------------------------------------------------
rem  PDF INVOICE -> EXCEL
rem
rem  1. Put your PDF files in the "input" folder.
rem  2. Double-click this file.
rem  3. The Excel file appears in the "output" folder.
rem
rem  Needs Node.js (https://nodejs.org). Nothing else.
rem ---------------------------------------------------------------

cd /d "%~dp0"

echo.
echo ================================================================
echo   PDF INVOICE TO EXCEL
echo ================================================================
echo.

rem --- Is Node.js installed? -------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed on this computer.
    echo.
    echo  This tool needs Node.js to run.
    echo.
    echo  Fix: install Node.js ^(LTS version^) from https://nodejs.org
    echo       then close this window and double-click run.bat again.
    echo.
    goto :halt
)

for /f "delims=" %%v in ('node --version 2^>nul') do set NODE_VERSION=%%v
echo  Node.js %NODE_VERSION% detected.

rem --- Is the program itself present? ----------------------------
if not exist "tool.mjs" (
    echo.
    echo  ERROR: the program file "tool.mjs" is missing.
    echo.
    echo  Expected to find: "%CD%\tool.mjs"
    echo.
    echo  Fix: copy the folder again, keeping run.bat and tool.mjs
    echo       together.
    echo.
    goto :halt
)

rem --- Is there anything to do? ----------------------------------
if not exist "input" (
    echo.
    echo  ERROR: the "input" folder does not exist.
    echo.
    echo  Fix: create a folder named "input" next to run.bat and put
    echo       your PDF files in it.
    echo.
    goto :halt
)

rem --- Run --------------------------------------------------------
rem --enable-source-maps makes a crash report name the real source
rem file and line instead of an offset into the bundled tool.mjs.
node --enable-source-maps "tool.mjs"
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ================================================================
    echo   THE RUN DID NOT FINISH ^(error code %EXIT_CODE%^)
    echo ================================================================
    echo.
    echo  Read the message above for the reason.
    echo  If an Excel file from a previous run is open, close it and
    echo  try again.
    echo.
    goto :halt
)

echo  Opening the output folder...
if exist "output" start "" "output"

:halt
echo.
echo  Press any key to close this window.
pause >nul
endlocal
