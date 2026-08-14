// ─────────────────────────────────────────────────────────────────────────────
// Catan full-game headless harness.
//
// Drives the ACTUAL compiled game rules (from client/src/game/*) through full
// randomized games, mirroring the server's action dispatch exactly (including
// the discard-on-7 and dev-card phases). Fails if any game stalls or any AI
// proposes an illegal move.
//
// Env vars:
//   GAMES   total number of games to run (default 20)
//   PLAYERS space-separated player counts, e.g. "2 3 4" (default "2 3 4")
//
// Exit 0 = all games completed with a winner. Exit 1 = stall or illegal move.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const RULES_PATH = process.env.GAMEOUT || '/tmp/catan-gameout/rules.js';
const R = require(RULES_PATH);
const B = require(path.join(path.dirname(RULES_PATH), 'board.js'));

const GAMES = parseInt(process.env.GAMES || '20', 10);
const PLAYERS = (process.env.PLAYERS || '2 3 4').split(/\s+/).map(Number);

let games = 0, completed = 0, stalls = 0, illegalMoves = 0;
const stallLog = [];

function totalRes(p) {
  return ['brick','lumber','wool','grain','ore'].reduce((s,r)=>s+(p.resources[r]||0),0);
}

// Auto-discard for AI (mirrors server autoDiscardAIs — drain full queue).
function autoDiscardAI(state) {
  let guard = 0;
  while (state.phase === 'discard' && guard++ < 10) {
    const ai = state.players.find(p => p.isAI && state.discardQueue.includes(p.color));
    if (!ai) break;
    const must = Math.floor(totalRes(ai) / 2);
    const toDiscard = {};
    let remaining = must;
    const sorted = ['brick', 'lumber', 'wool', 'grain', 'ore']
      .sort((a, b) => (ai.resources[b] || 0) - (ai.resources[a] || 0));
    for (const r of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(ai.resources[r] || 0, remaining);
      if (take > 0) { toDiscard[r] = take; remaining -= take; }
    }
    const err = R.discardResources(state, ai.color, toDiscard);
    if (err) { illegalMoves++; console.log(`  [BUG] AI discard failed: ${err}`); break; }
  }
}

// Mirror the server's action-dispatch switch EXACTLY.
function applyAction(state, action) {
  switch (action.action) {
    case 'roll_dice': {
      const [d1,d2] = R.rollDice(state);
      if (d1+d2 === 7) autoDiscardAI(state);
      break;
    }
    case 'skip_trade': state.phase = 'build'; break;
    case 'discard':
      // aiTurn already discarded the current AI; drain any other AIs still queued
      autoDiscardAI(state);
      break;
    case 'place_settlement':
      if (state.setupPhase) {
        const e = R.placeSetupSettlement(state, action.data.key);
        if (e) { illegalMoves++; console.log(`  [BUG] setup settlement: ${e}`); }
        R.advanceSetup(state);
      } else {
        const e = R.placeSettlement(state, action.data.key);
        if (e) { illegalMoves++; console.log(`  [BUG] settlement: ${e}`); }
      }
      break;
    case 'place_road':
      if (state.setupPhase) {
        const e = R.placeSetupRoad(state, action.data.key);
        if (e) { illegalMoves++; console.log(`  [BUG] setup road: ${e}`); }
        R.advanceSetup(state);
      } else {
        const e = R.placeRoad(state, action.data.key);
        if (e) { illegalMoves++; console.log(`  [BUG] road: ${e}`); }
      }
      break;
    case 'place_city': {
      const e = R.placeCity(state, action.data.key);
      if (e) { illegalMoves++; console.log(`  [BUG] city: ${e}`); }
      break;
    }
    case 'buy_dev_card': R.buyDevCard(state); break;
    case 'bank_trade': {
      const p = R.getCurrentPlayer(state);
      const give = action.data.give, get = action.data.get;
      const rate = B.getPortRate(p.color, give, state.ports, state.intersections);
      if ((p.resources[give]||0) >= rate) {
        p.resources[give] -= rate;
        p.resources[get] = (p.resources[get]||0) + 1;
      }
      break;
    }
    case 'end_turn': R.endTurn(state); break;
    case 'advance_setup': R.advanceSetup(state); break;
    case 'roll_turn_order': break; // handled inside aiTurn
    default: break;
  }
}

