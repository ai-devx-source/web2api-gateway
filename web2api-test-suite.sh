#!/bin/bash

echo ""
echo "================================================"
echo " Web2API Gateway Verification Suite / AI_DEVX"
echo "================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[ERROR] Dependencies not found!"
    echo "Please run './web2api-install.sh' first."
    exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
pushd "$DIR" > /dev/null

echo "Running tests and smoke scenarios..."
echo ""

echo "Test 1: Provider Smoke Tests"
npm run test
echo ""

echo "Test 2: Standard non-streaming test"
node scripts/api_connector_smoke.js
echo ""

echo "Test 3: Interactive chat (type 'exit' to quit)"
node scripts/interactive_chat.js
echo ""

popd > /dev/null

echo "================================================"
echo " Verification completed"
echo "================================================"
