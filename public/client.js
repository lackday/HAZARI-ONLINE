// ============================================================
// হাজারী — ক্লায়েন্ট সাইড লজিক
// ============================================================
const socket = io();

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_RED = { H: 1, D: 1 };
const RANK_DISPLAY = { T: '10' };

function rankDisplay(r) { return RANK_DISPLAY[r] || r; }

function cardHTML(code, { mini } = {}) {
  const rank = code[0], suit = code[1];
  const cls = ['card'];
  if (mini) cls.push('mini');
  if (SUIT_RED[suit]) cls.push('red');
  return `<div class="${cls.join(' ')}" data-code="${code}">
    <div class="rank">${rankDisplay(rank)}</div>
    <div class="suit">${SUIT_SYMBOL[suit]}</div>
  </div>`;
}

// ------------------------------------------------------------
// সেশন (localStorage) — পুনরায় সংযোগের জন্য
// ------------------------------------------------------------
const SESSION_KEY = 'hazari_session_v1';
function saveSession(data) { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

let myPlayerId = null;
let myName = '';
let myRoomCode = null;
let lastRoomState = null;

// ------------------------------------------------------------
// স্ক্রিন নেভিগেশন
// ------------------------------------------------------------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

function updateRoomBadge() {
  const badge = document.getElementById('roomBadge');
  if (myRoomCode) {
    badge.classList.remove('hidden');
    document.getElementById('roomCodeLabel').textContent = myRoomCode;
  } else {
    badge.classList.add('hidden');
  }
}

// ------------------------------------------------------------
// হোম স্ক্রিন
// ------------------------------------------------------------
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const homeError = document.getElementById('homeError');

const savedSession = loadSession();
if (savedSession && savedSession.name) nameInput.value = savedSession.name;

function showHomeError(msg) {
  homeError.textContent = msg;
  homeError.classList.remove('hidden');
}

document.getElementById('btnCreate').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'খেলোয়াড়';
  myName = name;
  socket.emit('create_room', { name }, (res) => {
    if (!res.ok) return showHomeError(res.error || 'ত্রুটি হয়েছে।');
    myPlayerId = res.playerId;
    myRoomCode = res.code;
    saveSession({ name, roomCode: res.code, playerId: res.playerId });
    updateRoomBadge();
    showScreen('lobby');
  });
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'খেলোয়াড়';
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return showHomeError('রুম কোড দিন।');
  myName = name;
  socket.emit('join_room', { code, name }, (res) => {
    if (!res.ok) return showHomeError(res.error || 'যোগ দেওয়া যায়নি।');
    myPlayerId = res.playerId;
    myRoomCode = res.code;
    saveSession({ name, roomCode: res.code, playerId: res.playerId });
    updateRoomBadge();
    showScreen('lobby');
  });
});

// ------------------------------------------------------------
// লবি স্ক্রিন
// ------------------------------------------------------------
document.getElementById('btnCopyCode').addEventListener('click', () => {
  if (!myRoomCode) return;
  navigator.clipboard?.writeText(myRoomCode).catch(() => {});
  const btn = document.getElementById('btnCopyCode');
  const old = btn.textContent;
  btn.textContent = '✅ কপি হয়েছে';
  setTimeout(() => (btn.textContent = old), 1200);
});

document.getElementById('btnStart').addEventListener('click', () => {
  socket.emit('start_game', { code: myRoomCode });
});

document.getElementById('btnLeaveLobby').addEventListener('click', () => {
  socket.emit('leave_room');
  myRoomCode = null;
  clearSession();
  updateRoomBadge();
  showScreen('home');
});

document.getElementById('btnBackHome').addEventListener('click', () => {
  socket.emit('leave_room');
  myRoomCode = null;
  clearSession();
  updateRoomBadge();
  showScreen('home');
});

