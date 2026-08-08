import { useState, useCallback, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';
import { getCurrentPlayer } from '../game/rules';
import type { ResourceType, PlayerColor } from '../game/types';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import DiceFlash from './DiceFlash';
import HandBar from './HandBar';
import TradePanel from './TradePanel';
import BuildMenu from './BuildMenu';
import DiscardModal from './DiscardModal';
import DevCardPanel from './DevCardPanel';
import TradeOffers from './TradeOffers';

const HEX_SIZE = 58;

export default function OnlineGame() {
  const { gameState, playerId, room, sendAction, sendChat, chatMessages, leaveRoom } = useSocket();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [robberMode, setRobberMode] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showPanel, setShowPanel] = useState<'actions' | 'hand' | 'chat' | null>('actions');
  const [diceFlash, setDiceFlash] = useState<{ total: number; faces: [number, number] } | null>(null);

  // Flash the rolled number whenever the server syncs a new dice result.
  useEffect(() => {
    if (gameState?.dice) {
      setDiceFlash({ total: gameState.dice[0] + gameState.dice[1], faces: [gameState.dice[0], gameState.dice[1]] });
    }
  }, [gameState?.dice?.[0], gameState?.dice?.[1]]);

  if (!gameState || !room) return null;

  const myPlayer = gameState.players.find(p => {
    const conn = room.players.find(rp => rp.playerId === playerId);
    return conn && p.color === conn.color;
  });
  const player = getCurrentPlayer(gameState);
  const isMyTurn = myPlayer?.color === player.color;

  const handleHexClick = useCallback((q: number, r: number) => {
    if (!robberMode) return;
    sendAction('move_robber', { q, r });
    setRobberMode(false);
  }, [robberMode, sendAction]);

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

  const handleProposeTrade = useCallback((to: PlayerColor, give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => {
    sendAction('propose_trade', { to, give, want });
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

  return (
    <div style={styles.container}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.turnInfo}>
          <div style={{ ...styles.turnDot, backgroundColor: player.color }} />
          <span style={styles.turnName}>
            {player.name}{player.isAI ? ' 🤖' : ''}
            {isMyTurn ? <span style={styles.youTag}> (You)</span> : ''}
          </span>
          <span style={styles.phaseTag}>
            {gameState.setupPhase ? 'Setup' : gameState.phase}
          </span>
        </div>
        <div style={styles.topActions}>
          {gameState.dice && (
            <span style={styles.diceResult}>🎲 {gameState.dice[0]}+{gameState.dice[1]}</span>
          )}
          <button style={styles.leaveBtn} onClick={leaveRoom}>✕</button>
        </div>
      </div>

      {/* Board */}
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

      {/* Setup hint */}
      {gameState.setupPhase && (
        <div style={styles.setupHint}>
          {gameState.phase === 'setup_settlement'
            ? '👆 Tap a hex corner to place a settlement'
            : '👆 Tap an edge to place a road'}
        </div>
      )}

      {myPlayer && <HandBar player={myPlayer} />}

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

      {/* Bottom tab bar */}
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

      {/* Slide-up panel — single scroll container (class for reliable mobile scroll) */}
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
    position: 'relative',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#0f3460',
    zIndex: 10,
    flexShrink: 0,
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
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
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
  tabBar: {
    display: 'flex',
    background: '#0f3460',
    borderTop: '1px solid #1a1a2e',
    flexShrink: 0,
    zIndex: 10,
  },
  tab: {
    flex: 1,
    padding: '10px 4px',
    border: 'none',
    background: 'transparent',
    color: '#8890a0',
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
