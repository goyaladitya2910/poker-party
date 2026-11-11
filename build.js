// Assembles public/index.html: reuses the prototype's stylesheet + new multiplayer client.
const fs=require('fs');const proto=fs.readFileSync(__dirname+'/public/prototype-singleplayer.html','utf8');
const style=proto.match(/<style>([\s\S]*?)<\/style>/)[1];
fs.writeFileSync(__dirname+'/public/index.html',fs.readFileSync(__dirname+'/src/index.tpl.html','utf8').replace('{{STYLE}}',()=>style));
console.log('built public/index.html');
