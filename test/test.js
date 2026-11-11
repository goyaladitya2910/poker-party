'use strict';
const assert = require('assert'), WebSocket = require('ws');
const { Table, ev5, best, catOf, hname } = require('../engine');
const { server, pub } = require('../server');
const C = (s) => s.split(' ').map(x => ({ r: '23456789TJQKA'.indexOf(x[0]) + 2, s: 'shdc'.indexOf(x[1]) }));
const out = [];
const ok = (n, f) => Promise.resolve().then(f).then(() => out.push('PASS ' + n), e => { out.push('FAIL ' + n + ': ' + e.message); process.exitCode = 1; });

(async () => {
  await ok('hand ranks incl. wheel, royal, kickers, ties', () => {
    assert.equal(hname(ev5(C('As Ks Qs Js Ts'))), 'Royal Flush');
    assert.equal(catOf(ev5(C('5s 4h 3d 2c As'))), 4);
    assert(ev5(C('6s 5h 4d 3c 2s')) > ev5(C('5s 4h 3d 2c As')), 'wheel is lowest straight');
    assert.equal(catOf(ev5(C('Qs Kh Ad 2c 3s'))), 0, 'no wraparound straight');
    assert(ev5(C('Ks Kh Kd 2c 2s')) > ev5(C('Qs Qh Qd Ac As')));
    assert(ev5(C('As Ah Kd Qc 2s')) > ev5(C('As Ah Kd Jc Ts')), 'kicker');
    assert.equal(ev5(C('As Kh Qd Jc 9s')), ev5(C('Ah Kd Qc Js 9h')), 'suits never break ties');
    assert.equal(catOf(best(C('As Ah Ad Ks Kh 2c 3d'))), 6);
  });

  await ok('chips conserved over 60 all-bot hands (fast mode)', async () => {
    const t = new Table({ chips: 500, sb: 10, fast: true }, () => {});
    ['easy', 'medium', 'hard', 'hard', 'medium', 'easy'].forEach(d => t.addBot(d));
    const total = 500 * 6; t.start();
    await new Promise((res, rej) => { const iv = setInterval(() => { if (t.state === 'between' || t.state === 'over') { if (t.P.reduce((a, p) => a + p.chips, 0) !== total) { clearInterval(iv); rej(new Error('chips changed at hand ' + t.hand)); } } if ((t.hand >= 60 && t.state === 'between') || t.state === 'over') { clearInterval(iv); res(); } }, 2); });
    t.stop(); assert.equal(t.P.reduce((a, p) => a + p.chips, 0), total);
    out.push('  (played ' + t.hand + ' hands)');
  });

  await ok('side pot + uncalled bet: 3 all-ins of different sizes', () => {
    const t = new Table({ chips: 1000, sb: 10, fast: true }, () => {});
    t.P = [100, 300, 1000].map((c, i) => ({ id: 'p' + i, name: 'p' + i, chips: 0, hole: [], bet: 0, total: [100, 300, 700][i], folded: false, allin: false, acted: false, noRaise: false, out: false }));
    t.P[0].chips = 0; t.dealer = 2; t.state = 'hand'; t.board = C('2c 7d 9h Js 3s');
    t.P[0].hole = C('As Ah'); t.P[1].hole = C('Ks Kh'); t.P[2].hole = C('Qs Qh');
    t.award(true); t.stop();
    assert.deepEqual(t.P.map(p => p.chips), [300, 400, 400], 'AA wins main 300, KK side 400, uncalled 400 back to QQ');
  });

  await ok('split pot odd chip stays in play', () => {
    const t = new Table({ fast: true }, () => {});
    t.P = [0, 1, 2].map(i => ({ id: 'p' + i, name: 'p' + i, chips: 0, hole: C(i < 2 ? (i ? 'Ad 3h' : 'Ac 3d') : '2c 4d'), bet: 0, total: 33, folded: false, allin: false, out: false }));
    t.dealer = 2; t.state = 'hand'; t.board = C('Ks Kh Qd Jc 9s'); t.award(true); t.stop();
    assert.equal(t.P.reduce((a, p) => a + p.chips, 0), 99); assert.equal(t.P[2].chips, 0);
  });

  await ok('heads-up blinds/order, illegal actions rejected, min raise', () => {
    const t = new Table({ chips: 1000, sb: 10, turnMs: 60000 }, () => {});
    t.add('a', 'A', 'x'); t.add('b', 'B', 'x'); t.start(); t.stop();
    const sb = t.P[t.dealer]; assert.equal(t.P[t.to], sb, 'dealer/SB acts first pre-flop'); assert.equal(sb.bet, 10);
    const other = t.P.find(p => p !== sb);
    assert(!t.act(other.id, 'call').ok, 'out of turn');
    assert(!t.act(sb.id, 'check').ok, 'cannot check facing BB');
    assert(!t.act(sb.id, 'raise', 25).ok, 'below min raise');
    assert(!t.act(sb.id, 'raise', 99999).ok, 'more than stack');
    assert(!t.act(sb.id, 'raise', 30.5).ok, 'fraction');
    assert(t.act(sb.id, 'raise', 60).ok); clearTimeout(t.hT); t.stop();
    assert.equal(sb.bet, 60); assert.equal(sb.chips, 940);
  });

  await ok('server-side 60s timeout auto-folds', async () => {
    const t = new Table({ chips: 1000, sb: 10, turnMs: 150, fast: true }, () => {});
    t.add('a', 'A', 'x'); t.add('b', 'B', 'x'); t.start();
    const h = t.hand; await new Promise(r => setTimeout(r, 400));
    assert(t.state === 'between' || t.hand > h, 'hand ended by timeout'); t.stop();
  });

  await ok('multiplayer over WebSocket: hidden cards, host-only, stale ver, reconnect', async () => {
    await new Promise(r => server.listen(0, r)); const port = server.address().port;
    const conn = () => new Promise(r => { const ws = new WebSocket('ws://localhost:' + port); ws.msgs = []; ws.on('message', d => ws.msgs.push(JSON.parse(d))); ws.on('open', () => r(ws)); });
    const last = (ws, t) => [...ws.msgs].reverse().find(m => m.t === t); const sl = () => new Promise(r => setTimeout(r, 80));
    const A = await conn(), B = await conn();
    A.send(JSON.stringify({ t: 'create', token: 'token-alice-0001', name: 'Alice', av: 'cat' })); await sl();
    const code = last(A, 'state').code; assert.equal(code.length, 5);
    B.send(JSON.stringify({ t: 'join', code: 'ZZZZZ', token: 'token-bob-00001', name: 'Bob' })); await sl();
    assert.equal(last(B, 'error').msg, 'Room not found');
    B.send(JSON.stringify({ t: 'join', code, token: 'token-bob-00001', name: 'Bob', av: 'owl' })); await sl();
    B.send(JSON.stringify({ t: 'start' })); await sl(); assert(/host/.test(last(B, 'error').msg));
    A.send(JSON.stringify({ t: 'start' })); await sl();
    const sa = last(A, 'state').s, sb = last(B, 'state').s;
    const meA = sa.players.find(p => p.id === pub('token-alice-0001')), othA = sa.players.find(p => p.id === pub('token-bob-00001'));
    assert(meA.hole && meA.hole.length === 2, 'owner sees own cards'); assert.equal(othA.hole, null, 'opponent cards hidden');
    assert(!JSON.stringify(sa).includes(JSON.stringify(sb.players.find(p => p.id === pub('token-bob-00001')).hole)), 'no leak of opponent cards');
    assert(!JSON.stringify(sa).includes('token-bob-00001') && !JSON.stringify(sb).includes('token-alice-0001'), 'session tokens are never sent to other players');
    const actor = sa.to === pub('token-alice-0001') ? A : B, waiter = actor === A ? B : A;
    waiter.send(JSON.stringify({ t: 'act', type: 'call', ver: sa.ver })); await sl(); assert.equal(last(waiter, 'error').msg, 'Not your turn');
    actor.send(JSON.stringify({ t: 'act', type: 'call', ver: sa.ver - 1 })); await sl(); assert(/Stale/.test(last(actor, 'error').msg));
    // reconnect same token keeps seat and cards
    const A2 = await conn(); A.close(); A2.send(JSON.stringify({ t: 'join', code, token: 'token-alice-0001', name: 'x' })); await sl();
    const r = last(A2, 'state').s.players.find(p => p.id === pub('token-alice-0001')); assert.equal(r.hole.length, 2); assert.equal(last(A2, 'state').s.players.length, 2);
    [A2, B].forEach(w => w.close()); server.close(); require('../server').rooms.forEach(rm => rm.table.stop());
  });
  console.log(out.join('\n')); setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
