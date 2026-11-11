'use strict';
process.env.PP_FAST = '1';
const { JSDOM } = require('jsdom'); const { server, rooms } = require('../server');
const out = []; let fail = 0;
const ok = (n, c, x = '') => { out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) {} await wait(50); } return false; };
const open = async (port, q = '') => { const d = await JSDOM.fromURL(`http://localhost:${port}/${q}`, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true }); const w = d.window; await until(() => w.ws && w.ws.readyState === 1); return w; };
const faces = (w, sel) => w.document.querySelectorAll(sel + ' .card:not(.bk):not(.em)').length;

(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const A = await open(port), B0 = null;
  ok('index.html served at / and client connects', !!A.document.querySelector('#landing') && A.ws.readyState === 1);
  ok('SVG avatars rendered (no emoji) in picker', A.document.querySelectorAll('#avs svg').length === 10);
  A.document.querySelector('#uname').value = 'Alice'; A.createRoom();
  ok('create room -> lobby shown', await until(() => A.document.querySelector('#lobby').classList.contains('on')));
  const code = A.document.querySelector('#lcode').textContent; ok('room code is 5 chars', code.length === 5);
  const B = await open(port, '?room=' + code);
  ok('invite link prefills code and opens join tab', B.document.querySelector('#code').value === code);
  B.document.querySelector('#uname').value = 'Bob'; B.joinRoom();
  ok('second browser joins same room', await until(() => B.document.querySelector('#lobby').classList.contains('on') && A.document.querySelectorAll('#lpl .pl:not(.empty)').length === 2));
  ok('host controls visible only to host', A.document.querySelector('#host').style.display !== 'none' && B.document.querySelector('#host').style.display === 'none');
  B.send({ t: 'start' }); await until(() => /host/i.test(B.document.querySelector('#toast').textContent));
  ok('non-host start rejected with message', /host/i.test(B.document.querySelector('#toast').textContent));
  A.document.querySelector('#host .pill').click();
  ok('host adds bot; both lobbies update', await until(() => B.document.querySelectorAll('#lpl .pl:not(.empty)').length === 3 && /BOT/.test(B.document.querySelector('#lpl').textContent)));
  A.document.querySelector('#host .play').click();
  ok('game starts on both browsers', await until(() => A.document.querySelector('#game').classList.contains('on') && B.document.querySelector('#game').classList.contains('on') && A.ST_.state === 'hand' && B.ST_.state === 'hand'));
  await until(() => A.document.querySelectorAll('.seat').length === 3 && A.document.querySelector('.seat.me .hc .card'));
  ok('3 seats rendered, 3 SVG avatars', A.document.querySelectorAll('.seat').length === 3 && A.document.querySelectorAll('.seat .av svg').length === 3);
  ok('own two cards visible; opponents show card backs', faces(A, '.seat.me') === 2 && faces(A, '.seat:not(.me)') === 0 && A.document.querySelectorAll('.seat:not(.me) .bk').length === 4);
  const room = [...rooms.values()][0], bobHole = room.table.P.find(p => p.name === 'Bob').hole, aliceHole = room.table.P.find(p => p.name === 'Alice').hole;
  const raw = JSON.stringify(A.ST_), card = c => JSON.stringify(c);
  ok('no leak: Alice\'s received state lacks Bob\'s hole cards', !bobHole.some(c => raw.includes(card(c))) || room.table.reveal);
  ok('no leak: Bob\'s received state lacks Alice\'s hole cards', !aliceHole.some(c => JSON.stringify(B.ST_).includes(card(c))) || room.table.reveal);
  ok('60s countdown shown at the acting human\'s seat', await until(() => { const e = A.document.querySelector('.tmr'); return e && /\d\d:\d\d/.test(e.textContent) && /^(YOUR TURN )?0[01]:\d\d$/.test(e.textContent.trim()); }, 10000));
  // chat + stickers
  A.document.querySelector('#cin').value = 'hello Bob'; A.document.querySelector('#cin').dispatchEvent(new A.KeyboardEvent('keydown', { key: 'Enter' }));
  ok('chat delivered to other browser', await until(() => /hello Bob/.test(B.document.querySelector('#chatlog').textContent)));
  A.sendSt('fire');
  ok('sticker (SVG) appears on other browser', await until(() => B.document.querySelectorAll('#fx .fl svg').length > 0));
  A.sendSt('moon'); ok('sticker cooldown enforced', /cooldown/i.test(A.document.querySelector('#toast').textContent));
  // disconnection / reconnection
  const hand = A.ST_.hand; A.ws.close();
  ok('other browser sees player OFFLINE', await until(() => /OFFLINE/.test(B.document.querySelector('#seats').textContent), 3000));
  ok('auto-reconnect restores seat + own cards', await until(() => A.ws.readyState === 1 && A.ST_ && A.ST_.hand >= hand && A.document.querySelector('#game').classList.contains('on') && (A.ST_.state !== 'hand' || faces(A, '.seat.me') === 2), 8000));
  ok('reconnected player not duplicated', A.ST_.players.length === 3);
  // play real hands through the UI buttons
  const total0 = 3 * 2000; let hands = 0, lastHand = 0, sumOK = true, betAnim = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && hands < 6) {
    for (const w of [A, B]) {
      const s = w.ST_; if (s && s.state === 'hand' && s.to === w.ID) {
        const me = s.players.find(p => p.id === w.ID);
        if (Math.random() < .3 && me.chips > s.minTo - me.bet) { w.document.querySelector('#sMin').click(); w.document.querySelector('#bRaise').click(); } else w.document.querySelector('#bCall').click();
      }
    }
    const s = A.ST_; if (s.state === 'between' && s.players.reduce((a, p) => a + p.chips, 0) !== total0) sumOK = false; hands = s.hist.length; if (s.state === 'over') break;
    await wait(60);
  }
  ok('played ' + hands + ' full hands via UI buttons (betting, bots, showdown)', hands >= 3);
  ok('chip total conserved after every hand seen by the UI', sumOK);
  ok('game history lists finished hands', A.ST_.hist.length >= 1);
  console.log(out.join('\n')); console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  rooms.forEach(r => r.table.stop()); setTimeout(() => process.exit(fail ? 1 : 0), 100);
})().catch(e => { console.log(out.join('\n')); console.log('ERROR', e); process.exit(1); });
