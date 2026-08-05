import { useState, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import { getCurrentPlayer } from '../game/rules';
import Board from './Board';
import PlayerHand from './PlayerHand';
import DiceRoller from './DiceRoller';
import TradePanel from './TradePanel';
import BuildMenu from './BuildMenu';

const HEX_SIZE = 55;

export default function OnlineGame() {
  const { gameState, playerId, room, sendAction, sendChat, chatMessages, leaveRoom } = useSocket();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [robberMode, setRobberMode] = useState(false);
  const [chatInput, setChatInput] = useState('');

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
    if (selectedAction === 'road') {
      sendAction('place_road', { key });
      setSelectedAction(null);
    }
  }, [selectedAction, sendAction]);

  const handleRollDice = useCallback(() => {
    sendAction('roll_dice');
  }, [sendAction]);

  const handleEndTurn = useCallback(() => {
    sendAction('end_turn');
    setSelectedAction(null);
  }, [sendAction]);

  const handleBuyDevCard = useCallback(() => {
    sendAction('buy_dev_card');
  }, [sendAction]);

  const handlePlayKnight = useCallback(() => {
    sendAction('play_knight');
    setRobberMode(true);
  }, [sendAction]);

  const handleSendChat = useCallback(() => {
    if (chatInput.trim()) {
      sendChat(chatInput.trim());
      setChatInput('');
    }
  }, [chatInput, sendChat]);

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
            {isMyTurn && <span style={styles.youBadge}> (You)</span>}
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
              hasKnight={player.devCards.some(c => c.type === 'knight' && !c.played)}
            />

            <TradePanel
              gameState={gameState}
              isMyTurn={isMyTurn}
              onTrade={() => {}}
            />
          </>
        )}

        {myPlayer && <PlayerHand player={myPlayer} />}

        {/* Chat */}
        <div style={styles.chatContainer}>
          <div style={styles.chatHeader}>Chat</div>
          <div style={styles.chatMessages}>
            {chatMessages.slice(-10).map((msg, i) => (
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
              placeholder="Chat..."
              maxLength={100}
            />
            <button style={styles.chatSendBtn} onClick={handleSendChat}>Send</button>
          </div>
        </div>

        <button style={styles.leaveBtn} onClick={leaveRoom}>Leave Game</button>
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
  youBadge: {
    fontSize: 12,
    color: '#2ecc71',
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
  chatContainer: {
    background: '#0f3460',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  chatHeader: {
    fontSize: 12,
    color: '#8890a0',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chatMessages: {
    maxHeight: 100,
    overflowY: 'auto',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  chatMsg: {
    lineHeight: 1.3,
  },
  chatInputRow: {
    display: 'flex',
    gap: 4,
  },
  chatInput: {
    flex: 1,
    padding: '4px 8px',
    border: '1px solid #1a1a2e',
    borderRadius: 4,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 12,
  },
  chatSendBtn: {
    padding: '4px 8px',
    border: 'none',
    borderRadius: 4,
    background: '#3498db',
    color: 'white',
    fontSize: 11,
    cursor: 'pointer',
  },
  leaveBtn: {
    padding: '8px 12px',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
  },
};
