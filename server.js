// ============================================================
// হাজারী (Hazari) — অনলাইন মাল্টিপ্লেয়ার কার্ড গেম সার্ভার
// ============================================================
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// তাস (Card) সহায়ক ফাংশন
// ------------------------------------------------------------
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C']; // Spade, Heart, Diamond, Club

function rankVal(r) {
  if (r === 'A') return 14;
  if (r === 'K') return 13;
  if (r === 'Q') return 12;
  if (r === 'J') return 11;
  if (r === 'T') return 10;
  return parseInt(r, 10);
}

function cardPoints(rank) {
  return ['A', 'K', 'Q', 'J', 'T'].includes(rank) ? 10 : 5;
}

function parseCard(c) {
  return { code: c, rank: c[0], suit: c[1], val: rankVal(c[0]) };
}

function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// বৈধ Run (৩ তাসের ধারাবাহিক ক্রম) তালিকা, সর্বোচ্চ থেকে সর্বনিম্ন
const RUN_TABLE = [
  { vals: [14, 13, 12], score: 100 }, // A-K-Q  (সর্বোচ্চ)
  { vals: [14, 3, 2], score: 99 },    // A-2-3
  { vals: [13, 12, 11], score: 13 },  // K-Q-J
  { vals: [12, 11, 10], score: 12 },
  { vals: [11, 10, 9], score: 11 },
  { vals: [10, 9, 8], score: 10 },
  { vals: [9, 8, 7], score: 9 },
  { vals: [8, 7, 6], score: 8 },
  { vals: [7, 6, 5], score: 7 },
  { vals: [6, 5, 4], score: 6 },
  { vals: [5, 4, 3], score: 5 },
  { vals: [4, 3, 2], score: 4 },      // ৪-৩-২ (সর্বনিম্ন)
];

const TYPE_LABEL = {
  6: 'ট্রয় (Troy)',
  5: 'কালার রান (Colour Run)',
  4: 'রান (Run)',
  3: 'কালার (Colour)',
  2: 'পেয়ার (Pair)',
  1: 'ইন্ডি (Indi)',
};

// ৩টি তাসের কম্বিনেশন মূল্যায়ন করে
function evaluate3(cardCodes) {
  const cards = cardCodes.map(parseCard);
  const sorted = cards.slice().sort((a, b) => b.val - a.val);
  const vals = sorted.map((c) => c.val);
  const sameSuit = sorted[0].suit === sorted[1].suit && sorted[1].suit === sorted[2].suit;

  // Troy
  if (vals[0] === vals[1] && vals[1] === vals[2]) {
    return { type: 6, tiebreak: [vals[0]], label: TYPE_LABEL[6], cards: cardCodes };
  }

  // Run / Colour Run
  const run = RUN_TABLE.find(
    (r) => r.vals[0] === vals[0] && r.vals[1] === vals[1] && r.vals[2] === vals[2]
  );
  if (run) {
    const type = sameSuit ? 5 : 4;
    return { type, tiebreak: [run.score], label: TYPE_LABEL[type], cards: cardCodes };
  }

  // Colour
  if (sameSuit) {
    return { type: 3, tiebreak: vals, label: TYPE_LABEL[3], cards: cardCodes };
  }

  // Pair
  if (vals[0] === vals[1]) {
    return { type: 2, tiebreak: [vals[0], vals[2]], label: TYPE_LABEL[2], cards: cardCodes };
  }
  if (vals[1] === vals[2]) {
    return { type: 2, tiebreak: [vals[1], vals[0]], label: TYPE_LABEL[2], cards: cardCodes };
  }

  // Indi
  return { type: 1, tiebreak: vals, label: TYPE_LABEL[1], cards: cardCodes };
}

// ৪টি তাস থেকে সেরা ৩-তাসের কম্বিনেশন বের করে (৪র্থ রাউন্ডের গ্রুপের জন্য)
function bestOf4(cardCodes) {
  const combos = [
    [cardCodes[0], cardCodes[1], cardCodes[2]],
    [cardCodes[0], cardCodes[1], cardCodes[3]],
    [cardCodes[0], cardCodes[2], cardCodes[3]],
    [cardCodes[1], cardCodes[2], cardCodes[3]],
  ];
  let best = null;
  for (const c of combos) {
    const ev = evaluate3(c);
    if (!best || compareCombo(ev, best) > 0) best = ev;
  }
  best.cards = cardCodes; // পুরো ৪ তাস মনে রাখি (পয়েন্টের জন্য)
  return best;
}

