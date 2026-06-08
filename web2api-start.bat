@echo off
chcp 65001 >nul
title Web2API Gateway

echo.
echo ================================================
echo  Web2API Gateway / AI_DEVX
echo  Local OpenAI-compatible multi-provider gateway
echo ================================================
echo.

if not exist "node_modules\" (
    echo [ERROR] Dependencies not found!
    echo Please run 'web2api-install.bat' first to prepare the environment.
    pause
    exit /b 1
)

echo Starting Web2API Gateway...
echo.

call npm start

pause
