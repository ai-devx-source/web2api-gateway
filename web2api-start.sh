#!/bin/bash

echo ""
echo "================================================"
echo " Web2API Gateway / AI_DEVX"
echo " Local OpenAI-compatible multi-provider gateway"
echo "================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[ERROR] Dependencies not found!"
    echo "Please run './web2api-install.sh' first to prepare the environment."
    exit 1
fi

echo "Starting Web2API Gateway..."
echo ""

npm start