function playGame(numPlayers) {
  games++;
  // All players are AI so aiTurn can drive everyone.
  const config = {
    numPlayers,
    playerNames: Array.from({length:numPlayers},(_,i)=>`P${i+1}`),
    aiPlayers: Array.from({length:numPlayers},(_,i)=>i),
  };
  const state = R.createInitialState(config);
  let rolls = 0;
  const maxRolls = 2000;

  // Setup phase
  while (state.setupPhase) {
    const action = R.aiTurn(state);
    if (!action) {
      stalls++; stallLog.push(`setup stall (setupRound=${state.setupRound}, phase=${state.phase})`);
      return;
    }
    applyAction(state, action);
    if (++rolls > maxRolls) { stalls++; stallLog.push('setup infinite loop'); return; }
  }

  // Main loop
  while (!state.winner) {
    const action = R.aiTurn(state);
    if (!action) {
      stalls++; stallLog.push(`main stall (phase=${state.phase}, turn=${state.currentTurn})`);
      return;
    }
    applyAction(state, action);
    if (++rolls > maxRolls) { stalls++; stallLog.push(`main infinite loop (phase=${state.phase})`); return; }
  }

  completed++;
  const winner = state.players.find(p=>p.color===state.winner);
  const maxVP = Math.max(...state.players.map(p=>p.victoryPoints));
  console.log(`  ✓ ${numPlayers}p game ${games}: ${winner.name} wins with ${winner.victoryPoints} VP (${rolls} rolls, maxVP=${maxVP})`);
}

for (const n of PLAYERS) {
  const count = Math.max(1, Math.floor(GAMES / PLAYERS.length));
  console.log(`=== ${n}-player games (all AI) ===`);
  for (let i=0;i<count;i++) playGame(n);
}

console.log(`\n=== RESULTS ===`);
console.log(`Games: ${games}`);
console.log(`Completed: ${completed}`);
console.log(`Stalls: ${stalls}`);
console.log(`Illegal moves: ${illegalMoves}`);
if (stallLog.length) {
  console.log('Stall details:');
  stallLog.forEach(s=>console.log(`  - ${s}`));
}

// ── Regression: multi-AI discard after a 7 must fully drain ──
console.log('\n=== multi-AI discard regression ===');
(function multiAiDiscardRegression() {
  const config = {
    numPlayers: 4,
    playerNames: ['P1', 'P2', 'P3', 'P4'],
    aiPlayers: [0, 1, 2, 3],
  };
  const state = R.createInitialState(config);
  // Force out of setup into a normal roll phase
  state.setupPhase = false;
  state.phase = 'roll';
  state.setupRound = 99;
  // Stuff every hand above 7
  for (const p of state.players) {
    p.resources = { brick: 3, lumber: 3, wool: 2, grain: 2, ore: 2 }; // 12 each
  }
  // Roll until we get a 7 (or force via rollDice many times)
  let got7 = false;
  for (let i = 0; i < 80 && !got7; i++) {
    state.phase = 'roll';
    state.dice = null;
    const [d1, d2] = R.rollDice(state);
    if (d1 + d2 === 7) {
      got7 = true;
      autoDiscardAI(state);
    }
  }
  if (!got7) {
    // Force discard queue as if a 7 happened
    state.discardQueue = state.players.map(p => p.color);
    state.phase = 'discard';
    autoDiscardAI(state);
  }
  const remainingAI = state.discardQueue.filter(c => {
    const p = state.players.find(x => x.color === c);
    return p && p.isAI;
  });
  if (remainingAI.length > 0 || state.phase === 'discard' && state.discardQueue.some(c => state.players.find(p => p.color === c)?.isAI)) {
    console.log('  ✗ FAIL — AIs still in discard queue:', remainingAI);
    illegalMoves++;
  } else {
    console.log('  ✓ multi-AI discard queue drained (phase=' + state.phase + ', queue=' + state.discardQueue.length + ')');
  }
})();

process.exit(stalls>0 || illegalMoves>0 ? 1 : 0);
