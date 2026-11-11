# POKER PARTY
Free multiplayer Texas Hold'em (virtual chips only). Server-authoritative poker, private rooms with 5-letter codes and invite links, bots, chat, SVG stickers, 5 themes.

## Play on your own computer
1. Install Node.js 18+ (nodejs.org).  2. In this folder: `npm install` then `npm start`.  3. Open http://localhost:3000. Friends on the same Wi-Fi can use http://YOUR-COMPUTER-IP:3000.

## Put it online for free (Render)
1. Upload this folder to a GitHub repository.  2. On render.com choose New > Blueprint, pick the repository (render.yaml configures everything, free plan).  3. Share the URL Render gives you.
Free-plan limits (from Render's docs): sleeps after 15 min without traffic and takes about 1 min to wake; 750 free hours/month; rooms live in memory, so a restart or sleep ends all games.

## Tests
`npm install` then `npm test` (poker engine + server) and `npm run test:integration` (two simulated browsers against the real server). `npm run build` regenerates public/index.html from src/ and the prototype stylesheet.

## Files
engine.js (rules, bots, timers) · server.js (rooms, WebSocket) · src/index.tpl.html + build.js -> public/index.html (client) · test/
