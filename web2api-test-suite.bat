@echo off
chcp 65001 >nul
setlocal

echo.
echo ================================================
echo  Web2API Gateway Verification Suite / AI_DEVX
echo ================================================
echo.

if not exist "node_modules\" (
    echo [ERROR] Dependencies not found!
    echo Please run 'web2api-install.bat' first.
    pause
    exit /b 1
)

pushd "%~dp0"

echo Running tests and smoke scenarios...
echo.

echo Test 1: Provider Smoke Tests
call npm run test
echo.

echo Test 2: Standard non-streaming test
call node scripts/api_connector_smoke.js
echo.

echo Test 3: Interactive chat (type 'exit' to quit)
call node scripts/interactive_chat.js
echo.

popd

echo ================================================
echo  Verification completed
echo ================================================
pause