// দুটি কম্বিনেশন তুলনা করে: a>b হলে ধনাত্মক, a<b হলে ঋণাত্মক, সমান হলে ০
function compareCombo(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < a.tiebreak.length; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

function totalPoints(cardCodes) {
  return cardCodes.reduce((sum, c) => sum + cardPoints(c[0]), 0);
}

// সাধারণ বুদ্ধিদীপ্ত অটো-অ্যারেঞ্জ: দুর্বল ৪টি তাস গ্রুপ-৪ এ, বাকি ৯টি
// তাস থেকে জোড়া/রান মিলিয়ে ৩টি গ্রুপ বানায়।
function autoArrange(hand) {
  const cards = hand.map(parseCard).sort((a, b) => b.val - a.val);
  const group4 = cards.slice(cards.length - 4).map((c) => c.code);
  let rest = cards.slice(0, cards.length - 4);

  const groups = [];
  while (rest.length > 0) {
    if (rest.length === 3) {
      groups.push(rest.map((c) => c.code));
      rest = [];
      break;
    }
    // একই suit এর জোড়া/রান খোঁজার চেষ্টা করি সেরা প্রথম তাসের সাথে
    let bestIdx = null;
    let bestEval = null;
    for (let i = 1; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const trio = [rest[0].code, rest[i].code, rest[j].code];
        const ev = evaluate3(trio);
        if (!bestEval || compareCombo(ev, bestEval) > 0) {
          bestEval = ev;
          bestIdx = [i, j];
        }
      }
    }
    const picked = [rest[0], rest[bestIdx[0]], rest[bestIdx[1]]];
    groups.push(picked.map((c) => c.code));
    rest = rest.filter((c) => !picked.includes(c));
  }
  // groups[] এ এখন ৩টি ৩-কার্ড গ্রুপ; শক্তি অনুযায়ী descending সাজাই
  groups.sort((a, b) => compareCombo(evaluate3(a), evaluate3(b))).reverse();
  return [group4, groups[0], groups[1], groups[2]];
}

// ------------------------------------------------------------
// রুম ম্যানেজমেন্ট
// ------------------------------------------------------------
const rooms = {}; // code -> room object

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function genPlayerId() {
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function newRoom(code, hostId) {
  return {
    code,
    hostId,
    players: [null, null, null, null], // seat 0..3 -> player object
    phase: 'lobby', // lobby | arranging | revealing
    dealerIndex: 0,
    hands: {}, // playerId -> [13 cards]
    groups: {}, // playerId -> [g4,g1,g2,g3]
    ready: {}, // playerId -> bool
    scores: {}, // playerId -> total score
  };
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    dealerIndex: room.dealerIndex,
    players: room.players.map((p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            isBot: !!p.isBot,
            connected: !!p.connected,
            score: room.scores[p.id] || 0,
            ready: !!room.ready[p.id],
          }
        : null
    ),
  };
}

function emitRoomState(room) {
  io.to(room.code).emit('room_state', publicRoomState(room));
}

function findRoomByPlayer(playerId) {
  return Object.values(rooms).find((r) => r.players.some((p) => p && p.id === playerId));
}

// ------------------------------------------------------------
// একটি নতুন হাত ডিল করা
// ------------------------------------------------------------
function dealHand(room) {
  const deck = shuffle(freshDeck());
  room.hands = {};
  room.groups = {};
  room.ready = {};
  room.phase = 'arranging';
  room.players.forEach((p, seat) => {
    if (!p) return;
    const hand = deck.slice(seat * 13, seat * 13 + 13);
    room.hands[p.id] = hand;
    room.ready[p.id] = false;
    if (p.isBot) {
      const g = autoArrange(hand);
      room.groups[p.id] = g;
      room.ready[p.id] = true;
    }
  });
  room.players.forEach((p) => {
    if (!p) return;
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit('your_hand', { hand: room.hands[p.id] });
  });
  emitRoomState(room);
  maybeResolveHand(room);
}

