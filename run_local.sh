#!/bin/bash

echo "========================================================"
echo "Starting Financial Transaction Visualizer Local Server"
echo "========================================================"
echo ""

# Try to open the browser automatically
open_browser() {
    if command -v xdg-open > /dev/null; then
        xdg-open http://localhost:8000 &
    elif command -v open > /dev/null; then
        open http://localhost:8000 &
    fi
}

# Check for python3
if command -v python3 &>/dev/null; then
    echo "Using Python 3..."
    open_browser
    python3 -m http.server 8000
elif command -v python &>/dev/null; then
    echo "Using Python..."
    open_browser
    python -m http.server 8000
else
    echo "Python is not installed or not in PATH."
    echo ""
    echo "If you have Node.js installed, you can try:"
    echo "npx serve"
    echo ""
    echo "Alternatively, you can just open index.html directly in your browser."
fi