function renderLobby(state) {
  document.getElementById('shareCode').textContent = state.code;
  const isHost = state.hostId === myPlayerId;
  const seatList = document.getElementById('seatList');
  seatList.innerHTML = '';
  state.players.forEach((p, seat) => {
    const div = document.createElement('div');
    if (p) {
      div.className = 'seat';
      div.innerHTML = `<span class="seat-name">${seat + 1}. ${escapeHTML(p.name)}
          ${p.isBot ? '<span class="seat-tag">বট</span>' : ''}
          ${!p.connected ? '<span class="seat-tag">অফলাইন</span>' : ''}
          ${p.id === state.hostId ? '<span class="seat-tag">হোস্ট</span>' : ''}</span>`;
      if (isHost && p.id !== state.hostId) {
        const btn = document.createElement('button');
        btn.className = 'btn tiny';
        btn.textContent = 'বাদ দিন';
        btn.style.marginBottom = '0';
        btn.addEventListener('click', () => socket.emit('remove_player', { code: state.code, seat }));
        div.appendChild(btn);
      }
    } else {
      div.className = 'seat empty';
      div.innerHTML = `<span>${seat + 1}. আসন খালি</span>`;
      if (isHost) {
        const btn = document.createElement('button');
        btn.className = 'btn tiny';
        btn.textContent = '🤖 বট যোগ করুন';
        btn.style.marginBottom = '0';
        btn.addEventListener('click', () => socket.emit('add_bot', { code: state.code }));
        div.appendChild(btn);
      }
    }
    seatList.appendChild(div);
  });

  const allFilled = state.players.every(Boolean);
  document.getElementById('btnStart').disabled = !(isHost && allFilled);
  document.getElementById('lobbyHint').textContent = isHost
    ? (allFilled ? 'সবাই প্রস্তুত — গেম শুরু করুন!' : 'ফাঁকা আসনে বন্ধুকে যোগ দিতে বলুন অথবা বট যোগ করুন।')
    : 'হোস্ট গেম শুরু করার অপেক্ষায় থাকুন...';
}