// সব খেলোয়াড় প্রস্তুত হলে পুরো হাত হিসাব করে ফলাফল পাঠানো
function maybeResolveHand(room) {
  const activeIds = room.players.filter(Boolean).map((p) => p.id);
  if (!activeIds.every((id) => room.ready[id])) return;

  room.phase = 'revealing';

  // প্রতিটি খেলোয়াড়ের জন্য রাউন্ড ১-৩ (৩-কার্ড গ্রুপ, শক্তি অনুযায়ী সাজানো) + রাউন্ড ৪ (৪-কার্ড গ্রুপ)
  const perPlayer = {};
  activeIds.forEach((id) => {
    const [g4, g1, g2, g3] = room.groups[id];
    const evals = [g1, g2, g3].map((g) => evaluate3(g));
    const order = [0, 1, 2].sort((a, b) => compareCombo(evals[b], evals[a]));
    const ordered3 = order.map((i) => ({ cards: [g1, g2, g3][i], eval: evals[i] }));
    perPlayer[id] = {
      round1: ordered3[0],
      round2: ordered3[1],
      round3: ordered3[2],
      round4: { cards: g4, eval: bestOf4(g4) },
    };
  });

  // seat order (ডিলারের ডানদিক থেকে শুরু), টাই ভাঙতে ব্যবহৃত হয় (পরে খেলা মানেই জেতে)
  const seatOrder = [];
  for (let i = 0; i < 4; i++) {
    const seat = (room.dealerIndex + 1 + i) % 4;
    if (room.players[seat]) seatOrder.push(room.players[seat].id);
  }

  const rounds = [];
  ['round1', 'round2', 'round3', 'round4'].forEach((rk) => {
    const plays = seatOrder.map((id) => ({
      playerId: id,
      cards: perPlayer[id][rk].cards,
      eval: perPlayer[id][rk].eval,
    }));
    let winner = plays[0];
    for (let i = 1; i < plays.length; i++) {
      const cmp = compareCombo(plays[i].eval, winner.eval);
      if (cmp >= 0) winner = plays[i]; // সমান হলে পরে খেলা তাসই জেতে
    }
    const pointsAll = plays.reduce((s, p) => s + totalPoints(p.cards), 0);
    room.scores[winner.playerId] = (room.scores[winner.playerId] || 0) + pointsAll;
    rounds.push({
      plays: plays.map((p) => ({
        playerId: p.playerId,
        cards: p.cards,
        type: p.eval.label,
      })),
      winnerId: winner.playerId,
      points: pointsAll,
    });
  });

  const finalScores = {};
  activeIds.forEach((id) => (finalScores[id] = room.scores[id] || 0));
  const gameOver = Object.values(finalScores).some((s) => s >= 1000);
  const maxScore = Math.max(...Object.values(finalScores));
  const winnerId = gameOver
    ? activeIds.find((id) => finalScores[id] === maxScore)
    : null;

  io.to(room.code).emit('hand_result', {
    rounds,
    scores: finalScores,
    gameOver,
    winnerId,
    winnerName: winnerId ? (room.players.find((p) => p && p.id === winnerId) || {}).name : null,
  });

  room.dealerIndex = (room.dealerIndex + 1) % 4;
  room.phase = gameOver ? 'lobby' : 'lobby'; // পরের হাত হোস্ট চালু করবে
  if (gameOver) {
    room.scores = {};
  }
  emitRoomState(room);
}

