#!/bin/bash

echo ""
echo "================================================"
echo " Web2API Gateway / AI_DEVX"
echo " Professional Installer"
echo "================================================"
echo ""

echo "[1/4] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js (v18 or higher) from https://nodejs.org/"
    exit 1
fi

echo "[2/4] Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed!"
    echo "Please reinstall Node.js or install npm."
    exit 1
fi

echo ""
echo "Ready to install dependencies and browsers."
echo "This might take a few minutes and download several gigabytes of data."
read -p "Press Enter to continue or Ctrl+C to cancel..."

echo "[3/4] Installing Node.js dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies!"
    exit 1
fi

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "Creating default .env file..."
        cp .env.example .env
    fi
fi

echo ""
echo "================================================"
echo " Installation completed successfully!"
echo " You can now run './web2api-start.sh' to launch."
echo "================================================"