function escapeHTML(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------
// স্কোরবোর্ড (গেম ও রিভিল স্ক্রিনে শেয়ার করা)
// ------------------------------------------------------------
function renderScoreboard(state) {
  const html = state.players
    .filter(Boolean)
    .map((p) => `<div class="score-chip">${escapeHTML(p.name)}: <b>${p.score}</b></div>`)
    .join('');
  document.getElementById('scoreboard2').innerHTML = html;
}

// ---- টেবিলে প্রতিপক্ষদের আসন সাজিয়ে দেখানো (আমি সবসময় নিচে) ----
function seatInitial(p) {
  if (p.isBot) return '🤖';
  return (p.name || '?').trim().slice(0, 1).toUpperCase();
}

function renderOppSeats(state) {
  const area = document.getElementById('oppSeats');
  if (!area) return;
  const mySeat = state.players.findIndex((p) => p && p.id === myPlayerId);
  const order = [1, 2, 3].map((off) => state.players[(mySeat + off + 4) % 4]);

  area.innerHTML = order
    .map((p) => {
      if (!p) {
        return `<div class="opp-seat empty"><div class="opp-avatar">?</div><div class="opp-name">খালি আসন</div></div>`;
      }
      const statusHTML = p.ready
        ? `<span class="opp-status ready">✅ প্রস্তুত</span>`
        : `<span class="opp-status waiting">⏳ সাজাচ্ছে...</span>`;
      const fan = '<div class="card back"></div>'.repeat(4);
      return `<div class="opp-seat ${p.isBot ? 'bot' : ''}">
        <div class="opp-avatar">${seatInitial(p)}</div>
        <div class="opp-name">${escapeHTML(p.name)}${!p.connected ? ' 📴' : ''}</div>
        ${statusHTML}
        <div class="opp-fan">${fan}</div>
      </div>`;
    })
    .join('');

  const me = state.players.find((p) => p && p.id === myPlayerId);
  const chip = document.getElementById('myScoreChip');
  if (chip && me) chip.textContent = `স্কোর: ${me.score}`;
}

// ------------------------------------------------------------
// গেম স্ক্রিন — তাস সাজানো
// ------------------------------------------------------------
const GROUP_SIZES = [4, 3, 3, 3];
let handCards = [];        // এখনো হাতে থাকা তাস
let groupCards = [[], [], [], []]; // প্রতিটি গ্রুপে বসানো তাস
let selected = null;       // বর্তমানে নির্বাচিত তাস (হাত থেকে)

socket.on('your_hand', ({ hand }) => {
  handCards = hand.slice();
  groupCards = [[], [], [], []];
  selected = null;
  document.getElementById('btnUp').disabled = true;
  document.getElementById('waitingList').textContent = '';
  document.getElementById('gameHint').textContent = 'প্রথমে নিচের হাত থেকে একটি তাসে ক্লিক করুন, তারপর যে ট্রেতে রাখতে চান সেখানে ক্লিক করুন।';
  renderArranger();
  if (lastRoomState) renderOppSeats(lastRoomState);
  showScreen('game');
});

function renderArranger() {
  const handArea = document.getElementById('handArea');
  handArea.innerHTML = handCards
    .map((c) => cardHTML(c))
    .join('');
  handArea.querySelectorAll('.card').forEach((el) => {
    if (el.dataset.code === selected) el.classList.add('selected');
    el.addEventListener('click', () => {
      selected = selected === el.dataset.code ? null : el.dataset.code;
      renderArranger();
    });
  });

  GROUP_SIZES.forEach((size, gi) => {
    const box = document.getElementById('group' + gi);
    box.innerHTML = groupCards[gi].map((c) => cardHTML(c, { mini: true })).join('');
    box.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // গ্রুপ থেকে হাতে ফেরত
        groupCards[gi] = groupCards[gi].filter((c) => c !== el.dataset.code);
        handCards.push(el.dataset.code);
        renderArranger();
      });
    });
    document.getElementById('cnt' + gi).textContent = `${groupCards[gi].length}/${size}`;
  });

  const allDone = groupCards.every((g, i) => g.length === GROUP_SIZES[i]) && handCards.length === 0;
  document.getElementById('btnUp').disabled = !allDone;
}

document.querySelectorAll('.group-box').forEach((box) => {
  box.addEventListener('click', () => {
    if (!selected) return;
    const gi = parseInt(box.dataset.g, 10);
    if (groupCards[gi].length >= GROUP_SIZES[gi]) return;
    handCards = handCards.filter((c) => c !== selected);
    groupCards[gi].push(selected);
    selected = null;
    renderArranger();
  });
});

document.getElementById('btnReset').addEventListener('click', () => {
  handCards = handCards.concat(...groupCards);
  groupCards = [[], [], [], []];
  selected = null;
  renderArranger();
});

document.getElementById('btnAuto').addEventListener('click', () => {
  const all = handCards.concat(...groupCards);
  groupCards = clientAutoArrange(all);
  handCards = [];
  selected = null;
  renderArranger();
});

document.getElementById('btnUp').addEventListener('click', () => {
  socket.emit('submit_groups', { code: myRoomCode, groups: groupCards });
  document.getElementById('btnUp').disabled = true;
  document.getElementById('gameHint').textContent = 'জমা দেওয়া হয়েছে — অন্যদের অপেক্ষা করা হচ্ছে...';
});

