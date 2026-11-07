const http = require("http"), fs = require("fs"), path = require("path");
const { WebSocketServer } = require("ws");

const CARDS = {
  sword: { n: "ฟันดาบ", c: 1, t: "dmg", v: 3 }, fire: { n: "ลูกไฟ", c: 2, t: "dmg", v: 5 },
  bolt: { n: "สายฟ้า", c: 3, t: "dmg", v: 7 }, bomb: { n: "ระเบิด", c: 4, t: "dmg", v: 10 },
  heal: { n: "ยาฮีล", c: 2, t: "heal", v: 4 }, shield: { n: "โล่", c: 1, t: "shd", v: 3 },
  drain: { n: "ดูดเลือด", c: 2, t: "drain", v: 3 },
};
const POOL = ["sword","sword","sword","fire","fire","bolt","bomb","heal","heal","shield","shield","drain"];
const draw = () => POOL[Math.floor(Math.random() * POOL.length)];
const newPlayer = (name) => ({ name, hp: 20, max: 0, mana: 0, shield: 0, hand: [draw(), draw(), draw(), draw()] });
const push = (s, t) => { s.log.push(t); s.log = s.log.slice(-6); };
const hit = (t, v) => { const a = Math.min(t.shield, v); t.shield -= a; t.hp = Math.max(0, t.hp - (v - a)); };

function startGame(room) {
  const [a, b] = [newPlayer(room.names[0]), newPlayer(room.names[1])];
  a.max = 1; a.mana = 1;
  room.s = { status: "play", turn: 0, winner: null, p: [a, b], log: ["เริ่มเกม! " + a.name + " เล่นก่อน"] };
}

function broadcast(room) {
  room.socks.forEach((ws, i) => {
    if (!ws || ws.readyState !== 1) return;
    if (!room.s) return ws.send(JSON.stringify({ t: "wait", code: room.code }));
    const v = JSON.parse(JSON.stringify(room.s));
    v.p[1 - i].hand = v.p[1 - i].hand.map(() => "?");
    ws.send(JSON.stringify({ t: "state", me: i, code: room.code, s: v }));
  });
}

const rooms = {};
const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, "public", "index.html"), (e, d) => {
    res.writeHead(e ? 500 : 200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(e ? "error" : d);
  });
});
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let room = null, me = -1;
  const err = (m) => ws.send(JSON.stringify({ t: "err", m }));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const name = String(m.name || "ผู้เล่น").slice(0, 14);
    if (m.t === "create") {
      let code; do { code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""); } while (rooms[code]);
      room = rooms[code] = { code, names: [name, ""], socks: [ws, null], s: null }; me = 0;
      return broadcast(room);
    }
    if (m.t === "join") {
      const r = rooms[String(m.code || "").toUpperCase()];
      if (!r) return err("ไม่พบห้องนี้");
      if (r.socks[1] && r.socks[1].readyState === 1) return err("ห้องนี้เต็มแล้ว");
      room = r; me = 1; r.socks[1] = ws; r.names[1] = name; startGame(r);
      return broadcast(r);
    }
    if (!room || !room.s) return;
    const s = room.s;
    if (m.t === "rematch" && s.status === "over") { startGame(room); return broadcast(room); }
    if (s.status !== "play" || s.turn !== me) return;
    const a = s.p[me], b = s.p[1 - me];
    if (m.t === "play") {
      const k = a.hand[m.i], c = CARDS[k];
      if (!c || a.mana < c.c) return;
      a.mana -= c.c; a.hand.splice(m.i, 1);
      if (c.t === "dmg") { hit(b, c.v); push(s, `${a.name} ใช้ ${c.n} โจมตี ${c.v}`); }
      else if (c.t === "heal") { a.hp = Math.min(20, a.hp + c.v); push(s, `${a.name} ใช้ ${c.n} ฟื้น ${c.v} HP`); }
      else if (c.t === "shd") { a.shield += c.v; push(s, `${a.name} ใช้ ${c.n} ได้โล่ ${c.v}`); }
      else { hit(b, c.v); a.hp = Math.min(20, a.hp + c.v); push(s, `${a.name} ใช้ ${c.n} ตีและดูดเลือด ${c.v}`); }
      if (b.hp <= 0) { s.status = "over"; s.winner = me; push(s, "🏆 " + a.name + " ชนะ!"); }
    } else if (m.t === "end") {
      s.turn = 1 - me; const n = s.p[s.turn];
      n.max = Math.min(10, n.max + 1); n.mana = n.max;
      if (n.hand.length < 5) n.hand.push(draw());
      push(s, "ตาของ " + n.name);
    } else return;
    broadcast(room);
  });
  ws.on("close", () => {
    if (!room) return;
    room.socks[me] = null;
    const other = room.socks[1 - me];
    if (other && other.readyState === 1) other.send(JSON.stringify({ t: "err", m: "เพื่อนออกจากห้องแล้ว" }));
    if (!room.socks.some((x) => x)) delete rooms[room.code];
  });
});

server.listen(process.env.PORT || 3000, () => console.log("running"));
