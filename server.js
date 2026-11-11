'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table } = require('./engine');
const PUB = path.join(__dirname, 'public'), MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const rooms = new Map();
const server = http.createServer((req, res) => {
  let f = path.normalize(path.join(PUB, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const code = () => { let c; do c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); while (rooms.has(c)); return c; };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

function mkRoom(opts, hostId) {
  const room = { code: code(), hostId, clients: new Map(), chat: [], rl: new Map() };
  room.table = new Table(opts, () => push(room));
  rooms.set(room.code, room); return room;
}
function push(room) {
  for (const [id, ws] of room.clients) send(ws, { t: 'state', code: room.code, host: room.hostId, you: id, chat: room.chat.slice(-30), s: room.table.view(id) });
}
function limited(room, id, kind, ms) { const k = id + kind, n = Date.now(); if (n - (room.rl.get(k) || 0) < ms) return true; room.rl.set(k, n); return false; }

wss.on('connection', ws => {
  let room = null, id = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const err = e => send(ws, { t: 'error', msg: e });
    try {
      if (m.t === 'create' || m.t === 'join') {
        id = clean(m.token, 64); if (id.length < 8) return err('Invalid session');
        if (m.t === 'create') {
          const o = { chips: [1000, 2000, 5000].includes(+m.chips) ? +m.chips : 2000, sb: [10, 25].includes(+m.sb) ? +m.sb : 10, maxP: Math.min(10, Math.max(2, +m.maxP || 10)), fast: process.env.PP_FAST === '1' };
          room = mkRoom(o, id);
        } else {
          room = rooms.get(clean(m.code, 5).toUpperCase()); if (!room) return err('Room not found');
        }
        const t = room.table, ex = t.P.find(p => p.id === id);
        if (ex) ex.connected = true;
        else if (t.state === 'lobby') t.add(id, clean(m.name, 12) || 'Player', clean(m.av, 12) || 'cat');
        else if (!t.o.spectators) return err('Game in progress');
        if (!room.hostId || !t.P.some(p => p.id === room.hostId && !p.bot)) room.hostId = id;
        const old = room.clients.get(id); if (old && old !== ws) old.close();
        room.clients.set(id, ws); push(room); return;
      }
      if (!room) return err('Join a room first');
      const t = room.table, isHost = id === room.hostId;
      if (m.t === 'addBot') { if (!isHost) return err('Only the host can add bots'); t.addBot(m.diff); }
      else if (m.t === 'start') { if (!isHost) return err('Only the host can start'); if (!t.start()) err('Need at least 2 players'); }
      else if (m.t === 'act') { const r = t.act(id, m.type, m.amount, m.ver); if (!r.ok) err(r.err); }
      else if (m.t === 'chat') { const txt = clean(m.text, 200); if (!txt || limited(room, id, 'c', 1000)) return; const p = t.P.find(p => p.id === id); room.chat.push({ name: p ? p.name : 'Spectator', text: txt, at: Date.now() }); push(room); }
      else if (m.t === 'sticker') { if (limited(room, id, 's', 2000)) return err('Sticker cooldown'); const k = clean(m.sticker, 16); for (const [, w] of room.clients) send(w, { t: 'sticker', from: id, to: clean(m.to, 64) || null, sticker: k }); }
    } catch (e) { err(e.message); }
  });
  ws.on('close', () => {
    if (!room || room.clients.get(id) !== ws) return;
    room.clients.delete(id); const p = room.table.P.find(p => p.id === id); if (p) p.connected = false;
    if (room.hostId === id) { const n = room.table.P.find(p => !p.bot && p.connected); if (n) room.hostId = n.id; }
    if (![...room.clients.keys()].length) setTimeout(() => { if (!room.clients.size) { room.table.stop(); rooms.delete(room.code); } }, 10 * 60 * 1000);
    push(room);
  });
});
const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('POKER PARTY on :' + PORT));
module.exports = { server, rooms };
