import { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';
import { getCurrentPlayer } from '../game/rules';
import type { ResourceType, PlayerColor } from '../game/types';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import DiceFlash from './DiceFlash';
import HandBar from './HandBar';
import ScoreBar from './ScoreBar';
import TradePanel from './TradePanel';
import BuildMenu from './BuildMenu';
import DiscardModal from './DiscardModal';
import DevCardPanel from './DevCardPanel';
import TradeOffers from './TradeOffers';
import TurnCoach from './TurnCoach';
import { unlockAudio, sfx, isMuted, setMuted } from '../audio';
import { getTurnCoach } from '../turnCoach';

const HEX_SIZE = 68;

export default function OnlineGame() {
  const { gameState, playerId, room, sendAction, sendChat, chatMessages, leaveRoom, lastActionResult } = useSocket();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [robberMode, setRobberMode] = useState(false);
  const [stealTargets, setStealTargets] = useState<PlayerColor[]>([]);
  const [pendingSteal, setPendingSteal] = useState<{ q: number; r: number } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showPanel, setShowPanel] = useState<'actions' | 'hand' | 'chat' | null>(null);
  const [diceFlash, setDiceFlash] = useState<{ total: number; faces: [number, number] } | null>(null);
  const [debug, setDebug] = useState(() => new URLSearchParams(window.location.search).get('debug') === '1');
  const [muted, setMutedState] = useState(() => isMuted());
  const lastTurnColorRef = useRef<string | null>(null);
  const lastDiceKeyRef = useRef<string>('');

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Flash the rolled number whenever the server syncs a new dice result.
  useEffect(() => {
    if (gameState?.dice) {
      const key = `${gameState.dice[0]}-${gameState.dice[1]}-${gameState.currentTurn}-${gameState.round}`;
      if (key !== lastDiceKeyRef.current) {
        lastDiceKeyRef.current = key;
        sfx.dice();
        if (gameState.dice[0] + gameState.dice[1] === 7) sfx.robber();
      }
      setDiceFlash({ total: gameState.dice[0] + gameState.dice[1], faces: [gameState.dice[0], gameState.dice[1]] });
    }
  }, [gameState?.dice?.[0], gameState?.dice?.[1], gameState?.currentTurn, gameState?.round]);

  useEffect(() => {
    if (!gameState) return;
    const cur = getCurrentPlayer(gameState);
    const prev = lastTurnColorRef.current;
    lastTurnColorRef.current = cur.color;
    const myColor = room?.players.find(rp => rp.playerId === playerId)?.color;
    if (prev && prev !== cur.color && myColor && cur.color === myColor) sfx.yourTurn();
  }, [gameState?.currentTurn, gameState?.phase, room, playerId]);

  useEffect(() => {
    if (gameState?.winner) sfx.win();
  }, [gameState?.winner]);

  // When the server confirms a robber move, surface the steal-target picker.
  useEffect(() => {
    if (lastActionResult?.action === 'move_robber' && lastActionResult.result?.stealTargets?.length) {
      sfx.robber();
      setStealTargets(lastActionResult.result.stealTargets);
      setPendingSteal({ q: 0, r: 0 }); // robber already moved; steal uses current robberHex
    }
    if (lastActionResult?.action === 'steal') sfx.steal();
    if (lastActionResult?.action === 'discard') sfx.discard();
    if (lastActionResult?.action === 'place_settlement' || lastActionResult?.action === 'place_city') sfx.build();
    if (lastActionResult?.action === 'place_road') sfx.road();
  }, [lastActionResult]);

  const handleHexClick = useCallback((q: number, r: number) => {
    if (!robberMode) return;
    sendAction('move_robber', { q, r });
    setRobberMode(false);
  }, [robberMode, sendAction]);

  const handleSteal = useCallback((target: PlayerColor) => {
    if (!gameState) return;
    const [rq, rr] = gameState.robberHex.split(',').map(Number);
    sendAction('steal', { q: rq, r: rr, target });
    setPendingSteal(null);
    setStealTargets([]);
  }, [gameState, sendAction]);

  const handleIntersectionClick = useCallback((key: string) => {
    if (selectedAction === 'settlement') {
      sendAction('place_settlement', { key });
      setSelectedAction(null);
    } else if (selectedAction === 'city') {
      sendAction('place_city', { key });
      setSelectedAction(null);
    }
  }, [selectedAction, sendAction]);

  const handleEdgeClick = useCallback((key: string) => {
    const freeRoads = gameState?.pendingDevAction === 'road_building' && (gameState?.pendingDevRoads || 0) > 0;
    if (freeRoads || selectedAction === 'road') {
      sendAction('place_road', { key });
      if (!freeRoads) setSelectedAction(null);
    }
  }, [selectedAction, sendAction, gameState]);

  const handleRollDice = useCallback(() => {
    sendAction('roll_dice');
  }, [sendAction]);

  const handleEndTurn = useCallback(() => {
    sendAction('end_turn');
    setSelectedAction(null);
  }, [sendAction]);

  const handleSkipTrade = useCallback(() => {
    sendAction('skip_trade');
    setSelectedAction(null);
  }, [sendAction]);

  const handleBuyDevCard = useCallback(() => {
    sendAction('buy_dev_card');
  }, [sendAction]);

  const handlePlayKnight = useCallback(() => {
    sendAction('play_knight');
    setRobberMode(true);
  }, [sendAction]);

  const handleBankTrade = useCallback((give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => {
    sendAction('bank_trade', { give, want });
  }, [sendAction]);

  const handleProposeTrade = useCallback((give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => {
    sendAction('propose_trade', { give, want });
  }, [sendAction]);

  const handleCompleteTrade = useCallback((partner: PlayerColor) => {
    sendAction('complete_trade', { partner });
  }, [sendAction]);

  const handleCancelOffer = useCallback(() => {
    sendAction('cancel_trade');
  }, [sendAction]);

  const handleDiscard = useCallback((discard: Partial<Record<ResourceType, number>>) => {
    sendAction('discard', { discard });
  }, [sendAction]);

  const handlePlayRoadBuilding = useCallback(() => {
    sendAction('play_road_building');
  }, [sendAction]);

  const handlePlayYearOfPlenty = useCallback((r1: ResourceType, r2: ResourceType) => {
    sendAction('play_year_of_plenty', { res1: r1, res2: r2 });
  }, [sendAction]);

  const handlePlayMonopoly = useCallback((r: ResourceType) => {
    sendAction('play_monopoly', { resource: r });
  }, [sendAction]);

  const handleAcceptTrade = useCallback((from: PlayerColor) => {
    sendAction('accept_trade', { from });
  }, [sendAction]);

  const handleRejectTrade = useCallback((from: PlayerColor) => {
    sendAction('reject_trade', { from });
  }, [sendAction]);

  const handleCounterTrade = useCallback((from: PlayerColor, give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => {
    sendAction('counter_trade', { from, give, want });
  }, [sendAction]);

  const handleSendChat = useCallback(() => {
    if (chatInput.trim()) {
      sendChat(chatInput.trim());
      setChatInput('');
    }
  }, [chatInput, sendChat]);

  if (!gameState || !room) return null;

  const myPlayer = gameState.players.find(p => {
    const conn = room.players.find(rp => rp.playerId === playerId);
    return conn && p.color === conn.color;
  });
  const player = getCurrentPlayer(gameState);
  const isMyTurn = myPlayer?.color === player.color;
  return (
    <div style={styles.container}>
      {/* Top score bar — Catan Universe style */}
      <div style={styles.topBar}>
        <ScoreBar
          gameState={gameState}
          myColor={myPlayer?.color}
          currentColor={player.color}
          dice={gameState.dice}
          rightActions={(
            <>
              <button
                className={`score-icon-btn ${muted ? '' : 'score-icon-btn-on'}`}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  setMutedState(next);
                  if (!next) unlockAudio();
                }}
                title={muted ? 'Unmute' : 'Mute'}
                type="button"
              >{muted ? '🔇' : '🔊'}</button>
              <button
                className={`score-icon-btn ${debug ? 'score-icon-btn-on' : ''}`}
                onClick={() => setDebug(d => !d)}
                title="Toggle debug board overlay"
                type="button"
              >🔍</button>
              <button className="score-icon-btn score-icon-btn-danger" onClick={leaveRoom} type="button">✕</button>
            </>
          )}
        />
      </div>

      <TurnCoach
        text={getTurnCoach(gameState, myPlayer, {
          robberMode,
          pendingSteal: !!(pendingSteal && stealTargets.length > 0),
          selectedAction,
        })}
        highlight={isMyTurn && !gameState.winner}
      />

      {/* Board — fills remaining space; menus overlay instead of shrinking it */}
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
        {myPlayer && (
          <div className="hand-bar-float">
            <HandBar player={myPlayer} />
          </div>
        )}
      </div>

      {/* Setup hint */}
      {gameState.setupPhase && (
        <div style={styles.setupHint}>
          {gameState.phase === 'setup_settlement'
            ? (gameState.setupRound >= gameState.players.length * 2
                ? '👆 Second settlement — you collect adjacent resources'
                : '👆 First settlement — no resources yet (official rule)')
            : '👆 Tap an edge to place a road'}
        </div>
      )}

      {/* Discard modal after a 7 */}
      {gameState.phase === 'discard' && myPlayer && gameState.discardQueue.includes(myPlayer.color) && (
        <DiscardModal
          player={myPlayer}
          mustDiscard={Math.floor(
            (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
              .reduce((s, r) => s + (myPlayer.resources[r] || 0), 0) / 2
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
              const p = gameState.players.find(pl => pl.color === color);
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

      {/* Incoming domestic trade offers */}
      {myPlayer && (
        <TradeOffers
          gameState={gameState}
          myColor={myPlayer.color}
          onAccept={handleAcceptTrade}
          onReject={handleRejectTrade}
          onCounter={handleCounterTrade}
        />
      )}

      {/* Bottom chrome: tab bar always visible; sheet overlays board above it */}
      <div className="bottom-chrome">
        {showPanel && (
          <div className="bottom-sheet" style={styles.panelChrome}>
            <div className="bottom-sheet-handle" aria-hidden />
            {showPanel === 'actions' && (
              <div className="bottom-sheet-body">
                {!gameState.setupPhase && (
                  <>
                    <DiceRoller
                      onRoll={handleRollDice}
                      rolling={false}
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
                      hasKnight={player.devCards.some(c => c.type === 'knight' && !c.played && !c.boughtThisTurn)}
                      pendingFreeRoads={isMyTurn ? gameState.pendingDevRoads : 0}
                    />
                    <TradePanel
                      gameState={gameState}
                      isMyTurn={isMyTurn}
                      phase={gameState.phase}
                      onBankTrade={handleBankTrade}
                      onProposeTrade={handleProposeTrade}
                      onCompleteTrade={handleCompleteTrade}
                      onCancelOffer={handleCancelOffer}
                    />
                    <DevCardPanel
                      player={myPlayer || player}
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
                    Place your settlements and roads to start the game!
                  </div>
                )}
              </div>
            )}

            {showPanel === 'hand' && myPlayer && (
              <div className="bottom-sheet-body">
                <PlayerHand player={myPlayer} isMe />
                <div style={styles.otherPlayers}>
                  {gameState.players.filter(p => p.color !== myPlayer.color).map(p => (
                    <PlayerHand key={p.color} player={p} isMe={false} />
                  ))}
                </div>
              </div>
            )}

            {showPanel === 'chat' && (
              <div className="bottom-sheet-body">
                <div style={styles.chatMessages}>
                  {chatMessages.length === 0 && (
                    <div style={styles.chatEmpty}>No messages yet</div>
                  )}
                  {chatMessages.slice(-20).map((msg, i) => (
                    <div key={i} style={styles.chatMsg}>
                      <span style={{ color: msg.playerColor, fontWeight: 'bold' }}>{msg.playerName}:</span>
                      {' '}{msg.text}
                    </div>
                  ))}
                </div>
                <div style={styles.chatInputRow}>
                  <input
                    style={styles.chatInput}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                    placeholder="Type a message..."
                    maxLength={100}
                  />
                  <button style={styles.chatSendBtn} onClick={handleSendChat}>Send</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={styles.tabBar}>
          <button
            style={{ ...styles.tab, ...(showPanel === 'actions' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'actions' ? null : 'actions')}
          >
            🎮 Actions
          </button>
          <button
            style={{ ...styles.tab, ...(showPanel === 'hand' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'hand' ? null : 'hand')}
          >
            🃏 Hand
          </button>
          <button
            style={{ ...styles.tab, ...(showPanel === 'chat' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'chat' ? null : 'chat')}
          >
            💬 Chat{chatMessages.length > 0 ? ` (${chatMessages.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    background: '#3a2412',
    color: '#f5efe4',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
    position: 'relative',
  },
  topBar: {
    flexShrink: 0,
    padding: 0,
    background: 'transparent',
    zIndex: 10,
  },
  turnInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  turnDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  turnName: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  youTag: {
    fontSize: 12,
    color: '#2ecc71',
  },
  phaseTag: {
    fontSize: 11,
    color: '#8890a0',
    textTransform: 'uppercase',
    background: '#1a1a2e',
    padding: '2px 6px',
    borderRadius: 4,
  },
  topActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  diceResult: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffd700',
  },
  leaveBtn: {
    padding: '4px 10px',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 1,
  },
  boardArea: {
    // layout from .board-stage
  },
  setupHint: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#ffd700',
    fontSize: 14,
    fontWeight: 'bold',
    padding: '8px 16px',
    background: 'rgba(0,0,0,0.6)',
    zIndex: 5,
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
    display: 'flex',
    background: 'linear-gradient(180deg, #2a1810, #1a1008)',
    borderTop: '1px solid rgba(200,150,70,0.25)',
    flexShrink: 0,
    zIndex: 10,
  },
  tab: {
    flex: 1,
    padding: '10px 4px',
    border: 'none',
    background: 'transparent',
    color: '#b0a090',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'color 0.15s',
  },
  tabActive: {
    color: '#ffd700',
    borderBottom: '2px solid #ffd700',
  },
  panelChrome: {
    // Visual bits only — sizing/scroll live on .bottom-sheet CSS class
  },
  setupMsg: {
    textAlign: 'center',
    color: '#8890a0',
    fontSize: 14,
    padding: 20,
  },
  otherPlayers: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 8,
  },
  chatMessages: {
    // Scroll with the whole bottom sheet (no nested maxHeight trap)
    fontSize: 13,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 4,
    minHeight: 80,
  },
  chatEmpty: {
    textAlign: 'center',
    color: '#8890a0',
    padding: 20,
  },
  chatMsg: {
    lineHeight: 1.4,
  },
  chatInputRow: {
    display: 'flex',
    gap: 6,
    marginTop: 4,
    position: 'sticky',
    bottom: 0,
    background: '#16213e',
    paddingTop: 8,
    paddingBottom: 4,
  },
  chatInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 14,
  },
  chatSendBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 8,
    background: '#3498db',
    color: 'white',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  doneTradingBtn: {
    padding: '12px 16px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};