// ---- ক্লায়েন্ট সাইড অটো-অ্যারেঞ্জ (সার্ভারের মতোই লজিক) ----
function rankVal(r) {
  if (r === 'A') return 14; if (r === 'K') return 13; if (r === 'Q') return 12;
  if (r === 'J') return 11; if (r === 'T') return 10; return parseInt(r, 10);
}
const RUN_TABLE = [
  { vals: [14, 13, 12], score: 100 }, { vals: [14, 3, 2], score: 99 },
  { vals: [13, 12, 11], score: 13 }, { vals: [12, 11, 10], score: 12 },
  { vals: [11, 10, 9], score: 11 }, { vals: [10, 9, 8], score: 10 },
  { vals: [9, 8, 7], score: 9 }, { vals: [8, 7, 6], score: 8 },
  { vals: [7, 6, 5], score: 7 }, { vals: [6, 5, 4], score: 6 },
  { vals: [5, 4, 3], score: 5 }, { vals: [4, 3, 2], score: 4 },
];
function evaluate3c(codes) {
  const parsed = codes.map((c) => ({ rank: c[0], suit: c[1], val: rankVal(c[0]) }));
  const sorted = parsed.slice().sort((a, b) => b.val - a.val);
  const vals = sorted.map((c) => c.val);
  const sameSuit = sorted[0].suit === sorted[1].suit && sorted[1].suit === sorted[2].suit;
  if (vals[0] === vals[1] && vals[1] === vals[2]) return { type: 6, tiebreak: [vals[0]] };
  const run = RUN_TABLE.find((r) => r.vals[0] === vals[0] && r.vals[1] === vals[1] && r.vals[2] === vals[2]);
  if (run) return { type: sameSuit ? 5 : 4, tiebreak: [run.score] };
  if (sameSuit) return { type: 3, tiebreak: vals };
  if (vals[0] === vals[1]) return { type: 2, tiebreak: [vals[0], vals[2]] };
  if (vals[1] === vals[2]) return { type: 2, tiebreak: [vals[1], vals[0]] };
  return { type: 1, tiebreak: vals };
}
function compareComboC(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < a.tiebreak.length; i++) if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i];
  return 0;
}
function clientAutoArrange(hand) {
  const cards = hand.map((c) => ({ code: c, val: rankVal(c[0]) })).sort((a, b) => b.val - a.val);
  const group4 = cards.slice(cards.length - 4).map((c) => c.code);
  let rest = cards.slice(0, cards.length - 4);
  const groups = [];
  while (rest.length > 0) {
    if (rest.length === 3) { groups.push(rest.map((c) => c.code)); rest = []; break; }
    let bestIdx = null, bestEval = null;
    for (let i = 1; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const trio = [rest[0].code, rest[i].code, rest[j].code];
        const ev = evaluate3c(trio);
        if (!bestEval || compareComboC(ev, bestEval) > 0) { bestEval = ev; bestIdx = [i, j]; }
      }
    }
    const picked = [rest[0], rest[bestIdx[0]], rest[bestIdx[1]]];
    groups.push(picked.map((c) => c.code));
    rest = rest.filter((c) => !picked.includes(c));
  }
  groups.sort((a, b) => compareComboC(evaluate3c(a), evaluate3c(b))).reverse();
  return [group4, groups[0], groups[1], groups[2]];
}

// ------------------------------------------------------------
// রুম স্টেট আপডেট
// ------------------------------------------------------------
socket.on('room_state', (state) => {
  lastRoomState = state;
  myRoomCode = state.code;
  updateRoomBadge();
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    renderLobby(state);
  }
  renderScoreboard(state);

  // গেম স্ক্রিনে থাকলে টেবিলের প্রতিপক্ষ-আসন ও অপেক্ষার তালিকা আপডেট করি
  if (document.getElementById('screen-game').classList.contains('active')) {
    renderOppSeats(state);
    const notReady = state.players.filter((p) => p && !p.ready).map((p) => p.name);
    document.getElementById('waitingList').textContent = notReady.length
      ? 'অপেক্ষা করা হচ্ছে: ' + notReady.join(', ')
      : '';
  }
});

// ------------------------------------------------------------
// হাত ফলাফল — রাউন্ড ধরে ধরে দেখানো
// ------------------------------------------------------------
let pendingResult = null;
let roundIndex = 0;

socket.on('hand_result', (result) => {
  pendingResult = result;
  roundIndex = 0;
  showScreen('reveal');
  renderRound();
});

function playerName(id) {
  const p = (lastRoomState?.players || []).find((pp) => pp && pp.id === id);
  return p ? p.name : '???';
}

