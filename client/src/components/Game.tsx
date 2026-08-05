import { useState, useCallback } from 'react';
import type { GameState, GameConfig, PlayerColor, ResourceType } from '../game/types';
import { createInitialState, getCurrentPlayer, rollDice, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight } from '../game/rules';
import { getHexCorners } from '../game/board';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import TradePanel from './TradePanel';
import BuildMenu from './BuildMenu';
import GameLog from './GameLog';

const HEX_SIZE = 55;

export default function Game() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [_config, _setConfig] = useState<GameConfig | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showSetup, setShowSetup] = useState(true);
  const [diceRolling, setDiceRolling] = useState(false);
  const [robberMode, setRobberMode] = useState(false);
  const [stealTargets, setStealTargets] = useState<PlayerColor[]>([]);

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
  }, [addLog, _setConfig]);

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
      addLog(`${getCurrentPlayer(gameState).name} rolled ${d1} + ${d2} = ${total}`);
      
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

  if (showSetup) {
    return <SetupScreen onStart={startGame} />;
  }

  if (!gameState) return null;

  const player = getCurrentPlayer(gameState);
  const isMyTurn = !player.isAI;

  return (
    <div style={styles.container}>
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
      </div>
      <div style={styles.sidebar}>
        <div style={styles.turnInfo}>
          <div style={{ ...styles.turnBadge, borderColor: player.color }}>
            {player.name}'s Turn
            {player.isAI && <span> 🤖</span>}
          </div>
          <div style={styles.phaseLabel}>
            Phase: {gameState.phase.replace('_', ' ')}
          </div>
          {gameState.setupPhase && (
            <div style={styles.setupHint}>
              {gameState.phase === 'setup_settlement' ? 'Click a hex corner to place a settlement' : 'Click an edge to place a road'}
            </div>
          )}
        </div>

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
              hasKnight={player.devCards.some(c => c.type === 'knight' && !c.played)}
            />

            <TradePanel
              gameState={gameState}
              isMyTurn={isMyTurn}
              onTrade={() => {
                addLog(`Trade offer from ${player.name}`);
                setGameState({ ...gameState });
              }}
            />
          </>
        )}

        <PlayerHand player={player} />

        <GameLog log={log} />
      </div>
    </div>
  );
}

function SetupScreen({ onStart }: { onStart: (config: GameConfig) => void }) {
  const [numPlayers, setNumPlayers] = useState(3);
  const [names, setNames] = useState(['', '', '', '']);
  const [aiPlayers, setAiPlayers] = useState<number[]>([]);

  return (
    <div style={styles.setupScreen}>
      <h1 style={styles.title}>🏝️ CATAN</h1>
      <p style={styles.subtitle}>Settle the island with your family!</p>
      
      <div style={styles.setupCard}>
        <label style={styles.label}>Number of Players</label>
        <div style={styles.playerCountRow}>
          {[2, 3, 4].map(n => (
            <button
              key={n}
              style={{ ...styles.countBtn, ...(numPlayers === n ? styles.countBtnActive : {}) }}
              onClick={() => setNumPlayers(n)}
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
              placeholder={`Player ${i + 1}`}
              value={names[i]}
              onChange={e => {
                const n = [...names];
                n[i] = e.target.value;
                setNames(n);
              }}
            />
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
          </div>
        ))}

        <button
          style={styles.startBtn}
          onClick={() => onStart({
            numPlayers,
            playerNames: names.slice(0, numPlayers).map((n, i) => n || `Player ${i + 1}`),
            aiPlayers,
          })}
        >
          Start Game
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
  },
  boardArea: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    overflow: 'auto',
  },
  sidebar: {
    width: 320,
    background: '#16213e',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    borderLeft: '1px solid #0f3460',
  },
  turnInfo: {
    textAlign: 'center',
    padding: 12,
    background: '#0f3460',
    borderRadius: 8,
  },
  turnBadge: {
    fontSize: 18,
    fontWeight: 'bold',
    padding: '4px 12px',
    border: '2px solid',
    borderRadius: 6,
    display: 'inline-block',
  },
  phaseLabel: {
    fontSize: 13,
    color: '#8890a0',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  setupHint: {
    fontSize: 13,
    color: '#ffd700',
    marginTop: 8,
    fontStyle: 'italic',
  },
  setupScreen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    padding: 20,
  },
  title: {
    fontSize: 48,
    color: '#ffd700',
    margin: 0,
    textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  subtitle: {
    fontSize: 16,
    color: '#8890a0',
    marginBottom: 30,
  },
  setupCard: {
    background: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  label: {
    fontSize: 14,
    color: '#8890a0',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  playerCountRow: {
    display: 'flex',
    gap: 8,
  },
  countBtn: {
    flex: 1,
    padding: 12,
    border: '2px solid #0f3460',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 20,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  countBtnActive: {
    borderColor: '#ffd700',
    background: '#0f3460',
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    flexShrink: 0,
  },
  nameInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 14,
  },
  aiCheckbox: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    color: '#8890a0',
    cursor: 'pointer',
  },
  startBtn: {
    padding: '14px 24px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 8,
  },
};
