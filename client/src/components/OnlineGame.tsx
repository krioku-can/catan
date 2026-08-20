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
import PushToggle from './PushToggle';
import TurnTimer from './TurnTimer';
import DevCardReveal from './DevCardReveal';
import { unlockAudio, sfx, isMuted, setMuted } from '../audio';
import { getTurnCoach } from '../turnCoach';

const HEX_SIZE = 68;

export default function OnlineGame({ onLeaveTable }: { onLeaveTable?: () => void }) {
  const { gameState, playerId, room, sendAction, sendChat, chatMessages, leaveRoom, lastActionResult, turnTimer } = useSocket();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [robberMode, setRobberMode] = useState(false);
  const [stealTargets, setStealTargets] = useState<PlayerColor[]>([]);
  const [pendingSteal, setPendingSteal] = useState<{ q: number; r: number } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showPanel, setShowPanel] = useState<'actions' | 'hand' | 'chat' | null>(null);
  const [diceFlash, setDiceFlash] = useState<{ total: number; faces: [number, number] } | null>(null);
  const [debug, setDebug] = useState(() => new URLSearchParams(window.location.search).get('debug') === '1');
  const [muted, setMutedState] = useState(() => isMuted());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [orderFlash, setOrderFlash] = useState<{ order: PlayerColor[]; rolls: Record<string, number> } | null>(null);
  const [devReveal, setDevReveal] = useState<{ type?: string | null; buyerName?: string } | null>(null);
  const lastTurnColorRef = useRef<string | null>(null);
  const lastDiceKeyRef = useRef<string>('');

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

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

  // Only the current player may move the robber, and only while the server
  // says a 7/knight is still waiting. Never arm this for the whole table.
  useEffect(() => {
    if (!gameState) {
      setRobberMode(false);
      return;
    }
    const myColor = room?.players.find(rp => rp.playerId === playerId)?.color;
    const current = getCurrentPlayer(gameState);
    const mine = !!myColor && current.color === myColor;
    const mustMove = !!gameState.pendingRobberMove
      && !gameState.robberMovedThisTurn
      && mine
      && gameState.phase !== 'discard';
    setRobberMode(mustMove);
  }, [gameState?.pendingRobberMove, gameState?.robberMovedThisTurn, gameState?.phase, gameState?.currentTurn, room, playerId]);

  useEffect(() => {
    if (lastActionResult?.action === 'move_robber') {
      sfx.robber();
      const targets = (lastActionResult.result?.stealTargets || []) as PlayerColor[];
      const alreadyStole = !!lastActionResult.result?.alreadyStole;
      if (targets.length > 0 && !alreadyStole) {
        setStealTargets(targets);
        setPendingSteal({ q: 0, r: 0 });
      } else {
        setStealTargets([]);
        setPendingSteal(null);
      }
    }
    if (lastActionResult?.action === 'steal') {
      sfx.steal();
      setStealTargets([]);
      setPendingSteal(null);
    }
    if (lastActionResult?.action === 'discard') sfx.discard();
    if (lastActionResult?.action === 'place_settlement' || lastActionResult?.action === 'place_city') sfx.build();
    if (lastActionResult?.action === 'place_road') sfx.road();
    if (lastActionResult?.action === 'buy_dev_card') {
      const res = lastActionResult.result as { card?: { type?: string } | null; buyer?: PlayerColor; bought?: boolean } | null;
      if (!res) return;
      const type = res.card?.type;
      if (!type && !res.bought) return;
      const myColor = room?.players.find(rp => rp.playerId === playerId)?.color;
      const buyer = res.buyer;
      const buyerName = (buyer && gameState?.players.find(p => p.color === buyer)?.name) || 'Someone';
      if (type && (!buyer || buyer === myColor)) {
        sfx.devCard();
        setDevReveal({ type });
      } else {
        sfx.click();
        setDevReveal({ buyerName });
      }
    }
  }, [lastActionResult]);

  useEffect(() => {
    if (lastActionResult?.action !== 'roll_turn_order') return;
    const rolls = lastActionResult.result?.rolls as Record<string, number> | undefined;
    const order = lastActionResult.result?.order as PlayerColor[] | undefined;
    if (!rolls || !order?.length) return;
    setOrderFlash({ order, rolls });
  }, [lastActionResult]);

  useEffect(() => {
    if (!orderFlash) return;
    const t = window.setTimeout(() => setOrderFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [orderFlash]);

  const handleHexClick = useCallback((q: number, r: number) => {
    if (!robberMode) return;
    sendAction('move_robber', { q, r });
  }, [robberMode, sendAction]);

  const handleSteal = useCallback((target: PlayerColor) => {
    if (!gameState) return;
    const [rq, rr] = gameState.robberHex.split(',').map(Number);
    sendAction('steal', { q: rq, r: rr, target });
    setPendingSteal(null);
    setStealTargets([]);
  }, [gameState, sendAction]);

  const handleIntersectionClick = useCallback((key: string) => {
    setOrderFlash(null);
    if (gameState?.setupPhase && gameState.phase === 'setup_settlement') {
      sendAction('place_settlement', { key });
      return;
    }
    if (selectedAction === 'settlement') {
      sendAction('place_settlement', { key });
      setSelectedAction(null);
    } else if (selectedAction === 'city') {
      sendAction('place_city', { key });
      setSelectedAction(null);
    }
  }, [selectedAction, sendAction, gameState]);

  const handleEdgeClick = useCallback((key: string) => {
    setOrderFlash(null);
    const setupRoad = !!gameState?.setupPhase && gameState.phase === 'setup_road';
    const freeRoads = gameState?.pendingDevAction === 'road_building' && (gameState?.pendingDevRoads || 0) > 0;
    if (setupRoad || freeRoads || selectedAction === 'road') {
      sendAction('place_road', { key });
      if (!freeRoads && !setupRoad) setSelectedAction(null);
    }
  }, [selectedAction, sendAction, gameState]);

  const handleRollDice = useCallback(() => {
    sendAction('roll_dice');
  }, [sendAction]);
  const handleTurnOrder = useCallback(() => {
    sendAction('roll_turn_order');
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
  const awayColors = room.players
    .filter(p => !p.isAI && p.connected === false)
    .map(p => p.color);
  const currentAway = awayColors.includes(player.color);
  const coachText = currentAway && !isMyTurn
    ? `${player.name} is away — waiting for them to come back`
    : getTurnCoach(gameState, myPlayer, {
        robberMode,
        pendingSteal: !!(pendingSteal && stealTargets.length > 0),
        selectedAction,
      });

  const leaveModal = confirmLeave ? (
    <div style={styles.modalScrim} onClick={() => setConfirmLeave(false)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Leave the table?</h3>
        <p style={styles.modalBody}>
          This gives up your seat. Closing the tab is fine — you can come back with the invite.
        </p>
        <button type="button" style={styles.stayBtn} onClick={() => setConfirmLeave(false)}>
          Stay
        </button>
        <button
          type="button"
          style={styles.leaveConfirmBtn}
          onClick={() => { setConfirmLeave(false); leaveRoom(); onLeaveTable?.(); }}
        >
          Leave table
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div style={styles.container}>
      {leaveModal}
      {gameState.winner && (
        <div style={styles.winOverlay}>
          <div style={styles.winCard}>
            <div style={styles.winEmoji}>{myPlayer?.color === gameState.winner ? '🏆' : '🎲'}</div>
            <h2 style={styles.winTitle}>
              {myPlayer?.color === gameState.winner ? 'You win!' : 'Game over'}
            </h2>
            <p style={styles.winSub}>
              {gameState.players.find(p => p.color === gameState.winner)?.name} wins with{' '}
              {gameState.players.find(p => p.color === gameState.winner)?.victoryPoints ?? 10} VP
            </p>
            <button
              type="button"
              style={styles.winBtn}
              onClick={() => { leaveRoom(); onLeaveTable?.(); }}
            >
              Back to lobby
            </button>
          </div>
        </div>
      )}
      {gameState.phase === 'turn_order' && (
        <div style={styles.turnOrderScreen}>
          <p style={styles.turnOrderKicker}>Family table {room.id}</p>
          <h2 style={styles.turnOrderTitle}>Who goes first?</h2>
          <div style={styles.turnOrderSeats}>
            {gameState.players.map(p => (
              <div key={p.color} style={styles.turnOrderSeat}>
                <span style={{ ...styles.stealDot, backgroundColor: p.color }} />
                {p.name}
              </div>
            ))}
          </div>
          {isMyTurn ? (
            <>
              <p style={styles.turnOrderSub}>Roll to lock seating order. Highest goes first.</p>
              <button type="button" style={styles.turnOrderBtn} onClick={handleTurnOrder}>
                Roll for everyone
              </button>
            </>
          ) : (
            <p style={styles.turnOrderSub}>Waiting for {player.name} to roll…</p>
          )}
        </div>
      )}

      <div style={styles.topBar}>
        <ScoreBar
          gameState={gameState}
          myColor={myPlayer?.color}
          currentColor={player.color}
          dice={gameState.dice}
          awayColors={awayColors}
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
              <button className="score-icon-btn score-icon-btn-danger" onClick={() => setConfirmLeave(true)} type="button">✕</button>
            </>
          )}
        />
      </div>

      <TurnCoach
        text={coachText}
        highlight={isMyTurn && !gameState.winner}
        trailing={
          turnTimer?.enabled ? (
            <TurnTimer
              deadline={turnTimer.deadline}
              paused={turnTimer.paused}
              pausedRemainingMs={turnTimer.pausedRemainingMs}
            />
          ) : null
        }
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
        {devReveal && (
          <DevCardReveal
            type={devReveal.type}
            buyerName={devReveal.buyerName}
            onDone={() => setDevReveal(null)}
          />
        )}
        {myPlayer && (
          <div className="hand-bar-float">
            <HandBar player={myPlayer} />
          </div>
        )}
        {orderFlash && (
          <div style={styles.orderFlash}>
            <div style={styles.orderFlashTitle}>Turn order</div>
            <div style={styles.orderFlashList}>
              {orderFlash.order.map((color, i) => {
                const p = gameState.players.find(pl => pl.color === color);
                return (
                  <div key={color} style={styles.orderFlashRow}>
                    <span style={styles.orderFlashRank}>{i + 1}</span>
                    <span style={{ ...styles.stealDot, backgroundColor: color }} />
                    <span style={styles.orderFlashName}>{p?.name}</span>
                    <span style={styles.orderFlashRoll}>{orderFlash.rolls[color]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {gameState.setupPhase && (
        <div style={styles.setupHint}>
          {gameState.phase === 'setup_settlement'
            ? (gameState.setupRound >= gameState.players.length * 2
                ? 'Second settlement — you collect adjacent resources'
                : 'First settlement — no resources yet (official rule)')
            : 'Tap an edge to place a road'}
        </div>
      )}

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

      {pendingSteal && stealTargets.length > 0 && (
        <div style={styles.stealOverlay}>
          <div style={styles.stealCard}>
            <div style={styles.stealTitle}>Steal 1 resource</div>
            <div style={styles.stealHint}>
              Official rule: take one random resource from a player on this hex.
            </div>
            {stealTargets.map(color => {
              const p = gameState.players.find(pl => pl.color === color) as
                | (typeof gameState.players[number] & { _resourceCount?: number })
                | undefined;
              const cards = p?._resourceCount
                ?? ['brick', 'lumber', 'wool', 'grain', 'ore'].reduce((s, r) => s + (p?.resources[r as ResourceType] || 0), 0);
              return (
                <button
                  key={color}
                  style={{ ...styles.stealBtn, borderColor: color }}
                  onClick={() => handleSteal(color)}
                >
                  <span style={{ ...styles.stealDot, backgroundColor: color }} />
                  <span style={{ flex: 1, textAlign: 'left' }}>{p?.name}</span>
                  <span style={styles.stealCount}>{cards} card{cards === 1 ? '' : 's'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lastActionResult?.action === 'steal' && lastActionResult.result?.resource && (
        <div style={styles.stealToast}>
          You stole {lastActionResult.result.resource}!
        </div>
      )}

      {myPlayer && (
        <TradeOffers
          gameState={gameState}
          myColor={myPlayer.color}
          onAccept={handleAcceptTrade}
          onReject={handleRejectTrade}
          onCounter={handleCounterTrade}
        />
      )}

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
                        Done Trading
                      </button>
                    )}
                    <PushToggle playerId={playerId} />
                  </>
                )}
                {gameState.setupPhase && (
                  <div style={styles.setupMsg}>
                    {isMyTurn ? 'Place your pieces on the board' : 'Waiting for the table…'}
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
            Actions
          </button>
          <button
            style={{ ...styles.tab, ...(showPanel === 'hand' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'hand' ? null : 'hand')}
          >
            Hand
          </button>
          <button
            style={{ ...styles.tab, ...(showPanel === 'chat' ? styles.tabActive : {}) }}
            onClick={() => setShowPanel(showPanel === 'chat' ? null : 'chat')}
          >
            Chat{chatMessages.length > 0 ? ` (${chatMessages.length})` : ''}
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
  boardArea: {},
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
    pointerEvents: 'none',
  },
  turnOrderScreen: {
    position: 'fixed', inset: 0, zIndex: 60,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.85)', gap: 16, padding: 24,
  },
  turnOrderKicker: {
    color: '#c4b49a', fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', margin: 0,
  },
  turnOrderSeats: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  turnOrderSeat: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 10px',
    color: '#f5efe4', fontWeight: 700, fontSize: 13,
  },
  turnOrderTitle: { color: '#ffd700', fontSize: 24, fontWeight: 'bold', margin: 0, textAlign: 'center' },
  turnOrderSub: { color: '#c4b49a', fontSize: 14, margin: 0, textAlign: 'center', maxWidth: 300 },
  turnOrderBtn: {
    padding: '14px 28px', border: 'none', borderRadius: 10,
    background: 'linear-gradient(135deg, #c4784a, #8a4b28)', color: 'white',
    fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
  },
  orderFlash: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 168,
    background: 'linear-gradient(180deg, rgba(48,28,14,0.92), rgba(28,16,8,0.94))',
    border: '1px solid rgba(200,150,70,0.35)',
    borderRadius: 10,
    padding: '8px 10px',
    zIndex: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    pointerEvents: 'none',
    boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
  },
  orderFlashTitle: {
    color: '#ffd700',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 2,
  },
  orderFlashList: { display: 'flex', flexDirection: 'column', gap: 3 },
  orderFlashRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#f5efe4',
    fontSize: 12,
    fontWeight: 700,
  },
  orderFlashName: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  orderFlashRank: { width: 14, color: '#c4b49a', fontSize: 11 },
  orderFlashRoll: { color: '#ffd700', fontVariantNumeric: 'tabular-nums' },
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
  stealHint: { color: '#c4b49a', fontSize: 12, textAlign: 'center', lineHeight: 1.35, marginBottom: 4 },
  stealCount: { color: '#c4b49a', fontSize: 12, fontWeight: 700 },
  stealToast: {
    position: 'absolute',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 40,
    background: 'rgba(20,12,6,0.92)',
    border: '1px solid rgba(255,213,79,0.45)',
    color: '#ffd54f',
    fontWeight: 800,
    fontSize: 14,
    padding: '8px 14px',
    borderRadius: 10,
    pointerEvents: 'none',
  },
  stealBtn: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
    border: '2px solid', borderRadius: 8, background: '#1a1a2e', color: '#e0e0e0',
    fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
  },
  stealDot: { width: 14, height: 14, borderRadius: '50%', flexShrink: 0 },
  winOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.72)',
    zIndex: 120,
    padding: 20,
  },
  winCard: {
    background: '#16213e',
    border: '1px solid rgba(255,213,79,0.35)',
    borderRadius: 16,
    padding: '32px 28px',
    textAlign: 'center',
    width: '100%',
    maxWidth: 320,
  },
  winEmoji: { fontSize: 56, marginBottom: 8 },
  winTitle: { fontSize: 26, color: '#ffd700', margin: '0 0 8px' },
  winSub: { fontSize: 14, color: '#c4b49a', margin: '0 0 20px', lineHeight: 1.4 },
  winBtn: {
    padding: '14px 24px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    width: '100%',
  },
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
  panelChrome: {},
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
  chatMsg: { lineHeight: 1.4 },
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
    fontSize: 16,
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
  modalScrim: {
    position: 'fixed', inset: 0, zIndex: 80,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  modal: {
    background: '#2a1810',
    border: '1px solid rgba(200,150,70,0.35)',
    borderRadius: 14,
    padding: 20,
    maxWidth: 340,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  modalTitle: { margin: 0, color: '#ffd700', fontSize: 18 },
  modalBody: { margin: 0, color: '#c4b49a', fontSize: 14, lineHeight: 1.4 },
  stayBtn: {
    padding: '10px 14px', border: 'none', borderRadius: 8,
    background: '#c4784a', color: '#fff', fontWeight: 700, cursor: 'pointer',
  },
  leaveConfirmBtn: {
    padding: '10px 14px', border: '1px solid #e74c3c', borderRadius: 8,
    background: 'transparent', color: '#e74c3c', fontWeight: 700, cursor: 'pointer',
  },
};
