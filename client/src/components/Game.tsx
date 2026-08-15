import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState, GameConfig, PlayerColor, ResourceType } from '../game/types';
import { createInitialState, getCurrentPlayer, getPlayerByColor, executeTrade, executeBankTrade, rollDice, rollTurnOrder, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight, discardResources, playRoadBuilding, playYearOfPlenty, playMonopoly, countHeldDevCards, getStealTargets, stealFrom } from '../game/rules';
import { getHexCorners } from '../game/board';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import DiceFlash from './DiceFlash';
import HandBar from './HandBar';
import TradePanel from './TradePanel';
import TradeOffers from './TradeOffers';
import BuildMenu from './BuildMenu';
import GameLog from './GameLog';
import DiscardModal from './DiscardModal';
import DevCardPanel from './DevCardPanel';
import TurnCoach from './TurnCoach';
import { recordGame } from '../stats';
import { setStored, getStored } from '../storage';
import { unlockAudio, sfx, isMuted, setMuted } from '../audio';
import { getTurnCoach } from '../turnCoach';

const HEX_SIZE = 68;

interface GameProps {
  quickStart?: boolean;
  playerName?: string;
  onExit?: () => void;
  resume?: boolean;
}

export default function Game({ quickStart = false, playerName = 'You', onExit, resume = false }: GameProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [_config, _setConfig] = useState<GameConfig | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showSetup, setShowSetup] = useState(!quickStart);
  const [diceRolling, setDiceRolling] = useState(false);
  const [robberMode, setRobberMode] = useState(false);
  const [stealTargets, setStealTargets] = useState<PlayerColor[]>([]);
  const [pendingSteal, setPendingSteal] = useState<{ q: number; r: number } | null>(null);
  const [showPanel, setShowPanel] = useState<'actions' | 'hand' | 'log' | null>(null);
  const [diceFlash, setDiceFlash] = useState<{ total: number; faces: [number, number] } | null>(null);
  const [debug, setDebug] = useState(() => new URLSearchParams(window.location.search).get('debug') === '1');
  const [turnOrderRolls, setTurnOrderRolls] = useState<Record<string, number> | null>(null);
  const [muted, setMutedState] = useState(() => isMuted());
  const startedRef = useRef(false);
  const statsRecordedRef = useRef(false);
  const lastTurnColorRef = useRef<string | null>(null);

  // Unlock Web Audio on first pointer so SFX work on mobile
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Your-turn chime when control passes to the human
  useEffect(() => {
    if (!gameState) return;
    const cur = getCurrentPlayer(gameState);
    const prev = lastTurnColorRef.current;
    lastTurnColorRef.current = cur.color;
    if (prev && prev !== cur.color && !cur.isAI) sfx.yourTurn();
  }, [gameState?.currentTurn, gameState?.phase]);

  useEffect(() => {
    if (gameState?.winner) sfx.win();
  }, [gameState?.winner]);

  // Auto-save the game to localStorage on every state change so a refresh
  // or accidental close never loses progress. Cleared when the game ends.
  useEffect(() => {
    if (!gameState) return;
    if (gameState.winner) {
      setStored('catan_save', '');
      return;
    }
    setStored('catan_save', JSON.stringify(gameState));
  }, [gameState]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const startGame = useCallback((c: GameConfig) => {
    const state = createInitialState(c);
    _setConfig(c);
    setGameState(state);
    setShowSetup(false);
    addLog(`Game started! ${c.playerNames.join(' vs ')} · ${state.victoryPointsToWin} VP${state.friendlyRobber ? ' · Friendly Robber' : ''}`);
    addLog('Setup: place settlements & roads. Resources only on your SECOND settlement.');
  }, [addLog]);

  // One-tap vs AI still supported if quickStart=true (defaults: 4p, balanced, friendly robber)
  useEffect(() => {
    if (!quickStart || startedRef.current) return;
    startedRef.current = true;
    startGame({
      numPlayers: 4,
      playerNames: [playerName, 'AI Blue', 'AI White', 'AI Orange'],
      aiPlayers: [1, 2, 3],
      victoryPointsToWin: 10,
      friendlyRobber: true,
      boardMode: 'balanced',
    });
  }, [quickStart, playerName, startGame]);

  // Resume a saved game
  useEffect(() => {
    if (!resume || startedRef.current) return;
    startedRef.current = true;
    const raw = getStored('catan_save');
    if (raw) {
      try {
        const saved = JSON.parse(raw) as GameState;
        // Backfill Catan Universe settings for older saves
        if (saved.victoryPointsToWin == null) saved.victoryPointsToWin = 10;
        if (saved.friendlyRobber == null) saved.friendlyRobber = false;
        if (!saved.boardMode) saved.boardMode = 'random';
        setGameState(saved);
        setShowSetup(false);
        addLog('Resumed saved game');
      } catch {
        setShowSetup(true);
      }
    } else {
      setShowSetup(true);
    }
  }, [resume, addLog]);

  // Auto-run AI turns when it's an AI player's turn
  useEffect(() => {
    if (!gameState) return;
    const current = getCurrentPlayer(gameState);
    if (!current.isAI) return;

    const t = setTimeout(() => {
      const action = aiTurn(gameState);
      if (!action) {
        // AI is waiting (e.g. not in the discard queue, or no legal move).
        // Do NOT setGameState here — that creates a new object reference and
        // re-triggers this effect, causing an infinite loop. The effect will
        // re-run when gameState changes externally (e.g. the human discards).
        return;
      }
      switch (action.action) {
        case 'roll_dice': {
          const [d1, d2] = rollDice(gameState);
          addLog(`${current.name} rolled ${d1 + d2}`);
          // If the AI rolled a 7, the discard queue may hold OTHER AIs (the
          // roller itself might not be in it). Drain every AI in the queue so
          // the game doesn't freeze on "Waiting for discard: <AI>" — the
          // `discard` case below only fires when the CURRENT AI is in the queue.
          if (d1 + d2 === 7) {
            let guard = 0;
            while (gameState.phase === 'discard' && guard++ < 10) {
              const aiInQueue = gameState.players.find(
                p => p.isAI && gameState.discardQueue.includes(p.color)
              );
              if (!aiInQueue) break;
              const total = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
                .reduce((s, r) => s + (aiInQueue.resources[r] || 0), 0);
              const mustDiscard = Math.floor(total / 2);
              const toDiscard: Partial<Record<ResourceType, number>> = {};
              let remaining = mustDiscard;
              const sorted = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
                .sort((a, b) => (aiInQueue.resources[b] || 0) - (aiInQueue.resources[a] || 0));
              for (const r of sorted) {
                if (remaining <= 0) break;
                const take = Math.min(aiInQueue.resources[r] || 0, remaining);
                if (take > 0) { toDiscard[r] = take; remaining -= take; }
              }
              discardResources(gameState, aiInQueue.color, toDiscard);
              addLog(`${aiInQueue.name} discarded cards after the 7`);
            }
          }
          break;
        }
        case 'skip_trade':
          gameState.phase = 'build';
          break;
        case 'discard':
          // aiTurn already applied the current AI's discard. But a 7 can put
          // MULTIPLE AI players in the discard queue at once (the current AI
          // rolled, other AIs also had >7 cards). Drain the rest of the AI
          // discard queue so it doesn't freeze waiting on them.
          {
            let guard = 0;
            while (gameState.phase === 'discard' && guard++ < 10) {
              const aiInQueue = gameState.players.find(
                p => p.isAI && gameState.discardQueue.includes(p.color)
              );
              if (!aiInQueue) break;
              const total = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
                .reduce((s, r) => s + (aiInQueue.resources[r] || 0), 0);
              const mustDiscard = Math.floor(total / 2);
              const toDiscard: Partial<Record<ResourceType, number>> = {};
              let remaining = mustDiscard;
              const sorted = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
                .sort((a, b) => (aiInQueue.resources[b] || 0) - (aiInQueue.resources[a] || 0));
              for (const r of sorted) {
                if (remaining <= 0) break;
                const take = Math.min(aiInQueue.resources[r] || 0, remaining);
                if (take > 0) { toDiscard[r] = take; remaining -= take; }
              }
              discardResources(gameState, aiInQueue.color, toDiscard);
              addLog(`${aiInQueue.name} discarded cards after the 7`);
            }
          }
          break;
        case 'place_settlement':
          if (gameState.setupPhase) placeSetupSettlement(gameState, action.data.key);
          else placeSettlement(gameState, action.data.key);
          if (gameState.setupPhase) advanceSetup(gameState);
          addLog(`${current.name} placed a settlement`);
          break;
        case 'place_road':
          if (gameState.setupPhase) placeSetupRoad(gameState, action.data.key);
          else placeRoad(gameState, action.data.key);
          if (gameState.setupPhase) advanceSetup(gameState);
          addLog(`${current.name} placed a road`);
          break;
        case 'place_city':
          placeCity(gameState, action.data.key);
          addLog(`${current.name} built a city`);
          break;
        case 'buy_dev_card':
          buyDevCard(gameState);
          addLog(`${current.name} bought a dev card`);
          break;
        case 'bank_trade':
          // 4:1 bank trade: give 4 of one resource, get 1 of another
          {
            const give = action.data.give as ResourceType;
            const get = action.data.get as ResourceType;
            if ((current.resources[give] || 0) >= 4) {
              current.resources[give] -= 4;
              current.resources[get] = (current.resources[get] || 0) + 1;
              addLog(`${current.name} traded 4 ${give} → 1 ${get}`);
            }
          }
          break;
        case 'end_turn':
          endTurn(gameState);
          addLog(`${current.name} ended turn`);
          break;
        case 'advance_setup':
          advanceSetup(gameState);
          break;
        default:
          break;
      }
      setGameState({ ...gameState });
    }, 650);
    return () => clearTimeout(t);
  }, [gameState, addLog]);

  const handleHexClick = useCallback((q: number, r: number) => {
    if (!gameState) return;
    
    if (robberMode) {
      const result = moveRobber(gameState, q, r);
      if (result === null) {
        sfx.robber();
        setRobberMode(false);
        // Compute steal targets from the NEW hex (where the robber now sits).
        const targets = getStealTargets(gameState, q, r);
        if (targets.length > 0) {
          setPendingSteal({ q, r });
          setStealTargets(targets);
        } else {
          addLog('Robber moved');
          setGameState({ ...gameState });
        }
      }
      return;
    }
  }, [gameState, robberMode, addLog]);

  const handleIntersectionClick = useCallback((key: string) => {
    if (!gameState) return;
    const player = getCurrentPlayer(gameState);

    if (gameState.setupPhase) {
      if (gameState.phase === 'setup_settlement') {
        const err = placeSetupSettlement(gameState, key);
        if (err === null) {
          sfx.build();
          addLog(`${player.name} placed a settlement`);
          setGameState({ ...gameState });
          advanceSetup(gameState);
          setGameState({ ...gameState });
        }
      }
      return;
    }

    if (gameState.phase === 'build' || gameState.phase === 'trade') {
      if (selectedAction === 'settlement') {
        const err = placeSettlement(gameState, key);
        if (err === null) {
          sfx.build();
          addLog(`${player.name} built a settlement`);
          setSelectedAction(null);
          setGameState({ ...gameState });
        }
      } else if (selectedAction === 'city') {
        const err = placeCity(gameState, key);
        if (err === null) {
          sfx.build();
          addLog(`${player.name} upgraded to a city`);
          setSelectedAction(null);
          setGameState({ ...gameState });
        }
      }
    }
  }, [gameState, selectedAction, addLog]);

  const handleEdgeClick = useCallback((key: string) => {
    if (!gameState) return;
    const player = getCurrentPlayer(gameState);

    if (gameState.setupPhase) {
      if (gameState.phase === 'setup_road') {
        const err = placeSetupRoad(gameState, key);
        if (err === null) {
          sfx.road();
          addLog(`${player.name} placed a road`);
          setGameState({ ...gameState });
          advanceSetup(gameState);
          setGameState({ ...gameState });
        }
      }
      return;
    }

    // Normal roads (selected) or free Road Building placements.
    const freeRoads = gameState.pendingDevAction === 'road_building' && gameState.pendingDevRoads > 0;
    if (freeRoads || ((gameState.phase === 'build' || gameState.phase === 'trade') && selectedAction === 'road')) {
      const err = placeRoad(gameState, key);
      if (err === null) {
        sfx.road();
        addLog(freeRoads
          ? `${player.name} placed a free road (${gameState.pendingDevRoads} left)`
          : `${player.name} built a road`);
        if (!freeRoads) setSelectedAction(null);
        setGameState({ ...gameState });
      }
    }
  }, [gameState, selectedAction, addLog]);

  const handleTurnOrder = useCallback(() => {
    if (!gameState) return;
    if (gameState.phase !== 'turn_order') return;
    // If we've already rolled (rolls shown), this tap starts placing
    if (turnOrderRolls) {
      gameState.phase = 'setup_settlement';
      gameState.setupRound = 0;
      setGameState({ ...gameState });
      return;
    }
    const result = rollTurnOrder(gameState);
    setTurnOrderRolls(result.rolls);
    // Log the result in order
    result.order.forEach((color, i) => {
      const p = gameState.players.find(p => p.color === color);
      addLog(`${i + 1}. ${p?.name ?? color} rolled ${result.rolls[color]}`);
    });
    setGameState({ ...gameState });
  }, [gameState, turnOrderRolls, addLog]);

  const handleRollDice = useCallback(() => {
    if (!gameState) return;
    setDiceRolling(true);
    setTimeout(() => {
      const [d1, d2] = rollDice(gameState);
      const total = d1 + d2;
      sfx.dice();
      setDiceFlash({ total, faces: [d1, d2] });
      addLog(`${getCurrentPlayer(gameState).name} rolled ${d1} + ${d2} = ${total}`);
      
      // rollDice() sets phase to 'trade'. Per official rules the turn is
      // roll → trade → build, so the roller stays in the trade phase and
      // advances to build via the "Done Trading" button (skip_trade).
      // The AI reaches build via its internal skip_trade.
      
      if (total === 7) {
        sfx.robber();
        addLog('7 rolled! Robber time!');
        // Auto-discard for AI players who have >7 cards.
        for (const ai of gameState.players) {
          if (!ai.isAI) continue;
          if (!gameState.discardQueue.includes(ai.color)) continue;
          const aiTotal = ['brick', 'lumber', 'wool', 'grain', 'ore'].reduce((s, r) => s + (ai.resources[r as ResourceType] || 0), 0);
          const mustDiscard = Math.floor(aiTotal / 2);
          const toDiscard: Partial<Record<ResourceType, number>> = {};
          let remaining = mustDiscard;
          const sorted = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
            .sort((a, b) => (ai.resources[b] || 0) - (ai.resources[a] || 0));
          for (const r of sorted) {
            if (remaining <= 0) break;
            const take = Math.min(ai.resources[r] || 0, remaining);
            if (take > 0) { toDiscard[r] = take; remaining -= take; }
          }
          discardResources(gameState, ai.color, toDiscard);
        }
        setRobberMode(true);
        const [rq, rr] = gameState.robberHex.split(',').map(Number);
        const targets: PlayerColor[] = [];
        const corners = getHexCorners(rq, rr);
        corners.forEach(cKey => {
          const inter = gameState.intersections[cKey];
          if (inter?.owner && inter.owner !== getCurrentPlayer(gameState).color) {
            const p = gameState.players.find(p => p.color === inter.owner);
            if (p) {
              const hasRes = ['brick', 'lumber', 'wool', 'grain', 'ore'].some(r => (p.resources[r as ResourceType] || 0) > 0);
              if (hasRes) targets.push(inter.owner);
            }
          }
        });
        setStealTargets(targets);
      }
      
      setDiceRolling(false);
      setGameState({ ...gameState });
    }, 1000);
  }, [gameState, addLog]);

  const handleEndTurn = useCallback(() => {
    if (!gameState) return;
    const player = getCurrentPlayer(gameState);
    endTurn(gameState);
    addLog(`${player.name} ended their turn`);
    setSelectedAction(null);
    setGameState({ ...gameState });
    setTimeout(() => {
      if (!gameState) return;
      const current = getCurrentPlayer(gameState);
      if (current.isAI) {
        const action = aiTurn(gameState);
        if (action) {
          addLog(`AI ${current.name}: ${action.action}`);
          setGameState({ ...gameState });
        }
      }
    }, 500);
  }, [gameState, addLog]);

  const handleSkipTrade = useCallback(() => {
    if (!gameState) return;
    gameState.phase = 'build';
    setSelectedAction(null);
    setGameState({ ...gameState });
  }, [gameState]);

  const handleDiscard = useCallback((discard: Partial<Record<ResourceType, number>>) => {
    if (!gameState) return;
    const me = gameState.players.find(p => !p.isAI);
    if (!me) return;
    const err = discardResources(gameState, me.color, discard);
    if (err === null) {
      sfx.discard();
      addLog('You discarded cards after the 7');
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handlePlayRoadBuilding = useCallback(() => {
    if (!gameState) return;
    const err = playRoadBuilding(gameState);
    if (err === null) {
      addLog(`${getCurrentPlayer(gameState).name} played Road Building!`);
      setSelectedAction('road');
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handlePlayYearOfPlenty = useCallback((r1: ResourceType, r2: ResourceType) => {
    if (!gameState) return;
    const err = playYearOfPlenty(gameState, r1, r2);
    if (err === null) {
      addLog(`${getCurrentPlayer(gameState).name} played Year of Plenty!`);
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handlePlayMonopoly = useCallback((r: ResourceType) => {
    if (!gameState) return;
    const err = playMonopoly(gameState, r);
    if (err === null) {
      addLog(`${getCurrentPlayer(gameState).name} played Monopoly on ${r}!`);
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handleBuyDevCard = useCallback(() => {
    if (!gameState) return;
    const card = buyDevCard(gameState);
    if (card) {
      addLog(`${getCurrentPlayer(gameState).name} bought a development card (${card.type})`);
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handlePlayKnight = useCallback(() => {
    if (!gameState) return;
    const err = playKnight(gameState);
    if (err === null) {
      addLog(`${getCurrentPlayer(gameState).name} played a Knight!`);
      setRobberMode(true);
      setGameState({ ...gameState });
    }
  }, [gameState, addLog]);

  const handleSteal = useCallback((target: PlayerColor) => {
    if (!gameState || !pendingSteal) return;
    const err = stealFrom(gameState, target);
    if (err === null) {
      addLog(`Robber stole from ${getPlayerByColor(gameState, target)?.name}`);
    }
    setPendingSteal(null);
    setStealTargets([]);
    setGameState({ ...gameState });
  }, [gameState, pendingSteal, addLog]);

  // Record result once when the game ends
  useEffect(() => {
    if (!gameState || !gameState.winner || statsRecordedRef.current) return;
    const myPlayer = gameState.players.find(p => !p.isAI);
    const winnerColor = gameState.winner;
    const won = myPlayer?.color === winnerColor;
    const winner = gameState.players.find(p => p.color === winnerColor);
    statsRecordedRef.current = true;
    recordGame({
      players: gameState.players.length,
      mode: 'ai',
      won,
      wonAs: winnerColor,
      victoryPoints: winner?.victoryPoints ?? 0,
      playerColor: myPlayer?.color ?? 'red',
      opponents: gameState.players.length - 1,
    });
    addLog(`🎉 ${winner?.name ?? 'Player'} wins with ${winner?.victoryPoints ?? 10} points!`);
  }, [gameState, addLog]);

  if (showSetup) {
    return <SetupScreen onStart={startGame} onBack={onExit} defaultName={playerName} />;
  }

  if (!gameState) {
    return (
      <div style={styles.setupScreen}>
        <p style={styles.subtitle}>Starting game…</p>
      </div>
    );
  }

  const player = getCurrentPlayer(gameState);
  const isMyTurn = !player.isAI;
  const me = gameState.players.find(p => !p.isAI) || gameState.players[0];

  return (
    <div style={styles.mobileContainer}>
      {gameState.phase === 'turn_order' && (
        <div style={styles.turnOrderScreen}>
          <h2 style={styles.turnOrderTitle}>🎲 Roll for Turn Order</h2>
          <p style={styles.turnOrderSub}>
            {turnOrderRolls ? 'Turn order locked in — highest roll goes first!' : 'Each player rolls 2 dice. Highest roll places first.'}
          </p>
          {turnOrderRolls && (
            <div style={styles.turnOrderList}>
              {gameState.turnOrder.map((color, i) => {
                const p = gameState.players.find(p => p.color === color);
                return (
                  <div key={color} style={styles.turnOrderItem}>
                    <span style={styles.turnOrderRank}>{i + 1}</span>
                    <span style={{ ...styles.turnOrderDot, backgroundColor: color }} />
                    <span style={styles.turnOrderName}>{p?.name}{!p?.isAI ? ' (You)' : ''}</span>
                    <span style={styles.turnOrderRoll}>🎲 {turnOrderRolls[color]}</span>
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            style={styles.turnOrderBtn}
            onClick={handleTurnOrder}
          >
            {turnOrderRolls ? 'Start Placing!' : 'Roll Turn Order'}
          </button>
          {turnOrderRolls && (
            <p style={styles.turnOrderHint}>Tap "Start Placing" to begin setup.</p>
          )}
        </div>
      )}
      {gameState.winner && (
        <div style={styles.winOverlay}>
          <div style={styles.winCard}>
            <div style={styles.winEmoji}>{me.color === gameState.winner ? '🏆' : '🤖'}</div>
            <h2 style={styles.winTitle}>
              {me.color === gameState.winner ? 'You Win!' : 'Better Luck Next Time'}
            </h2>
            <p style={styles.winSub}>
              {gameState.players.find(p => p.color === gameState.winner)?.name} wins with{' '}
              {gameState.players.find(p => p.color === gameState.winner)?.victoryPoints ?? 10} points
            </p>
            <button style={styles.winBtn} onClick={onExit}>Play Again</button>
          </div>
        </div>
      )}
      <div style={styles.topBar}>
        <div style={styles.turnInfo}>
          <div style={{ ...styles.turnDot, backgroundColor: player.color }} />
          <span style={styles.turnName}>
            {player.name}{player.isAI ? ' 🤖' : ''}
            {isMyTurn ? <span style={styles.youTag}> (You)</span> : ''}
          </span>
          <span style={styles.phaseTag}>{gameState.setupPhase ? 'Setup' : gameState.phase}</span>
        </div>
        <div style={styles.topActions}>
          {gameState.dice && (
            <span style={styles.diceResult}>🎲 {gameState.dice[0]}+{gameState.dice[1]}</span>
          )}
          <button
            style={{ ...styles.leaveBtn, background: muted ? '#555' : '#333' }}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) unlockAudio();
            }}
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            type="button"
          >{muted ? '🔇' : '🔊'}</button>
          <button
            style={{ ...styles.leaveBtn, background: debug ? '#2e7d32' : '#333' }}
            onClick={() => setDebug(d => !d)}
            title="Toggle debug board overlay"
            type="button"
          >🔍</button>
          {onExit && (
            <button style={styles.leaveBtn} onClick={onExit} type="button">✕</button>
          )}
        </div>
      </div>

      <TurnCoach
        text={getTurnCoach(gameState, me, {
          robberMode,
          pendingSteal: !!(pendingSteal && stealTargets.length > 0),
          selectedAction,
        })}
        highlight={isMyTurn && !gameState.winner}
      />

      <div className="board-stage" style={styles.boardArea}>
        <Board
          gameState={gameState}
          hexSize={HEX_SIZE}
          onHexClick={handleHexClick}
          onIntersectionClick={handleIntersectionClick}
          onEdgeClick={handleEdgeClick}
          robberMode={robberMode}
          selectedAction={selectedAction}
          debug={debug}
        />
        <DiceFlash
          total={diceFlash?.total ?? null}
          faces={diceFlash?.faces ?? null}
          onDone={() => setDiceFlash(null)}
        />
        <div className="hand-bar-float">
          <HandBar player={me} />
        </div>
      </div>

      {gameState.setupPhase && isMyTurn && (
        <div style={styles.setupHintBar}>
          {gameState.phase === 'setup_settlement'
            ? (gameState.setupRound >= gameState.players.length * 2
                ? '👆 Second settlement — collect adjacent resources'
                : '👆 First settlement — no resources yet')
            : '👆 Tap an edge for a road'}
        </div>
      )}

      {/* Discard modal after a 7 */}
      {gameState.phase === 'discard' && me && gameState.discardQueue.includes(me.color) && (
        <DiscardModal
          player={me}
          mustDiscard={Math.floor(
            (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
              .reduce((s, r) => s + (me.resources[r] || 0), 0) / 2
          )}
          onDiscard={handleDiscard}
        />
      )}

      {/* Steal target picker after moving the robber */}
      {pendingSteal && stealTargets.length > 0 && (
        <div style={styles.stealOverlay}>
          <div style={styles.stealCard}>
            <div style={styles.stealTitle}>🦹 Choose who to steal from</div>
            {stealTargets.map(color => {
              const p = getPlayerByColor(gameState, color);
              return (
                <button
                  key={color}
                  style={{ ...styles.stealBtn, borderColor: color }}
                  onClick={() => handleSteal(color)}
                >
                  <span style={{ ...styles.stealDot, backgroundColor: color }} />
                  {p?.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Incoming domestic trade offers (from AI) */}
      {me && (
        <TradeOffers
          gameState={gameState}
          myColor={me.color}
          onAccept={(from) => {
            const offer = gameState.tradeOffers.find(o => o.to === me.color && o.from === from);
            if (offer) {
              const err = executeTrade(gameState, offer.from, offer.to, offer.give, offer.want);
              if (err === null) {
                gameState.tradeOffers = gameState.tradeOffers.filter(o => o !== offer);
                addLog(`Trade accepted with ${getPlayerByColor(gameState, from)?.name}`);
              }
            }
            setGameState({ ...gameState });
          }}
          onReject={(from) => {
            gameState.tradeOffers = gameState.tradeOffers.filter(o => !(o.to === me.color && o.from === from));
            addLog(`Trade rejected with ${getPlayerByColor(gameState, from)?.name}`);
            setGameState({ ...gameState });
          }}
          onCounter={(from, give, want) => {
            const offer = gameState.tradeOffers.find(o => o.to === me.color && o.from === from);
            if (offer) {
              gameState.tradeOffers = gameState.tradeOffers.filter(o => o !== offer);
              gameState.tradeOffers.push({ from: me.color, to: from, give, want });
              addLog(`Counter-offer sent to ${getPlayerByColor(gameState, from)?.name}`);
            }
            setGameState({ ...gameState });
          }}
        />
      )}

      <div className="bottom-chrome">
        {showPanel && (
          <div className="bottom-sheet">
            <div className="bottom-sheet-handle" aria-hidden />
            <div className="bottom-sheet-body">
              {showPanel === 'actions' && (
                <>
                  {!gameState.setupPhase && (
                    <>
                      <DiceRoller
                        onRoll={handleRollDice}
                        rolling={diceRolling}
                        disabled={gameState.phase !== 'roll' || !isMyTurn}
                        result={gameState.dice}
                      />
                      <BuildMenu
                        player={player}
                        phase={gameState.phase}
                        isMyTurn={isMyTurn}
                        selectedAction={selectedAction}
                        onSelectAction={setSelectedAction}
                        onBuyDevCard={handleBuyDevCard}
                        onPlayKnight={handlePlayKnight}
                        onEndTurn={handleEndTurn}
                        hasKnight={me.devCards.some(c => c.type === 'knight' && !c.played && !c.boughtThisTurn)}
                        pendingFreeRoads={isMyTurn ? gameState.pendingDevRoads : 0}
                      />
                      <TradePanel
                        gameState={gameState}
                        isMyTurn={isMyTurn}
                        phase={gameState.phase}
                        onBankTrade={(give, want) => {
                          const gRes = Object.keys(give)[0] as ResourceType | undefined;
                          const wRes = Object.keys(want)[0] as ResourceType | undefined;
                          if (!gRes || !wRes) return;
                          const err = executeBankTrade(gameState, gRes, give[gRes] || 0, wRes);
                          if (err === null) {
                            addLog(`${player.name} bank-traded ${give[gRes]} ${gRes} → ${want[wRes]} ${wRes}`);
                            setGameState({ ...gameState });
                          }
                        }}
                        onProposeTrade={(to, give, want) => {
                          gameState.tradeOffers.push({ from: player.color, to, give, want });
                          addLog(`${player.name} offered a trade to ${getPlayerByColor(gameState, to)?.name}`);
                          setGameState({ ...gameState });
                        }}
                      />
                      <DevCardPanel
                        player={me}
                        phase={gameState.phase}
                        isMyTurn={isMyTurn}
                        onPlayKnight={handlePlayKnight}
                        onPlayRoadBuilding={handlePlayRoadBuilding}
                        onPlayYearOfPlenty={handlePlayYearOfPlenty}
                        onPlayMonopoly={handlePlayMonopoly}
                      />
                      {gameState.phase === 'trade' && isMyTurn && (
                        <button style={styles.doneTradingBtn} onClick={handleSkipTrade}>
                          ✅ Done Trading
                        </button>
                      )}
                    </>
                  )}
                  {gameState.setupPhase && (
                    <div style={styles.setupMsg}>
                      {isMyTurn ? 'Place your pieces on the board' : 'AI is placing…'}
                    </div>
                  )}
                </>
              )}
              {showPanel === 'hand' && (
                <>
                  <PlayerHand player={me} isMe />
                  {gameState.players.filter(p => p.color !== me.color).map(p => (
                    <PlayerHand
                      key={p.color}
                      player={{
                        ...p,
                        _hidden: true,
                        _resourceCount: (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
                          .reduce((s, r) => s + (p.resources[r] || 0), 0),
                        _devCardCount: countHeldDevCards(p),
                      }}
                      isMe={false}
                    />
                  ))}
                </>
              )}
              {showPanel === 'log' && <GameLog log={log} />}
            </div>
          </div>
        )}

        <div style={styles.tabBar}>
          <button
            type="button"
            style={{ ...styles.tab, ...(showPanel === 'actions' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'actions' ? null : 'actions')}
          >
            🎮 Actions
          </button>
          <button
            type="button"
            style={{ ...styles.tab, ...(showPanel === 'hand' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'hand' ? null : 'hand')}
          >
            🃏 Hand
          </button>
          <button
            type="button"
            style={{ ...styles.tab, ...(showPanel === 'log' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'log' ? null : 'log')}
          >
            📜 Log
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ onStart, onBack, defaultName = 'You' }: { onStart: (config: GameConfig) => void; onBack?: () => void; defaultName?: string }) {
  const [numPlayers, setNumPlayers] = useState(4);
  const [names, setNames] = useState([defaultName, '', '', '']);
  const [aiPlayers, setAiPlayers] = useState<number[]>([1, 2, 3]);
  const [victoryPointsToWin, setVictoryPointsToWin] = useState<10 | 12>(10);
  const [friendlyRobber, setFriendlyRobber] = useState(true);
  const [boardMode, setBoardMode] = useState<'random' | 'balanced'>('balanced');

  return (
    <div style={styles.setupScreen}>
      <h1 style={styles.title}>🏝️ CATAN</h1>
      <p style={styles.subtitle}>Customize game · Catan Universe style</p>

      <div style={styles.setupCard}>
        <label style={styles.label}>Number of Players</label>
        <div style={styles.playerCountRow}>
          {[2, 3, 4].map(n => (
            <button
              key={n}
              type="button"
              style={{ ...styles.countBtn, ...(numPlayers === n ? styles.countBtnActive : {}) }}
              onClick={() => {
                setNumPlayers(n);
                setAiPlayers(Array.from({ length: n - 1 }, (_, i) => i + 1));
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {Array.from({ length: numPlayers }).map((_, i) => (
          <div key={i} style={styles.playerRow}>
            <div style={{ ...styles.colorDot, backgroundColor: ['red', 'blue', 'white', 'orange'][i] }} />
            <input
              style={styles.nameInput}
              placeholder={i === 0 ? 'You' : `Player ${i + 1}`}
              value={names[i]}
              onChange={e => {
                const n = [...names];
                n[i] = e.target.value;
                setNames(n);
              }}
            />
            {i > 0 && (
              <label style={styles.aiCheckbox}>
                <input
                  type="checkbox"
                  checked={aiPlayers.includes(i)}
                  onChange={e => {
                    if (e.target.checked) setAiPlayers([...aiPlayers, i]);
                    else setAiPlayers(aiPlayers.filter(a => a !== i));
                  }}
                />
                AI
              </label>
            )}
          </div>
        ))}

        <div style={styles.divider} />
        <label style={styles.label}>Victory points to win</label>
        <div style={styles.playerCountRow}>
          {([10, 12] as const).map(n => (
            <button
              key={n}
              type="button"
              style={{ ...styles.countBtn, ...(victoryPointsToWin === n ? styles.countBtnActive : {}) }}
              onClick={() => setVictoryPointsToWin(n)}
            >
              {n} VP
            </button>
          ))}
        </div>

        <label style={styles.label}>Board</label>
        <div style={styles.playerCountRow}>
          {([
            { id: 'balanced' as const, label: 'Balanced' },
            { id: 'random' as const, label: 'Random' },
          ]).map(opt => (
            <button
              key={opt.id}
              type="button"
              style={{ ...styles.countBtn, ...(boardMode === opt.id ? styles.countBtnActive : {}) }}
              onClick={() => setBoardMode(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            checked={friendlyRobber}
            onChange={e => setFriendlyRobber(e.target.checked)}
          />
          <span>
            <strong>Friendly Robber</strong>
            <span style={styles.toggleHint}> — can’t steal from players with 2 VP or less</span>
          </span>
        </label>

        <p style={styles.rulesNote}>
          Setup: resources only from your <strong>second</strong> settlement (official Catan).
        </p>

        <button
          type="button"
          style={styles.startBtn}
          onClick={() => onStart({
            numPlayers,
            playerNames: names.slice(0, numPlayers).map((n, i) => n || (i === 0 ? defaultName : `AI ${i + 1}`)),
            aiPlayers,
            victoryPointsToWin,
            friendlyRobber,
            boardMode,
          })}
        >
          Start Game
        </button>
        {onBack && (
          <button type="button" style={styles.backBtn} onClick={onBack}>Back</button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  mobileContainer: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
  },
  winOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.7)',
    zIndex: 100,
  },
  winCard: {
    background: '#16213e',
    borderRadius: 16,
    padding: '32px 28px',
    textAlign: 'center',
    width: '85%',
    maxWidth: 320,
  },
  winEmoji: {
    fontSize: 56,
    marginBottom: 8,
  },
  winTitle: {
    fontSize: 26,
    color: '#ffd700',
    margin: '0 0 8px',
  },
  winSub: {
    fontSize: 14,
    color: '#8890a0',
    margin: '0 0 20px',
  },
  winBtn: {
    padding: '14px 24px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    paddingTop: 'max(8px, env(safe-area-inset-top, 0px))',
    background: '#0f3460',
    flexShrink: 0,
  },
  turnInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  turnDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  turnName: { fontSize: 14, fontWeight: 'bold' },
  youTag: { fontSize: 12, color: '#2ecc71' },
  phaseTag: {
    fontSize: 11, color: '#8890a0', textTransform: 'uppercase',
    background: '#1a1a2e', padding: '2px 6px', borderRadius: 4,
  },
  topActions: { display: 'flex', alignItems: 'center', gap: 8 },
  diceResult: { fontSize: 14, fontWeight: 'bold', color: '#ffd700' },
  leaveBtn: {
    padding: '4px 10px', border: '1px solid #e74c3c', borderRadius: 6,
    background: 'transparent', color: '#e74c3c', cursor: 'pointer', fontSize: 16, fontWeight: 'bold',
  },
  boardArea: {
    // sizing comes from .board-stage; keep empty inline overrides minimal
  },
  setupHintBar: {
    textAlign: 'center', color: '#ffd700', fontSize: 13, fontWeight: 'bold',
    padding: '8px 12px', background: 'rgba(0,0,0,0.55)',
  },
  stealOverlay: {
    position: 'fixed', inset: 0, zIndex: 50,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
  },
  stealCard: {
    background: '#16213e', borderRadius: 12, padding: 20, width: '100%', maxWidth: 320,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  stealTitle: { color: '#ffd700', fontSize: 15, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  stealBtn: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
    border: '2px solid', borderRadius: 8, background: '#1a1a2e', color: '#e0e0e0',
    fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
  },
  stealDot: { width: 14, height: 14, borderRadius: '50%', flexShrink: 0 },
  tabBar: {
    display: 'flex', background: '#0f3460', borderTop: '1px solid #1a1a2e', flexShrink: 0,
  },
  tab: {
    flex: 1, padding: '10px 4px', border: 'none', background: 'transparent',
    color: '#8890a0', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  tabActive: { color: '#ffd700', borderBottom: '2px solid #ffd700' },
  setupMsg: { textAlign: 'center', color: '#8890a0', fontSize: 14, padding: 16 },
  divider: { height: 1, background: '#0f3460', margin: '4px 0' },
  toggleRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#e0e0e0',
    cursor: 'pointer', lineHeight: 1.35,
  },
  toggleHint: { color: '#8890a0', fontWeight: 'normal' as const },
  rulesNote: {
    fontSize: 12, color: '#a0a8b8', lineHeight: 1.4, margin: 0,
    padding: '8px 10px', background: 'rgba(255,215,0,0.06)', borderRadius: 8,
    border: '1px solid rgba(255,215,0,0.15)',
  },
  setupScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100dvh', background: '#1a1a2e', color: '#e0e0e0', padding: 20,
  },
  title: {
    fontSize: 40, color: '#ffd700', margin: 0, textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  subtitle: { fontSize: 15, color: '#8890a0', marginBottom: 24 },
  setupCard: {
    background: '#16213e', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400,
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  label: { fontSize: 13, color: '#8890a0', textTransform: 'uppercase', letterSpacing: 1 },
  playerCountRow: { display: 'flex', gap: 8 },
  countBtn: {
    flex: 1, padding: 12, border: '2px solid #0f3460', borderRadius: 8,
    background: '#1a1a2e', color: '#e0e0e0', fontSize: 18, fontWeight: 'bold', cursor: 'pointer',
  },
  countBtnActive: { borderColor: '#ffd700', background: '#0f3460' },
  playerRow: { display: 'flex', alignItems: 'center', gap: 8 },
  colorDot: { width: 14, height: 14, borderRadius: '50%', flexShrink: 0 },
  nameInput: {
    flex: 1, padding: '8px 12px', border: '1px solid #0f3460', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', fontSize: 14,
  },
  aiCheckbox: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#8890a0' },
  startBtn: {
    padding: '14px 24px', border: 'none', borderRadius: 8,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white', fontSize: 17, fontWeight: 'bold', cursor: 'pointer',
  },
  backBtn: {
    padding: '10px', border: '1px solid #0f3460', borderRadius: 8,
    background: 'transparent', color: '#8890a0', cursor: 'pointer',
  },
  turnOrderScreen: {
    position: 'absolute', inset: 0, zIndex: 50, display: 'flex',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: '#1a1a2e', color: '#e0e0e0', padding: 24, gap: 16,
  },
  turnOrderTitle: { fontSize: 28, color: '#ffd700', margin: 0 },
  turnOrderSub: { fontSize: 15, color: '#8890a0', textAlign: 'center', margin: 0 },
  turnOrderList: {
    display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320,
  },
  turnOrderItem: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    background: '#16213e', borderRadius: 10, border: '1px solid #0f3460',
  },
  turnOrderRank: {
    width: 26, height: 26, borderRadius: '50%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontWeight: 800,
    background: '#ffd700', color: '#1a1a2e', fontSize: 14, flexShrink: 0,
  },
  turnOrderDot: { width: 14, height: 14, borderRadius: '50%', flexShrink: 0 },
  turnOrderName: { flex: 1, fontSize: 16, fontWeight: 600 },
  turnOrderRoll: { fontSize: 18, fontWeight: 800, color: '#ffd700' },
  turnOrderBtn: {
    padding: '16px 32px', border: 'none', borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white', fontSize: 17, fontWeight: 'bold', cursor: 'pointer',
  },
  turnOrderHint: { fontSize: 13, color: '#8890a0', margin: 0 },
  doneTradingBtn: {
    padding: '12px 16px', border: 'none', borderRadius: 8,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  },
};
