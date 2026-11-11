'use strict';
const crypto = require('crypto');
const ri = n => crypto.randomInt(n);
const shuffle = d => { for (let i = d.length - 1; i > 0; i--) { const j = ri(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
const newDeck = () => { const d = []; for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s }); return shuffle(d); };
const HN = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

function ev5(c) {
  let r = c.map(x => x.r).sort((a, b) => b - a);
  const fl = c.every(x => x.s === c[0].s), cn = {};
  r.forEach(x => cn[x] = (cn[x] || 0) + 1);
  const g = Object.entries(cn).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const u = g.length === 5; let st = u && r[0] - r[4] === 4;
  if (u && r[0] === 14 && r[1] === 5) { st = true; r = [5, 4, 3, 2, 1]; }
  const cat = st && fl ? 8 : g[0][1] === 4 ? 7 : g[0][1] === 3 && g[1] && g[1][1] === 2 ? 6 : fl ? 5 : st ? 4 : g[0][1] === 3 ? 3 : g[0][1] === 2 && g[1] && g[1][1] === 2 ? 2 : g[0][1] === 2 ? 1 : 0;
  const tb = st ? r : g.map(x => x[0]); while (tb.length < 5) tb.push(0);
  let sc = cat; tb.forEach(v => sc = sc * 15 + v); return sc;
}
function best(cs) {
  if (cs.length === 5) return ev5(cs);
  let b = 0;
  (function go(i, pick) {
    if (pick.length === 5) { b = Math.max(b, ev5(pick)); return; }
    if (i >= cs.length || pick.length + cs.length - i < 5) return;
    go(i + 1, [...pick, cs[i]]); go(i + 1, pick);
  })(0, []);
  return b;
}
const catOf = sc => Math.floor(sc / 759375);
const hname = sc => catOf(sc) === 8 && Math.floor(sc / 50625) % 15 === 14 ? 'Royal Flush' : HN[catOf(sc)];
const PERS = ['aggressive', 'conservative', 'balanced', 'unpredictable', 'patient'];

class Table {
  constructor(o, onChange) {
    this.o = Object.assign({ chips: 2000, sb: 10, maxP: 10, fast: false, turnMs: 60000, spectators: true }, o);
    this.o.sb = Math.max(1, this.o.sb | 0); this.bb = this.o.sb * 2;
    this.P = []; this.dealer = -1; this.hand = 0; this.state = 'lobby'; this.ver = 0; this.hist = [];
    this.board = []; this.to = -1; this.cur = 0; this.minRaise = this.bb; this.win = []; this.reveal = false;
    this.onChange = onChange || (() => {}); this.timers = new Set(); this.hT = null; this.dl = 0; this.say = '';
  }
  T(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.o.fast ? Math.min(ms, 5) : ms); this.timers.add(t); }
  changed() { this.ver++; this.onChange(); }
  add(id, name, av, bot, extra) {
    if (this.P.length >= this.o.maxP) throw new Error('Room is full');
    if (this.state !== 'lobby') throw new Error('Game already started');
    this.P.push(Object.assign({ id, name: String(name).slice(0, 12), av, bot: !!bot, chips: this.o.chips, hole: [], bet: 0, total: 0, folded: true, allin: false, acted: false, noRaise: false, out: false, connected: true }, extra));
    this.changed();
  }
  addBot(diff) {
    const names = ['Clyde', 'Graggle', 'Locke', 'Hallow', 'Mango', 'Biscuit', 'Nova', 'Pixel', 'Zippy'].filter(n => !this.P.some(p => p.name === n));
    this.add('bot-' + crypto.randomUUID(), names[0] || 'Bot', 'bot' + ri(8), true, { diff: ['easy', 'medium', 'hard'].includes(diff) ? diff : 'medium', pers: PERS[ri(5)] });
  }
  start() { if (this.state !== 'lobby' || this.P.length < 2) return false; this.nextHand(); return true; }
  stop() { this.timers.forEach(clearTimeout); this.timers.clear(); clearTimeout(this.hT); }
  pot() { return this.P.reduce((a, p) => a + p.total, 0); }
  nextHand() {
    this.stop();
    if (this.P.filter(p => p.chips > 0).length < 2) { this.state = 'over'; this.to = -1; this.changed(); return; }
    this.hand++; this.board = []; this.phase = 0; this.cur = 0; this.minRaise = this.bb; this.reveal = false; this.win = []; this.busy = false; this.state = 'hand'; this.say = '';
    let d = this.dealer; do d = (d + 1) % this.P.length; while (this.P[d].chips <= 0); this.dealer = d;
    this.P.forEach(p => Object.assign(p, { hole: [], bet: 0, total: 0, folded: p.chips <= 0, out: p.chips <= 0, allin: false, acted: false, noRaise: false, last: '' }));
    this.deck = newDeck();
    const ord = []; for (let k = 1; k <= this.P.length; k++) { const i = (d + k) % this.P.length; if (!this.P[i].out) ord.push(i); }
    for (let r = 0; r < 2; r++) ord.forEach(i => this.P[i].hole.push(this.deck.pop()));
    let sbI, bbI, first;
    if (ord.length === 2) { sbI = d; bbI = ord.find(i => i !== d); first = sbI; } else { sbI = ord[0]; bbI = ord[1]; first = ord[2 % ord.length]; }
    this.put(sbI, this.o.sb); this.put(bbI, this.bb); this.cur = Math.max(this.P[sbI].bet, this.P[bbI].bet); this.to = first;
    this.changed(); this.turn();
  }
  put(i, n) { const p = this.P[i]; n = Math.min(n, p.chips); if (n <= 0) return 0; p.chips -= n; p.bet += n; p.total += n; if (!p.chips) p.allin = true; return n; }
  minTo() { return this.cur + this.minRaise; }
  turn() {
    const p = this.P[this.to]; clearTimeout(this.hT); this.dl = 0;
    if (p.bot) { const v = this.ver; this.T(() => { if (this.ver === v && this.P[this.to] === p) this.bot(this.to); }, 1800 + ri(3500) + (this.cur ? ri(1500) : 0)); }
    else { this.dl = Date.now() + this.o.turnMs; this.changed(); const v = this.ver; this.hT = setTimeout(() => { if (this.ver === v) { this.say = p.name + ' timed out'; this.act(p.id, 'fold'); } }, this.o.turnMs); }
  }
  act(id, type, to, ver) {
    if (this.state !== 'hand' || this.busy || this.to < 0) return { ok: false, err: 'Not your turn' };
    const p = this.P[this.to];
    if (p.id !== id) return { ok: false, err: 'Not your turn' };
    if (ver !== undefined && ver !== this.ver) return { ok: false, err: 'Stale state, try again' };
    const need = this.cur - p.bet, mx = p.bet + p.chips;
    if (!['fold', 'check', 'call', 'raise'].includes(type)) return { ok: false, err: 'Unknown action' };
    if (type === 'check' && need > 0) return { ok: false, err: 'Cannot check' };
    if (type === 'raise') {
      to = Number(to);
      if (!Number.isInteger(to) || to <= 0 || to > mx) return { ok: false, err: 'Invalid amount' };
      if (p.noRaise) return { ok: false, err: 'Betting not reopened' };
      if (to < this.minTo() && to < mx) return { ok: false, err: 'Minimum raise is to ' + this.minTo() };
      if (to <= this.cur && to < mx) return { ok: false, err: 'Must raise' };
    }
    clearTimeout(this.hT); let msg;
    if (type === 'fold') { p.folded = true; msg = 'folds'; }
    else if (type === 'check') msg = 'checks';
    else if (type === 'call') { this.put(this.to, need); msg = 'calls'; }
    else {
      const size = to - this.cur; this.put(this.to, to - p.bet);
      if (to > this.cur) {
        if (size >= this.minRaise) { this.minRaise = size; this.P.forEach(q => q.noRaise = false); } else this.P.forEach(q => { if (q.acted) q.noRaise = true; });
        this.cur = to; this.P.forEach(q => { if (q !== p) q.acted = false; });
      }
      msg = p.allin ? 'is all-in' : 'raises';
    }
    p.acted = true; p.last = msg; this.event = { id: p.id, type, amount: p.bet }; this.next(); return { ok: true };
  }
  next() {
    const alive = this.P.filter(p => !p.folded);
    if (alive.length === 1) return this.award(false);
    const can = alive.filter(p => !p.allin);
    const done = !can.length || (can.length === 1 && can[0].bet >= this.cur && alive.every(p => p.allin || p === can[0])) || can.every(p => p.acted && p.bet === this.cur);
    if (done) return this.advance();
    let i = this.to; for (let k = 0; k < this.P.length; k++) { i = (i + 1) % this.P.length; const q = this.P[i]; if (!q.folded && !q.allin && (!q.acted || q.bet < this.cur)) { this.to = i; break; } }
    this.changed(); this.turn();
  }
  advance() {
    this.busy = true; this.to = -1; this.changed();
    this.T(() => {
      if (this.phase === 3) { this.busy = false; return this.award(true); }
      this.P.forEach(p => { p.bet = 0; p.acted = false; p.noRaise = false; p.last = ''; });
      this.cur = 0; this.minRaise = this.bb; this.phase++; this.deck.pop();
      for (let k = this.phase === 1 ? 3 : 1; k > 0; k--) this.board.push(this.deck.pop());
      this.busy = false; this.changed();
      this.T(() => {
        const can = this.P.filter(p => !p.folded && !p.allin);
        if (can.length <= 1) { this.reveal = true; this.busy = true; this.changed(); return this.T(() => this.advance(), 900); }
        let i = this.dealer; for (let k = 0; k < this.P.length; k++) { i = (i + 1) % this.P.length; if (!this.P[i].folded && !this.P[i].allin) { this.to = i; break; } }
        this.turn();
      }, 600);
    }, 500);
  }
  award(sd) {
    clearTimeout(this.hT); this.to = -1; this.busy = false;
    const alive = this.P.filter(p => !p.folded); this.reveal = sd && alive.length > 1;
    const sc = new Map(); if (sd) alive.forEach(p => sc.set(p, best([...p.hole, ...this.board])));
    const lv = [...new Set(this.P.filter(p => p.total > 0).map(p => p.total))].sort((a, b) => a - b);
    let prev = 0; const won = new Map();
    for (const L of lv) {
      let amt = 0; this.P.forEach(p => amt += Math.max(0, Math.min(p.total, L) - Math.min(p.total, prev))); prev = L;
      let el = alive.filter(p => p.total >= L); if (!el.length) el = alive;
      let w = el; if (sd) { const m = Math.max(...el.map(p => sc.get(p))); w = el.filter(p => sc.get(p) === m); }
      const sh = Math.floor(amt / w.length); let odd = amt - sh * w.length;
      for (let k = 1; k <= this.P.length; k++) { const q = this.P[(this.dealer + k) % this.P.length]; if (w.includes(q)) { won.set(q, (won.get(q) || 0) + sh + (odd > 0 ? 1 : 0)); if (odd > 0) odd--; } }
    }
    const txt = []; this.win = [];
    won.forEach((v, q) => { q.chips += v; this.win.push({ id: q.id, amount: v, hand: sd ? hname(sc.get(q)) : null }); txt.push(q.name + ' wins ' + v + (sd ? ' with ' + hname(sc.get(q)) : '')); });
    this.hist.unshift({ hand: this.hand, text: txt.join(', '), board: this.board.map(c => ({ ...c })) }); this.hist.length = Math.min(this.hist.length, 30);
    this.P.forEach(p => { p.bet = 0; p.total = 0; }); this.state = 'between'; this.changed();
    this.T(() => this.nextHand(), 4500);
  }
  strength(p) {
    const h = p.hole, b = this.board;
    if (!b.length) { const hi = Math.max(h[0].r, h[1].r), lo = Math.min(h[0].r, h[1].r); let s = (hi + lo - 4) / 24 * .7; if (hi === lo) s = .5 + hi / 14 * .45; if (h[0].s === h[1].s) s += .04; if (hi - lo <= 2) s += .03; return Math.min(1, s); }
    const sc = best([...h, ...b]), c = catOf(sc); let s = [.18, .45, .65, .75, .85, .88, .95, 1, 1][c];
    if (c === 0) s += Math.max(h[0].r, h[1].r) / 14 * .12;
    if (c === 1 && Math.floor(sc / 50625) % 15 >= Math.max(...b.map(x => x.r))) s += .1;
    return Math.min(1, s);
  }
  bot(i) {
    const p = this.P[i], need = this.cur - p.bet, pt = this.pot(), hard = p.diff === 'hard', easy = p.diff === 'easy', rnd = Math.random;
    let s = this.strength(p); s += easy ? (rnd() - .5) * .35 : hard ? 0 : (rnd() - .5) * .1;
    if (hard && i === this.dealer) s += .04;
    s += { aggressive: .08, conservative: -.06, unpredictable: (rnd() - .5) * .4, patient: -.02, balanced: 0 }[p.pers];
    const can = !p.noRaise && p.chips > need, sb = this.o.sb;
    const sz = () => Math.min(this.cur + Math.max(this.minRaise, Math.round(pt * (.5 + s * .5) / sb) * sb), p.bet + p.chips);
    let r;
    if (!need) r = can && s > (p.pers === 'aggressive' ? .5 : .62) && rnd() < (hard ? .8 : .6) ? ['raise', sz()] : can && s > .4 && rnd() < .2 ? ['raise', sz()] : ['check'];
    else { const od = need / (pt + need), ok = hard ? s > od * 1.25 + .05 : easy ? s > od * .8 + .05 : s > od * 1.1 + .1; r = !ok ? ['fold'] : can && s > .75 && rnd() < .6 ? ['raise', sz()] : ['call']; }
    if (r[0] === 'raise' && r[1] < this.minTo() && r[1] < p.bet + p.chips) r = need ? ['call'] : ['check'];
    if (r[0] === 'fold' && need >= p.chips && s > .5) r = ['call'];
    if (!this.act(p.id, r[0], r[1]).ok) this.act(p.id, need ? 'call' : 'check');
  }
  // View for one viewer: private cards only for the owner, or revealed at a real showdown.
  view(id) {
    return {
      state: this.state, ver: this.ver, hand: this.hand, phase: this.phase, board: this.board, pot: this.pot(), cur: this.cur, minTo: this.minTo(), bb: this.bb,
      dealer: this.P[this.dealer] ? this.P[this.dealer].id : null, to: this.to >= 0 ? this.P[this.to].id : null, deadline: this.dl, now: Date.now(), win: this.win, say: this.say, hist: this.hist, event: this.event || null,
      players: this.P.map(p => ({
        id: p.id, name: p.name, av: p.av, bot: p.bot, diff: p.diff, pers: p.pers, chips: p.chips, bet: p.bet, folded: p.folded && !p.out, out: p.out, allin: p.allin, connected: p.connected, last: p.last || '',
        hole: p.id === id || (this.reveal && !p.folded) ? p.hole : null, holeCount: p.hole.length
      }))
    };
  }
}
module.exports = { Table, ev5, best, catOf, hname };
