#!/bin/bash
set -e
echo "Installing dependencies..."
npm install
npx playwright install chromium
echo "Setup complete."