// ------------------------------------------------------------
// Socket.io ইভেন্ট হ্যান্ডলিং
// ------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    const code = genRoomCode();
    const playerId = genPlayerId();
    const room = newRoom(code, playerId);
    room.players[0] = { id: playerId, name: (name || 'খেলোয়াড়').slice(0, 20), socketId: socket.id, isBot: false, connected: true };
    room.scores[playerId] = 0;
    rooms[code] = room;
    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    cb({ ok: true, code, playerId });
    emitRoomState(room);
  });

  socket.on('join_room', ({ code, name, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'রুম খুঁজে পাওয়া যায়নি।' });

    // rejoin চেষ্টা
    if (playerId) {
      const seat = room.players.findIndex((p) => p && p.id === playerId);
      if (seat !== -1) {
        room.players[seat].socketId = socket.id;
        room.players[seat].connected = true;
        socket.join(code);
        socket.data.playerId = playerId;
        socket.data.roomCode = code;
        cb({ ok: true, code, playerId, rejoined: true });
        if (room.phase === 'arranging' && room.hands[playerId]) {
          socket.emit('your_hand', { hand: room.hands[playerId] });
        }
        emitRoomState(room);
        return;
      }
    }

    const emptySeat = room.players.findIndex((p) => p === null);
    if (emptySeat === -1) return cb({ ok: false, error: 'রুম পূর্ণ (৪ জন)।' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'গেম ইতিমধ্যে চলছে।' });

    const newId = genPlayerId();
    room.players[emptySeat] = { id: newId, name: (name || 'খেলোয়াড়').slice(0, 20), socketId: socket.id, isBot: false, connected: true };
    room.scores[newId] = 0;
    socket.join(code);
    socket.data.playerId = newId;
    socket.data.roomCode = code;
    cb({ ok: true, code, playerId: newId });
    emitRoomState(room);
  });

  socket.on('add_bot', ({ code }) => {
    const room = rooms[code];
    if (!room || socket.data.playerId !== room.hostId) return;
    const emptySeat = room.players.findIndex((p) => p === null);
    if (emptySeat === -1) return;
    const botId = genPlayerId();
    const botNames = ['বট রনি', 'বট সোহান', 'বট মিতা', 'বট জয়'];
    room.players[emptySeat] = { id: botId, name: botNames[emptySeat], socketId: null, isBot: true, connected: true };
    room.scores[botId] = 0;
    emitRoomState(room);
  });

  socket.on('remove_player', ({ code, seat }) => {
    const room = rooms[code];
    if (!room || socket.data.playerId !== room.hostId) return;
    if (room.phase !== 'lobby') return;
    if (room.players[seat] && room.players[seat].id !== room.hostId) {
      room.players[seat] = null;
      emitRoomState(room);
    }
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room || socket.data.playerId !== room.hostId) return;
    if (room.players.some((p) => p === null)) return;
    dealHand(room);
  });

  socket.on('next_hand', ({ code }) => {
    const room = rooms[code];
    if (!room || socket.data.playerId !== room.hostId) return;
    dealHand(room);
  });

  socket.on('submit_groups', ({ code, groups }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'arranging') return;
    const playerId = socket.data.playerId;
    const hand = room.hands[playerId];
    if (!hand) return;
    // যাচাই: সাইজ [4,3,3,3] এবং তাস মিলিয়ে দেখা
    if (!Array.isArray(groups) || groups.length !== 4) return;
    const sizes = groups.map((g) => g.length);
    if (sizes[0] !== 4 || sizes[1] !== 3 || sizes[2] !== 3 || sizes[3] !== 3) return;
    const flat = groups.flat();
    const a = flat.slice().sort();
    const b = hand.slice().sort();
    if (a.length !== b.length || !a.every((v, i) => v === b[i])) return;

    room.groups[playerId] = groups;
    room.ready[playerId] = true;
    emitRoomState(room);
    maybeResolveHand(room);
  });

  socket.on('leave_room', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const seat = room.players.findIndex((p) => p && p.id === playerId);
  if (seat === -1) return;

  if (room.phase === 'lobby') {
    room.players[seat] = null;
    if (playerId === room.hostId) {
      const next = room.players.find(Boolean);
      if (next) room.hostId = next.id;
      else {
        delete rooms[code];
        return;
      }
    }
  } else {
    // গেম চলাকালীন সংযোগ বিচ্ছিন্ন হলে — আসন ধরে রাখি, বট হিসেবে অটো-আরেঞ্জ করে দিই
    room.players[seat].connected = false;
    if (room.phase === 'arranging' && !room.ready[playerId]) {
      const g = autoArrange(room.hands[playerId]);
      room.groups[playerId] = g;
      room.ready[playerId] = true;
      maybeResolveHand(room);
    }
  }
  emitRoomState(room);
}

server.listen(PORT, () => {
  console.log(`হাজারী সার্ভার চলছে: http://localhost:${PORT}`);
});
