import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState, GameConfig, PlayerColor, ResourceType } from '../game/types';
import { createInitialState, getCurrentPlayer, rollDice, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight } from '../game/rules';
import { getHexCorners } from '../game/board';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import DiceFlash from './DiceFlash';
import HandBar from './HandBar';
import TradePanel from './TradePanel';
import BuildMenu from './BuildMenu';
import GameLog from './GameLog';
import { recordGame } from '../stats';

const HEX_SIZE = 58;

interface GameProps {
  quickStart?: boolean;
  playerName?: string;
  onExit?: () => void;
}

export default function Game({ quickStart = false, playerName = 'You', onExit }: GameProps) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [_config, _setConfig] = useState<GameConfig | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showSetup, setShowSetup] = useState(!quickStart);
  const [diceRolling, setDiceRolling] = useState(false);
  const [robberMode, setRobberMode] = useState(false);
  const [stealTargets, setStealTargets] = useState<PlayerColor[]>([]);
  const [showPanel, setShowPanel] = useState<'actions' | 'hand' | 'log' | null>('actions');
  const [diceFlash, setDiceFlash] = useState<{ total: number; faces: [number, number] } | null>(null);
  const startedRef = useRef(false);
  const statsRecordedRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const startGame = useCallback((c: GameConfig) => {
    const state = createInitialState(c);
    _setConfig(c);
    setGameState(state);
    setShowSetup(false);
    addLog(`Game started! ${c.playerNames.join(' vs ')}`);
    addLog('Setup phase: place your first settlement');
  }, [addLog]);

  // One-tap vs AI
  useEffect(() => {
    if (!quickStart || startedRef.current) return;
    startedRef.current = true;
    startGame({
      numPlayers: 4,
      playerNames: [playerName, 'AI Blue', 'AI White', 'AI Orange'],
      aiPlayers: [1, 2, 3],
    });
  }, [quickStart, playerName, startGame]);

  // Auto-run AI turns when it's an AI player's turn
  useEffect(() => {
    if (!gameState) return;
    const current = getCurrentPlayer(gameState);
    if (!current.isAI) return;

    const t = setTimeout(() => {
      const action = aiTurn(gameState);
      if (!action) {
        setGameState({ ...gameState });
        return;
      }
      switch (action.action) {
        case 'roll_dice': {
          const [d1, d2] = rollDice(gameState);
          addLog(`${current.name} rolled ${d1 + d2}`);
          break;
        }
        case 'skip_trade':
          gameState.phase = 'build';
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
        setRobberMode(false);
        if (stealTargets.length > 0) {
          const target = stealTargets[0];
          moveRobber(gameState, q, r, target);
          addLog(`Robber moved, stole from ${target}`);
        } else {
          addLog('Robber moved');
        }
        setGameState({ ...gameState });
      }
      return;
    }
  }, [gameState, robberMode, stealTargets, addLog]);

  const handleIntersectionClick = useCallback((key: string) => {
    if (!gameState) return;
    const player = getCurrentPlayer(gameState);

    if (gameState.setupPhase) {
      if (gameState.phase === 'setup_settlement') {
        const err = placeSetupSettlement(gameState, key);
        if (err === null) {
          addLog(`${player.name} placed a settlement`);
          setGameState({ ...gameState });
          advanceSetup(gameState);
          setGameState({ ...gameState });
        }
      }
      return;
    }

    if (gameState.phase === 'build') {
      if (selectedAction === 'settlement') {
        const err = placeSettlement(gameState, key);
        if (err === null) {
          addLog(`${player.name} built a settlement`);
          setSelectedAction(null);
          setGameState({ ...gameState });
        }
      } else if (selectedAction === 'city') {
        const err = placeCity(gameState, key);
        if (err === null) {
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
          addLog(`${player.name} placed a road`);
          setGameState({ ...gameState });
          advanceSetup(gameState);
          setGameState({ ...gameState });
        }
      }
      return;
    }

    if (gameState.phase === 'build' && selectedAction === 'road') {
      const err = placeRoad(gameState, key);
      if (err === null) {
        addLog(`${player.name} built a road`);
        setSelectedAction(null);
        setGameState({ ...gameState });
      }
    }
  }, [gameState, selectedAction, addLog]);

  const handleRollDice = useCallback(() => {
    if (!gameState) return;
    setDiceRolling(true);
    setTimeout(() => {
      const [d1, d2] = rollDice(gameState);
      const total = d1 + d2;
      setDiceFlash({ total, faces: [d1, d2] });
      addLog(`${getCurrentPlayer(gameState).name} rolled ${d1} + ${d2} = ${total}`);
      
      // Advance the human from 'trade' to 'build' phase. The AI does this
      // internally (skip_trade), but a human has no other way to reach the
      // build phase where pieces are placed — without this they'd be stuck
      // in 'trade' and unable to build anything.
      if (!getCurrentPlayer(gameState).isAI) {
        gameState.phase = 'build';
      }
      
      if (total === 7) {
        addLog('7 rolled! Robber time!');
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
    return <SetupScreen onStart={startGame} onBack={onExit} />;
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
          {onExit && (
            <button style={styles.leaveBtn} onClick={onExit} type="button">✕</button>
          )}
        </div>
      </div>

      <div style={styles.boardArea}>
        <Board
          gameState={gameState}
          hexSize={HEX_SIZE}
          onHexClick={handleHexClick}
          onIntersectionClick={handleIntersectionClick}
          onEdgeClick={handleEdgeClick}
          robberMode={robberMode}
          selectedAction={selectedAction}
        />
        <DiceFlash
          total={diceFlash?.total ?? null}
          faces={diceFlash?.faces ?? null}
          onDone={() => setDiceFlash(null)}
        />
      </div>

      {gameState.setupPhase && isMyTurn && (
        <div style={styles.setupHintBar}>
          {gameState.phase === 'setup_settlement'
            ? '👆 Tap a corner for a settlement'
            : '👆 Tap an edge for a road'}
        </div>
      )}

      <HandBar player={me} />

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

      {showPanel && (
        <div style={styles.panel}>
          <div style={styles.panelContent}>
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
                      hasKnight={me.devCards.some(c => c.type === 'knight' && !c.played)}
                    />
                    <TradePanel
                      gameState={gameState}
                      isMyTurn={isMyTurn}
                      onTrade={(offer) => {
                        // Local (vs-AI) bank trade: apply to the live gameState
                        // and force a re-render so the hand shows fresh counts.
                        if (offer.target === 'bank') {
                          const gRes = Object.entries(offer.give)[0];
                          const wRes = Object.entries(offer.want)[0];
                          if (gRes && wRes && (player.resources[gRes[0] as ResourceType] || 0) >= (gRes[1] || 0)) {
                            player.resources[gRes[0] as ResourceType] -= gRes[1] || 0;
                            player.resources[wRes[0] as ResourceType] = (player.resources[wRes[0] as ResourceType] || 0) + (wRes[1] || 0);
                            addLog(`${player.name} traded 4 ${gRes[0]} → ${wRes[1]} ${wRes[0]}`);
                          }
                        }
                        setGameState({ ...gameState });
                      }}
                    />
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
                      _devCardCount: p.devCards.filter(c => !c.played).length,
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
    </div>
  );
}

function SetupScreen({ onStart, onBack }: { onStart: (config: GameConfig) => void; onBack?: () => void }) {
  const [numPlayers, setNumPlayers] = useState(4);
  const [names, setNames] = useState(['', '', '', '']);
  const [aiPlayers, setAiPlayers] = useState<number[]>([1, 2, 3]);

  return (
    <div style={styles.setupScreen}>
      <h1 style={styles.title}>🏝️ CATAN</h1>
      <p style={styles.subtitle}>Local game setup</p>

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

        <button
          type="button"
          style={styles.startBtn}
          onClick={() => onStart({
            numPlayers,
            playerNames: names.slice(0, numPlayers).map((n, i) => n || (i === 0 ? 'You' : `AI ${i + 1}`)),
            aiPlayers,
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
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  setupHintBar: {
    textAlign: 'center', color: '#ffd700', fontSize: 13, fontWeight: 'bold',
    padding: '8px 12px', background: 'rgba(0,0,0,0.55)',
  },
  tabBar: {
    display: 'flex', background: '#0f3460', borderTop: '1px solid #1a1a2e', flexShrink: 0,
  },
  tab: {
    flex: 1, padding: '10px 4px', border: 'none', background: 'transparent',
    color: '#8890a0', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  tabActive: { color: '#ffd700', borderBottom: '2px solid #ffd700' },
  panel: {
    maxHeight: '42vh', overflow: 'hidden', background: '#16213e',
    borderTop: '1px solid #0f3460', flexShrink: 0,
    display: 'flex', flexDirection: 'column',
  },
  panelContent: {
    padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
    flex: 1, minHeight: 0,
  },
  setupMsg: { textAlign: 'center', color: '#8890a0', fontSize: 14, padding: 16 },
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
};
