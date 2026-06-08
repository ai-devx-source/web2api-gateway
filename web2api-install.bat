@echo off
chcp 65001 >nul
title Web2API Gateway Installer

echo.
echo ================================================
echo  Web2API Gateway / AI_DEVX
echo  Professional Installer
echo ================================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js v18 or higher from https://nodejs.org/
    pause
    exit /b 1
)

echo [2/4] Checking npm...
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed!
    echo Please reinstall Node.js.
    pause
    exit /b 1
)

echo.
echo Ready to install dependencies and browsers.
echo This might take a few minutes and download several gigabytes of data.
echo Press Ctrl+C to cancel, or
pause

echo [3/4] Installing Node.js dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)



if not exist .env (
    if exist .env.example (
        echo Creating default .env file...
        copy .env.example .env >nul
    )
)

echo.
echo ================================================
echo  Installation completed successfully!
echo  You can now run 'web2api-start.bat' to launch the server.
echo ================================================
pause
