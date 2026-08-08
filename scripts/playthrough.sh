#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Catan full-game playthrough harness
#
# Compiles the actual game rules (client/src/game/*) to plain JS and drives
# 20 randomized full games (8× 2p, 8× 3p, 4× 4p, all-AI) start-to-finish.
# Fails if any game stalls or any AI proposes an illegal move.
#
# Usage:
#   ./scripts/playthrough.sh            # run the standard 20-game suite
#   GAMES=40 ./scripts/playthrough.sh   # override game count (default 20)
#   PLAYERS="2 3 4" ./scripts/playthrough.sh  # override player configs
#
# Exit code 0 = all games completed with a winner, no stalls, no illegal moves.
# Exit code 1 = a stall or illegal move was found (a rules bug).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT="$ROOT/client"
OUTDIR="${TMPDIR:-/tmp}/catan-gameout"
GAMES="${GAMES:-20}"
PLAYERS="${PLAYERS:-"2 3 4"}"
HARNESS="$ROOT/scripts/harness.js"

echo "▸ Compiling rules (client/src/game/*) → $OUTDIR"
rm -rf "$OUTDIR"
(cd "$CLIENT" && npx tsc src/game/rules.ts src/game/board.ts src/game/types.ts \
  --outDir "$OUTDIR" --module commonjs --target es2020 \
  --skipLibCheck --moduleResolution node --esModuleInterop --ignoreConfig \
  2>&1 | grep -v "deprecat\|migration" || true)

echo "▸ Running $GAMES full games (players: $PLAYERS)"
GAMES="$GAMES" PLAYERS="$PLAYERS" node "$HARNESS"
