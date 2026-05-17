#!/bin/bash
# Demarrage local du LLM Council (dev).
#
# Pre-requis :
#   - Node.js >= 20
#   - .env present avec OPENROUTER_API_KEY

set -e

echo "[..] npm install (backend)"
npm install --no-audit --no-fund

echo "[..] npm install (frontend)"
cd frontend && npm install --no-audit --no-fund && cd ..

echo "[..] backend sur http://localhost:8001"
node backend/server.js &
BACKEND_PID=$!

sleep 2

echo "[..] frontend sur http://localhost:5180"
cd frontend && npm run dev &
FRONTEND_PID=$!

echo ""
echo "[OK] LLM Council demarre."
echo "     Backend  : http://localhost:8001"
echo "     Frontend : http://localhost:5180"
echo ""
echo "Ctrl+C pour stopper."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
