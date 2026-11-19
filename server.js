const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_MARKS = 3;
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, 'public', 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function newGame() {
  return { board: Array(9).fill(null), turn: 'X', winner: null, line: null };
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function state(room) {
  const g = room.game;
  return {
    type: 'state',
    board: g.board,
    turn: g.turn,
    winner: g.winner,
    line: g.line,
    players: { X: !!room.players.X, O: !!room.players.O },
  };
}

function broadcast(room) {
  const s = state(room);
  for (const sym of ['X', 'O']) send(room.players[sym], { ...s, you: sym, code: room.code });
}

function handleMove(room, sym, from, to) {
  const g = room.game;
  if (g.winner || g.turn !== sym) return;
  if (!room.players.X || !room.players.O) return;
  if (!Number.isInteger(to) || to < 0 || to > 8 || g.board[to]) return;
  const count = g.board.filter(v => v === sym).length;
  if (count < MAX_MARKS) {
    g.board[to] = sym;                       // placing phase
  } else {                                   // moving phase: move any of your 3 marks
    if (!Number.isInteger(from) || g.board[from] !== sym) return;
    g.board[from] = null;
    g.board[to] = sym;
  }
  for (const l of LINES) {
    if (l.every(k => g.board[k] === sym)) { g.winner = sym; g.line = l; break; }
  }
  if (!g.winner) g.turn = sym === 'X' ? 'O' : 'X';
}

wss.on('connection', (ws) => {
  ws.room = null; ws.sym = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'create' && !ws.room) {
      const code = genCode();
      const room = { code, players: { X: ws, O: null }, game: newGame() };
      rooms.set(code, room);
      ws.room = room; ws.sym = 'X';
      broadcast(room);
    } else if (m.type === 'join' && !ws.room) {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.players.O) return send(ws, { type: 'error', message: 'Room is full' });
      room.players.O = ws; ws.room = room; ws.sym = 'O';
      broadcast(room);
    } else if (m.type === 'move' && ws.room) {
      handleMove(ws.room, ws.sym, m.from, m.to);
      broadcast(ws.room);
    } else if (m.type === 'rematch' && ws.room && ws.room.game.winner) {
      ws.room.game = newGame();
      broadcast(ws.room);
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    room.players[ws.sym] = null;
    if (!room.players.X && !room.players.O) { rooms.delete(room.code); return; }
    room.game = newGame(); // reset when someone leaves
    const other = room.players.X || room.players.O;
    send(other, { type: 'left' });
    broadcast(room);
  });
});

server.listen(PORT, () => console.log(`XO game running on http://localhost:${PORT}`));
