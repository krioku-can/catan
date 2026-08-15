// Live test of the full start-game flow: create room, add AI, ready, start.
const { io } = require('socket.io-client');
const SERVER = 'https://catan-4ieq.onrender.com';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const host = io(SERVER, { transports: ['websocket'], timeout: 25000, reconnection: false });
  let roomCode, hostPlayerId;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('create timeout')), 25000);
    host.on('connect', () => host.emit('create_room', { name: 'Host' }, r => { clearTimeout(t); roomCode = r.roomCode; hostPlayerId = r.playerId; res(); }));
    host.on('connect_error', e => rej(e));
  });
  console.log(`Created room ${roomCode}, host=${hostPlayerId}`);
  await wait(500);

  // Host toggles ready
  host.emit('toggle_ready');
  await wait(500);

  // Add an AI (ready=true automatically)
  host.emit('add_ai');
  await wait(500);

  // Try to start
  const started = new Promise((res) => {
    const t = setTimeout(() => res('TIMEOUT — no game_started event'), 8000);
    host.on('game_started', () => { clearTimeout(t); res('GAME STARTED'); });
    host.emit('start_game');
  });
  const result = await started;
  console.log(`start_game result: ${result}`);

  // Check room state
  const rooms = await (await fetch(`${SERVER}/api/rooms`)).json();
  const mine = rooms.find(r => r.id === roomCode);
  console.log(`room inGame=${mine?.inGame}, players=${mine?.players.length}`);

  host.close();
  process.exit(0);
}
main();
