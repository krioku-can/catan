#!/usr/bin/env bash
# Catan LAN host — family games over your own WiFi, no internet needed.
#
# Starts:
#   1. The Catan Socket.io server (bind 0.0.0.0:3001)
#   2. The Vite dev server (host:true, :5173) so phones on the LAN can load the game
#
# Then tells you the URL everyone on the same WiFi opens to join.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# -- Find the Mac's LAN IP -----------------------------------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [ -z "$LAN_IP" ]; then
  echo "⚠️  Could not auto-detect your WiFi IP. Make sure you're on WiFi." >&2
  LAN_IP="YOUR_MAC_IP"
fi

cat <<'BANNER'
┌───────────────────────────────────────────────────────────┐
│ 🏝️ CATAN — LAN HOST                                       │
│  Family games over your own WiFi. No internet needed.     │
│  NOTE: your Mac must STAY AWAKE while hosting.            │
└───────────────────────────────────────────────────────────┘
BANNER

echo
echo "📱 Phones on the SAME WiFi open:"
echo "     http://${LAN_IP}:5173"
echo
echo "   (Make sure your phone is on the same network — "
echo "    guest/isolation networks may block it.)"
echo

# -- Start the API server in the background ------------------------------
echo "▶️  Starting API server on :3001 ..."
(cd "$ROOT/server" && HOST=0.0.0.0 npm run dev) &
SERVER_PID=$!

# -- Start the Vite client (host:true) in the foreground ------------------
echo "▶️  Starting Vite client on :5173 ..."
echo "   (Ctrl+C to stop both)"
echo
(cd "$ROOT/client" && npm run dev)

# Clean up the server when Vite exits
kill "$SERVER_PID" 2>/dev/null || true