function renderRound() {
  const round = pendingResult.rounds[roundIndex];
  const roundLabel = roundIndex === 3 ? 'শেষ রাউন্ড (৪ তাস)' : `রাউন্ড ${roundIndex + 1}`;
  document.getElementById('revealTitle').textContent = `${roundLabel} — ফলাফল`;

  const plays = document.getElementById('revealPlays');
  plays.innerHTML = round.plays
    .map((p) => {
      const isWinner = p.playerId === round.winnerId;
      return `<div class="reveal-play ${isWinner ? 'winner' : ''}">
        <div class="reveal-name">${escapeHTML(playerName(p.playerId))}</div>
        <div class="reveal-cards">${p.cards.map((c) => cardHTML(c, { mini: true })).join('')}</div>
        <div class="reveal-type">${p.type}</div>
      </div>`;
    })
    .join('');

  document.getElementById('revealWinner').textContent =
    `🏆 ${playerName(round.winnerId)} এই রাউন্ড জিতেছে (+${round.points} পয়েন্ট)`;

  const btn = document.getElementById('btnNextRound');
  btn.classList.remove('hidden');
  btn.textContent = roundIndex < 3 ? 'পরবর্তী রাউন্ড ➜' : 'হাতের ফলাফল দেখুন ➜';
}

document.getElementById('btnNextRound').addEventListener('click', () => {
  roundIndex++;
  if (roundIndex < pendingResult.rounds.length) {
    renderRound();
  } else {
    showHandEnd();
  }
});

function showHandEnd() {
  const state = lastRoomState;
  const scores = pendingResult.scores;
  const sortedIds = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  const maxScore = Math.max(...Object.values(scores));

  const list = document.getElementById('finalScoreList');
  list.innerHTML = sortedIds
    .map((id) => {
      const leader = scores[id] === maxScore;
      return `<div class="final-score-row ${leader ? 'leader' : ''}">
        <span>${escapeHTML(playerName(id))}</span><b>${scores[id]}</b>
      </div>`;
    })
    .join('');

  document.getElementById('handEndTitle').textContent = pendingResult.gameOver ? 'গেম শেষ! 🎉' : 'এই হাত শেষ';

  const banner = document.getElementById('gameOverBanner');
  if (pendingResult.gameOver) {
    banner.classList.remove('hidden');
    banner.textContent = `🏆 বিজয়ী: ${pendingResult.winnerName || playerName(pendingResult.winnerId)} (১০০০+ পয়েন্ট)`;
  } else {
    banner.classList.add('hidden');
  }

  const isHost = state && state.hostId === myPlayerId;
  const nextBtn = document.getElementById('btnNextHand');
  if (!pendingResult.gameOver && isHost) {
    nextBtn.classList.remove('hidden');
  } else {
    nextBtn.classList.add('hidden');
  }
  document.getElementById('handEndHint').textContent = pendingResult.gameOver
    ? 'নতুন গেম খেলতে চাইলে হোমে যান এবং আবার শুরু করুন।'
    : (isHost ? 'পরবর্তী হাত শুরু করতে বোতাম চাপুন।' : 'হোস্ট পরবর্তী হাত শুরু করার অপেক্ষায়...');

  showScreen('handend');
}

document.getElementById('btnNextHand').addEventListener('click', () => {
  socket.emit('next_hand', { code: myRoomCode });
});

// ------------------------------------------------------------
// পুনরায় সংযোগ (পেজ রিলোড হলে)
// ------------------------------------------------------------
socket.on('connect', () => {
  const s = loadSession();
  if (s && s.roomCode && s.playerId) {
    socket.emit('join_room', { code: s.roomCode, name: s.name, playerId: s.playerId }, (res) => {
      if (res.ok) {
        myPlayerId = res.playerId;
        myRoomCode = res.code;
        myName = s.name;
        nameInput.value = s.name;
        updateRoomBadge();
        showScreen('lobby');
      } else {
        clearSession();
      }
    });
  }
});
