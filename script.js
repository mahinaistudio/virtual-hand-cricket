/* script.js */

// ── State ──
let lastBalls = [];
let selectedFingers = [];
let socket = null;
let playerName = "";
let roomCode = "";
let generatedCode = "";
let currentInnings = 1;
let isHost = false;
let isSpectator = false;
let mySlot = null;
let gameMode = "limited";
let matchMode = "limited";
let matchOvers = 0;
let matchWickets = 0;
let currentBattingName = "";
let currentBowlingName = "";
let matchResultData = null;
let isTossing = false;
let previewCountdownTimer = null;
let breakCountdownTimer = null;

const sounds = {
  wicket: new Audio("sounds/wicket.mp3"),
  six: new Audio("sounds/six.m4a")
};

function playSound(name) {
  if (sounds[name]) {
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  }
}

// ── Screen Management ──
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  const isGame = id === "gameScreen";
  const isName = id === "nameScreen";

  // Back button: hidden on name screen only
  document.getElementById("globalBackBtn").style.display = isName ? "none" : "block";

  // Declare button: only during game, only for players
  if (!isGame) document.getElementById("gameDeclareBtn").style.display = "none";

  // Spectator badge: show once spectating
  if (isSpectator) {
    document.getElementById("spectatorBadge").style.display = "block";
  }
}

// ── Back / Leave Logic ──
function handleBack() {
  const active = document.querySelector(".screen.active");
  if (!active) return;
  const id = active.id;

  if (id === "modeScreen")      { showScreen("nameScreen"); return; }
  if (id === "roomSetupScreen") { showScreen("modeScreen"); return; }

  // BUG-03: result screen — back goes home with confirm for players
  if (id === "resultScreen") {
    exitMatch();
    return;
  }

  if (id === "lobbyScreen") {
    if (isSpectator) {
      document.getElementById("spectatorLeavePopup").style.display = "flex";
    } else {
      document.getElementById("leavePopupMsg").innerText = "Are you sure you want to leave the lobby?";
      document.getElementById("leavePopup").style.display = "flex";
    }
    return;
  }

  if (["tossScreen","decisionScreen","matchPreviewScreen","inningsBreakScreen"].includes(id)) {
    if (isSpectator) {
      document.getElementById("spectatorLeavePopup").style.display = "flex";
    } else {
      document.getElementById("leavePopupMsg").innerText = "Leave the match? Your opponent will be notified.";
      document.getElementById("leavePopup").style.display = "flex";
    }
    return;
  }

  if (id === "gameScreen") {
    if (isSpectator) {
      document.getElementById("spectatorLeavePopup").style.display = "flex";
    } else {
      const isBatter2 = currentInnings === 2
        && ((mySlot === "A" && currentBattingName === document.getElementById("teamA").innerText)
         || (mySlot === "B" && currentBattingName === document.getElementById("teamB").innerText));

      if (isBatter2) {
        document.getElementById("inMatchLeavePopup").style.display = "flex";
      } else {
        document.getElementById("leavePopupMsg").innerText = "Leave the match? Your opponent will be notified.";
        document.getElementById("leavePopup").style.display = "flex";
      }
    }
    return;
  }
}

function closePopup(id) {
  document.getElementById(id).style.display = "none";
}

function confirmLeave() {
  closePopup("leavePopup");
  closePopup("inMatchLeavePopup");
  closePopup("spectatorLeavePopup");
  if (socket) {
    socket.send(JSON.stringify({ type: "PLAYER_LEAVE", player: mySlot }));
    socket.close();
    socket = null;
  }
  location.reload();
}

function showDeclareFromMenu() {
  closePopup("inMatchLeavePopup");
  document.getElementById("declarePopup").style.display = "flex";
}

// ── Room Code ──
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ── Navigation ──
function goToMode() {
  const val = document.getElementById("playerNameInput").value.trim();
  if (!val) { showAlert("Enter your name first!", "✏️"); return; }
  playerName = val;
  showScreen("modeScreen");
}

function goToRoomSetup() {
  generatedCode = generateRoomCode();
  showScreen("roomSetupScreen");
}

function setMode(mode) {
  gameMode = mode;
  const oversInput = document.getElementById("oversInput");
  document.getElementById("limitedBtn").classList.toggle("active", mode === "limited");
  document.getElementById("unlimitedBtn").classList.toggle("active", mode === "unlimited");
  if (mode === "unlimited") {
    oversInput.value = "";
    oversInput.disabled = true;
    oversInput.style.display = "none";
  } else {
    oversInput.disabled = false;
    oversInput.style.display = "block";
  }
}

function createRoom() {
  const overs   = document.getElementById("oversInput").value;
  const wickets = document.getElementById("wicketsInput").value;
  if (gameMode === "limited" && (!overs || !wickets)) { showAlert("Fill all fields!", "📋"); return; }
  if (gameMode === "unlimited" && !wickets)           { showAlert("Enter wickets!", "🎳"); return; }
  roomCode = generatedCode;
  isHost = true;
  connectToServer(roomCode, gameMode === "limited" ? overs : null, wickets, false, true);
  showScreen("lobbyScreen");
}

function joinRoom() {
  const code = document.getElementById("joinRoomCodeInput").value.trim();
  if (!code) { showAlert("Enter room code!", "🔢"); return; }
  roomCode = code;
  isHost = false;
  connectToServer(code, null, null, false, false);
}

function spectateRoom() {
  const code = document.getElementById("joinRoomCodeInput").value.trim();
  if (!code) { showAlert("Enter room code!", "🔢"); return; }
  roomCode = code;
  isHost = false;
  isSpectator = true;
  connectToServer(code, null, null, true, false);
  showScreen("lobbyScreen");
}

function startMatch() {
  const teamB = document.getElementById("teamB").innerText;
  if (teamB === "Empty" || teamB === "Waiting...") { showAlert("Waiting for opponent to join", "⏳"); return; }
  socket.send(JSON.stringify({ type: "START_MATCH" }));
}

// Ready button: re-enables after 1.5s, each press toasts the host
function sendReady() {
  socket.send(JSON.stringify({ type: "PLAYER_READY" }));
  const btn = document.getElementById("readyBtn");
  btn.disabled = true;
  btn.innerText = "✅ Sent!";
  setTimeout(() => { btn.disabled = false; btn.innerText = "✋ Ready to Play!"; }, 1500);
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode);
  showToast("✅ Room code copied!", "var(--green)", "#0f172a");
}

function showToast(msg, bg = "var(--accent)", color = "white") {
  const t = document.createElement("div");
  t.innerText = msg;
  t.style.cssText = `
    position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:${bg};color:${color};padding:12px 24px;border-radius:10px;
    font-weight:700;font-size:15px;z-index:9999;
    box-shadow:0 4px 16px rgba(0,0,0,0.3);text-align:center;max-width:300px;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showAlert(msg, emoji = "ℹ️") {
  const overlay = document.createElement("div");
  overlay.className = "popupOverlay";
  overlay.style.cssText = "display:flex;z-index:99999;";
  overlay.innerHTML = `
    <div class="popupCard">
      <p class="popupEmoji">${emoji}</p>
      <p class="popupMsg" style="color:var(--text);font-size:15px;font-weight:600;">${msg}</p>
      <button class="btnPrimary fullWidth" id="alertOkBtn">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#alertOkBtn").onclick = () => overlay.remove();
}

function toggleTheme() {
  document.body.classList.toggle("light");
  document.getElementById("themeToggle").innerText =
    document.body.classList.contains("light") ? "☀️" : "🌙";
}

// ── Toss ──
function sendToss(choice) {
  if (isTossing) return;
  socket.send(JSON.stringify({ type: "TOSS_CHOICE", player: mySlot, choice }));
  if (choice !== "pass") {
    isTossing = true;
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossMessage").innerText = "Flipping coin...";
  }
}

function animateCoinFlip(result) {
  const coin = document.getElementById("coin");
  const msg  = document.getElementById("tossMessage");
  coin.classList.remove("flip-heads", "flip-tails");
  void coin.offsetWidth;
  coin.classList.add(result === "head" ? "flip-heads" : "flip-tails");
  msg.innerText = "Coin is in the air...";
  setTimeout(() => {
    msg.innerText = result === "head" ? "It's HEADS! 🟡" : "It's TAILS! 🔵";
    isTossing = false;
  }, 2000);
}

function sendDecision(choice) {
  socket.send(JSON.stringify({ type: "BAT_BOWL_CHOICE", player: mySlot, choice }));
}

// ── Hand ──
function toggleHandFinger(finger) {
  if (window.handLocked) return;
  const el = document.getElementById(finger);
  if (selectedFingers.includes(finger)) {
    selectedFingers = selectedFingers.filter(f => f !== finger);
    el.classList.remove("open");
  } else {
    selectedFingers.push(finger);
    el.classList.add("open");
  }
  const names = { thumb:"👍 Thumb", index:"☝️ Index", middle:"🖕 Middle", ring:"💍 Ring", pinky:"🤙 Pinky" };
  document.getElementById("selectedDisplay").innerText =
    selectedFingers.length > 0 ? selectedFingers.map(f => names[f]).join(", ") : "None";
}

function lockHand() {
  if (selectedFingers.length === 0) { showAlert("Select at least one finger!", "✋"); return; }
  if (window.handLocked) return;
  window.handLocked = true;
  socket.send(JSON.stringify({ type: "HAND_SELECT", player: mySlot, fingers: selectedFingers }));
  socket.send(JSON.stringify({ type: "HAND_LOCK",   player: mySlot }));
  const hand = document.querySelector(".hand");
  hand.classList.add("locking");
  setTimeout(() => {
    document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
    hand.classList.remove("locking");
  }, 500);
  document.getElementById("selectedDisplay").innerText = "🔒 Locked! Waiting...";
}

// ── Declare ──
function declareMatch() {
  document.getElementById("declarePopup").style.display = "flex";
}

function confirmDeclare() {
  closePopup("declarePopup");
  socket.send(JSON.stringify({ type: "DECLARE" }));
}

// ── Scoreboard ──
function updateScoreboard(payload) {
  const { battingName, bowlingName, scoreA, scoreB, wicketsA, wicketsB,
          balls, ballsLeft, innings, target } = payload;
  currentBattingName = battingName;
  currentBowlingName = bowlingName;

  document.getElementById("battingName").innerText = "Bat: " + battingName;
  document.getElementById("bowlingName").innerText = "Bowl: " + bowlingName;

  const teamAName = document.getElementById("teamA").innerText;
  const battingScore   = battingName === teamAName ? scoreA : scoreB;
  const battingWickets = battingName === teamAName ? wicketsA : wicketsB;

  document.getElementById("batterStats").innerText = "(" + battingScore + "-" + battingWickets + ")";
  document.getElementById("mainScore").innerText   = battingScore + " / " + battingWickets;
  document.getElementById("inningsDisplay").innerText = "Innings: " + innings;
  document.getElementById("modeDisplay").innerText = "Single • " + (matchMode === "limited" ? "Limited" : "Unlimited");

  if (matchMode === "limited") {
    document.getElementById("overDisplay").innerText    = Math.floor(balls / 6) + "." + (balls % 6);
    document.getElementById("ballsLeftDisplay").innerText = ballsLeft ?? "-";
  } else {
    document.getElementById("overDisplay").innerText    = "-";
    document.getElementById("ballsLeftDisplay").innerText = "-";
  }

  if (target) {
    const runsLeft = Math.max(target - battingScore, 0);
    document.getElementById("targetDisplay").innerText  = target;
    document.getElementById("runsLeftDisplay").innerText = runsLeft;
    document.getElementById("rrrDisplay").innerText =
      (matchMode === "limited" && ballsLeft > 0)
        ? (runsLeft / ballsLeft).toFixed(2) : "-";
  } else {
    document.getElementById("targetDisplay").innerText  = "-";
    document.getElementById("runsLeftDisplay").innerText = "-";
    document.getElementById("rrrDisplay").innerText     = "-";
  }
}

let lastKnownBalls = -1;
let localBallCount = 0; // own counter, works in both modes

function updateBallHistory(serverBalls, out, lastRuns) {
  // Use our own incrementing counter — serverBalls stays 0 in unlimited mode
  localBallCount++;

  const ballRun = out ? "W" : lastRuns;
  if (lastBalls.length >= 6) lastBalls = [];
  lastBalls.push(ballRun);

  const boxes = document.querySelectorAll(".ballBox");
  boxes.forEach((box, i) => {
    box.innerText = lastBalls[i] !== undefined ? lastBalls[i] : "-";
    box.classList.remove("ballFlash");
  });
  if (boxes[lastBalls.length - 1]) {
    boxes[lastBalls.length - 1].classList.add("ballFlash");
    setTimeout(() => boxes[lastBalls.length - 1].classList.remove("ballFlash"), 500);
  }
}

function showBallMessage(out, lastRuns) {
  const msg = document.getElementById("ballMessage");
  if (out) {
    playSound("wicket");
    msg.innerText = "WICKET! 🔴"; msg.style.color = "var(--red)";
  } else if (lastRuns === 6) {
    playSound("six");
    msg.innerText = "SIX! 🚀"; msg.style.color = "var(--amber)";
  } else if (lastRuns === 4) {
    msg.innerText = "FOUR! 💥"; msg.style.color = "var(--green)";
  } else if (lastRuns === 0) {
    msg.innerText = "DOT BALL •"; msg.style.color = "var(--text-muted)";
  } else {
    msg.innerText = lastRuns + (lastRuns === 1 ? " RUN" : " RUNS");
    msg.style.color = "var(--text)";
  }
}

function resetLockBar() {
  document.getElementById("lockStatusA").classList.remove("locked");
  document.getElementById("lockStatusB").classList.remove("locked");
  document.getElementById("lockStateA").innerText = "Waiting ⏳";
  document.getElementById("lockStateB").innerText = "Waiting ⏳";
  document.getElementById("lockStatusBar").style.display = "none";
}

function resetGameScreenForInnings(inningsNum) {
  lastBalls = [];
  localBallCount = 0;          // ← reset local ball counter
  selectedFingers = [];
  document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
  document.getElementById("selectedDisplay").innerText = "None";
  document.getElementById("mainScore").innerText    = "0 / 0";
  document.getElementById("overDisplay").innerText  = "0.0";
  document.getElementById("ballsLeftDisplay").innerText = matchMode === "limited" ? (matchOvers * 6) : "-";
  document.getElementById("runsLeftDisplay").innerText  = "-";
  document.getElementById("rrrDisplay").innerText       = "-";
  document.getElementById("inningsDisplay").innerText   = "Innings: " + inningsNum;
  document.getElementById("ballMessage").innerText      = "";
  document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");
  window.handLocked = false;
  resetLockBar();

  if (isSpectator) {
    document.querySelector(".handContainer").style.display = "none";
    document.querySelector(".btnLock").style.display       = "none";
    document.querySelector(".controlLabel").style.display  = "none";
    document.querySelector(".selectedLabel").style.display = "none";
    document.getElementById("ballMessage").innerText = "Watching the match...";
  }
}

// ── Preview countdown ──
function startPreviewCountdown() {
  let secs = 5;
  document.getElementById("previewCountdownNum").innerText = secs;
  if (previewCountdownTimer) clearInterval(previewCountdownTimer);
  previewCountdownTimer = setInterval(() => {
    secs--;
    document.getElementById("previewCountdownNum").innerText = secs;
    if (secs <= 0) { clearInterval(previewCountdownTimer); previewCountdownTimer = null; startFromPreview(); }
  }, 1000);
}

function skipPreview() {
  if (previewCountdownTimer) { clearInterval(previewCountdownTimer); previewCountdownTimer = null; }
  startFromPreview();
}

function updateDeclareBtn() {
  const active = document.querySelector(".screen.active");
  const isGame = active && active.id === "gameScreen";
  // Show only if: game screen, not spectator, innings 2, I am the batter
  const isBatter2 = isGame && !isSpectator
    && currentInnings === 2
    && ((mySlot === "A" && currentBattingName === document.getElementById("teamA").innerText)
     || (mySlot === "B" && currentBattingName === document.getElementById("teamB").innerText));
  document.getElementById("gameDeclareBtn").style.display = isBatter2 ? "block" : "none";
}

function startFromPreview() {
  resetGameScreenForInnings(1);
  showScreen("gameScreen");
}

// ── Innings break countdown ──
function startBreakCountdown() {
  let secs = 5;
  document.getElementById("breakCountdownNum").innerText = secs;
  if (breakCountdownTimer) clearInterval(breakCountdownTimer);
  breakCountdownTimer = setInterval(() => {
    secs--;
    document.getElementById("breakCountdownNum").innerText = secs;
    if (secs <= 0) { clearInterval(breakCountdownTimer); breakCountdownTimer = null; goToInnings2(); }
  }, 1000);
}

function skipBreak() {
  if (breakCountdownTimer) { clearInterval(breakCountdownTimer); breakCountdownTimer = null; }
  goToInnings2();
}

function goToInnings2() {
  resetGameScreenForInnings(2);
  showScreen("gameScreen");
}

// ── Result Screen ──
function displayMatchResult(data) {
  matchResultData = data;
  const { winner, scoreA, scoreB, wicketsA, wicketsB, ballsLeft, declared, ballsPlayed } = data;
  const teamAName = document.getElementById("teamA").innerText;
  const teamBName = document.getElementById("teamB").innerText;

  document.getElementById("matchSummary").style.display = "block";
  document.getElementById("matchStats").style.display   = "block";

  const isDraw = winner === "Draw";
  document.getElementById("resultEmoji").innerText = isDraw ? "🤝" : "🏆";
  document.getElementById("resultTitle").innerText = isDraw ? "It's a Draw!" : "Match Over!";

  const declaredEl = document.getElementById("declaredText");
  if (declared) {
    document.getElementById("winnerText").innerText = isDraw ? "Match Drawn" : "🎉 " + winner + " Wins!";
    document.getElementById("marginText").innerText = "Match was declared";
    declaredEl.style.display = "block";
    const oversPlayed = ballsPlayed
      ? Math.floor(ballsPlayed / 6) + "." + (ballsPlayed % 6) : "—";
    declaredEl.innerText = `⚡ Declared after ${oversPlayed} overs`;
  } else if (isDraw) {
    document.getElementById("winnerText").innerText = "Match Drawn";
    document.getElementById("marginText").innerText = "Both teams scored equal runs";
    declaredEl.style.display = "none";
  } else {
    document.getElementById("winnerText").innerText = "🎉 " + winner + " Wins!";
    const winnerIsA   = winner === teamAName;
    const runMargin   = (winnerIsA ? scoreA : scoreB) - (winnerIsA ? scoreB : scoreA);
    document.getElementById("marginText").innerText =
      ballsLeft !== null && ballsLeft > 0
        ? `Won by ${runMargin} run${runMargin !== 1 ? "s" : ""} with ${ballsLeft} ball${ballsLeft !== 1 ? "s" : ""} remaining`
        : `Won by ${runMargin} run${runMargin !== 1 ? "s" : ""}`;
    declaredEl.style.display = "none";
  }

  document.getElementById("team1Name").innerText     = teamAName + ":";
  document.getElementById("team1Score").innerText    = scoreA + "/" + wicketsA;
  document.getElementById("team2Name").innerText     = teamBName + ":";
  document.getElementById("team2Score").innerText    = scoreB + "/" + wicketsB;
  document.getElementById("ballsRemaining").innerText = ballsLeft !== null ? ballsLeft : "—";

  const old = document.getElementById("spectatorRematchChoice");
  if (old) old.remove();

  // Bug-04: hide the back/exit button — show a leave-with-popup button instead
  const exitBtn = document.getElementById("exitMatchBtn");
  exitBtn.style.display = "none";

  if (isSpectator) {
    document.getElementById("rematchBtn").style.display         = "none";
    document.getElementById("rematchReceiverBtns").style.display = "none";
    document.getElementById("rematchStatus").innerText          = "Waiting to see if players rematch...";
    document.getElementById("rematchSection").style.display     = "block";
  } else {
    document.getElementById("rematchBtn").style.display          = "block";
    document.getElementById("rematchBtn").innerText              = "🔄 Request Rematch";
    document.getElementById("rematchBtn").disabled               = false;
    document.getElementById("rematchReceiverBtns").style.display = "none";
    document.getElementById("rematchStatus").innerText           = "";
    document.getElementById("rematchSection").style.display      = "block";
  }
}

// ── Rematch ──
function requestRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_REQUEST", player: mySlot }));
  document.getElementById("rematchBtn").style.display = "none";
  document.getElementById("rematchStatus").innerText  = "⏳ Waiting for opponent...";
}

function acceptRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_ACCEPT", player: mySlot }));
  document.getElementById("rematchReceiverBtns").style.display = "none";
  document.getElementById("rematchStatus").innerText = "✅ Accepted! Starting...";
}

function declineRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_DECLINE", player: mySlot }));
  document.getElementById("rematchReceiverBtns").style.display = "none";
  document.getElementById("rematchStatus").innerText = "❌ You declined.";
}

function watchRematch() {
  window.spectatorWatchingRematch = true;
  const el = document.getElementById("spectatorRematchChoice");
  if (el) el.remove();
  showScreen("tossScreen");
  document.getElementById("tossButtons").style.display  = "none";
  document.getElementById("tossWaiting").style.display  = "block";
  document.getElementById("tossMessage").innerText      = "Waiting for toss...";
  document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
}

function exitMatch() {
  const activeScreen = document.querySelector(".screen.active");
  if (isSpectator) {
    // Show confirmation popup instead of leaving immediately
    document.getElementById("spectatorLeavePopup").style.display = "flex";
  } else {
    document.getElementById("leavePopupMsg").innerText = "Leave and go back to menu?";
    document.getElementById("leavePopup").style.display = "flex";
  }
}

// ── Server Connection ──
function connectToServer(code, overs, wickets, spectate = false, isCreating = false) {
  socket = new WebSocket("wss://handcricket-server.mahin-aistudio.workers.dev/" + code);

  socket.onopen = () => {
    if (isCreating) {
      socket.send(JSON.stringify({
        type: "CREATE_ROOM",
        payload: { playerName, overs, wickets, mode: gameMode }
      }));
    } else {
      socket.send(JSON.stringify({
        type: "JOIN_ROOM",
        payload: { playerName, spectate }
      }));
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // ── ROOM_NOT_FOUND ──
    if (data.type === "ROOM_NOT_FOUND") {
      showAlert(data.payload.message, "🚫");
      showScreen("modeScreen");
      socket.close(); socket = null;
      return;
    }

    // ── ROOM_JOINED ──
    if (data.type === "ROOM_JOINED") {
      roomCode = data.payload.roomCode;
      mySlot   = data.payload.slot;
      document.getElementById("lobbyRoomCode").innerText = roomCode;

      if (mySlot === "SPECTATOR") {
        isSpectator = true;
        document.getElementById("spectatorBadge").style.display = "block";
        document.getElementById("startMatchBtn").style.display  = "none";
        document.getElementById("readyBtn").style.display       = "none";
        showScreen("lobbyScreen");
      } else if (mySlot === "A") {
        document.getElementById("startMatchBtn").style.display = "block";
        document.getElementById("readyBtn").style.display      = "none";
        showScreen("lobbyScreen"); // ← Fix 3: was missing for joining players assigned to slot A
      } else if (mySlot === "B") {
        document.getElementById("startMatchBtn").style.display = "none";
        document.getElementById("readyBtn").style.display      = "block";
        showScreen("lobbyScreen");
      }
    }

    // ── ROOM_FULL ──
    if (data.type === "ROOM_FULL") {
      // Bug-02: don't pre-set isSpectator here — let ROOM_JOINED do it
      if (data.payload?.canSpectate) {
        const overlay = document.createElement("div");
        overlay.className = "popupOverlay";
        overlay.style.cssText = "display:flex;z-index:99999;";
        overlay.innerHTML = `
          <div class="popupCard">
            <p class="popupEmoji">👁️</p>
            <p style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;">Room Full</p>
            <p class="popupMsg">Would you like to spectate instead?</p>
            <div class="btnRow" style="width:100%;">
              <button class="btnPrimary" id="rfYes">👁️ Spectate</button>
              <button class="btnSecondary" id="rfNo">Back</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector("#rfYes").onclick = () => {
          overlay.remove();
          // close current socket first
          if (socket) { socket.close(); socket = null; }
          // now connect as spectator — isSpectator will be set on ROOM_JOINED
          const code = document.getElementById("joinRoomCodeInput").value.trim() || roomCode;
          roomCode = code;
          connectToServer(code, null, null, true, false);
        };
        overlay.querySelector("#rfNo").onclick = () => {
          overlay.remove();
          showScreen("modeScreen");
          if (socket) { socket.close(); socket = null; }
        };
      } else {
        showAlert("Room is full!", "🚫");
        showScreen("modeScreen");
      }
      return;
    }

    // ── LOBBY_UPDATE ──
    if (data.type === "LOBBY_UPDATE") {
      document.getElementById("lobbyRoomCode").innerText = roomCode;
      document.getElementById("teamA").innerText = data.payload.teamA || "Empty";
      document.getElementById("teamB").innerText = data.payload.teamB || "Empty";
      if (data.payload.spectatorCount !== undefined) {
        document.getElementById("spectatorCount").innerText     = data.payload.spectatorCount;
        document.getElementById("liveSpectatorCount").innerText = data.payload.spectatorCount;
      }
    }

if (data.type === "HOST_TRANSFER") {
      isHost = true;
      document.getElementById("startMatchBtn").style.display = "block";
      document.getElementById("readyBtn").style.display      = "none";
      // Show the opponent-left popup with a note they're now host
      const leaverName = data.payload.leavingName || "Your opponent";
      document.getElementById("opponentLeftMsg").innerText =
        leaverName + " has left. You are now the host!";
      document.getElementById("opponentLeftPopup").style.display = "flex";
    }

if (data.type === "HOST_STATUS") {
      if (isSpectator) return; // Fix-03: spectators never get start/ready buttons
      const amHost = data.payload.hostSlot === mySlot;
      isHost = amHost;
      document.getElementById("startMatchBtn").style.display = amHost ? "block" : "none";
      document.getElementById("readyBtn").style.display      = amHost ? "none" : "block";
    }

    // ── READY_UPDATE ──
    if (data.type === "READY_UPDATE") {
      if (isHost) {
        showToast("🏏 " + data.payload.nameB + " is ready! Start the match!", "var(--accent)");
      }
    }

    // ── TOSS_CALLER ──
    if (data.type === "TOSS_CALLER") {
      if (isSpectator && !window.spectatorWatchingRematch && window.rematchHasHappened) return;
      showScreen("tossScreen");
      document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
      isTossing = false;

      const iAmCaller = data.payload.caller === mySlot;
      if (isSpectator) {
        document.getElementById("tossButtons").style.display  = "none";
        document.getElementById("tossWaiting").style.display  = "block";
        document.getElementById("tossMessage").innerText      = "Waiting for toss...";
      } else {
        document.getElementById("tossButtons").style.display  = iAmCaller ? "flex" : "none";
        document.getElementById("tossWaiting").style.display  = iAmCaller ? "none" : "block";
        document.getElementById("tossMessage").innerText      = iAmCaller ? "Make your call!" : "Opponent is calling...";
      }
    }

    // ── TOSS_RESULT ──
    if (data.type === "TOSS_RESULT") {
      animateCoinFlip(data.payload.coin);
      setTimeout(() => {
        const teamAName = document.getElementById("teamA").innerText;
        const teamBName = document.getElementById("teamB").innerText;
        showScreen("decisionScreen");
        document.getElementById("decisionWaiting").innerText =
          "🪙 " + data.payload.coin.toUpperCase() + " — " + data.payload.winner + " won the toss!";
        const amIWinner =
          (mySlot === "A" && data.payload.winner === teamAName) ||
          (mySlot === "B" && data.payload.winner === teamBName);
        if (isSpectator) {
          document.getElementById("decisionButtons").style.display = "none";
        } else {
          document.getElementById("decisionButtons").style.display = amIWinner ? "flex" : "none";
        }
        document.getElementById("decisionWaiting").style.display = "block";
      }, 2500);
    }

    // ── MATCH_DECISION ──
    if (data.type === "MATCH_DECISION") {
      matchMode    = data.payload.mode;
      matchOvers   = data.payload.overs || 0;
      matchWickets = data.payload.wicketsLimit || 0;
      currentBattingName = data.payload.batting;
      currentBowlingName = data.payload.bowling;

      document.getElementById("previewBattingName").innerText = data.payload.batting;
      document.getElementById("previewBowlingName").innerText = data.payload.bowling;
      document.getElementById("previewMode").innerText    = matchMode === "limited" ? "Limited" : "Unlimited";
      document.getElementById("previewOvers").innerText   = matchMode === "limited" ? matchOvers : "∞";
      document.getElementById("previewWickets").innerText = matchWickets;
      document.getElementById("battingName").innerText    = "Bat: " + data.payload.batting;
      document.getElementById("bowlingName").innerText    = "Bowl: " + data.payload.bowling;
      document.getElementById("modeDisplay").innerText    = "Single • " + (matchMode === "limited" ? "Limited" : "Unlimited");
      document.getElementById("ballMessage").innerText    = "";
      document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");
      lastBalls = [];
      localBallCount = 0;

      currentInnings = 1;
  showScreen("matchPreviewScreen");
  updateDeclareBtn(); // will hide it (innings 1)
  startPreviewCountdown();
    }

    // ── BALL_RESULT ──
    if (data.type === "BALL_RESULT") {
      window.handLocked = false;
      selectedFingers   = [];
      document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
      document.getElementById("selectedDisplay").innerText = "None";

      updateScoreboard(data.payload);
updateDeclareBtn();
      updateBallHistory(data.payload.balls, data.payload.out, data.payload.lastRuns);
      showBallMessage(data.payload.out, data.payload.lastRuns);

      if (isSpectator) {
        document.getElementById("lockStatusA").classList.remove("locked");
        document.getElementById("lockStatusB").classList.remove("locked");
        document.getElementById("lockStateA").innerText = "Waiting ⏳";
        document.getElementById("lockStateB").innerText = "Waiting ⏳";
      }

      if (data.payload.matchOver) {
        setTimeout(() => {
          displayMatchResult(data.payload);
          showScreen("resultScreen");
        }, 900);
      }
    }

    // ── INNINGS_BREAK ──
    if (data.type === "INNINGS_BREAK") {
      window.handLocked = false;
      lastBalls = [];
      localBallCount = 0;
      const p = data.payload;

      // ← Fix: update batting/bowling names NOW so isBatter2 check is correct immediately
      currentBattingName = p.nextBattingName;
      currentBowlingName = p.nextBowlingName;

      document.getElementById("breakBattedName").innerText  = p.nextBowlingName;
      document.getElementById("breakScore1").innerText      = p.innings1Score + " / " + p.innings1Wickets;
      document.getElementById("breakTarget").innerText      = p.target;
      document.getElementById("breakBattingNext").innerText = p.nextBattingName;
      document.getElementById("breakModeInfo").innerText    =
        p.mode === "limited"
          ? "Needs " + p.target + " in " + (p.overs * 6) + " balls"
          : "Needs " + p.target + " runs (no ball limit)";
      showScreen("inningsBreakScreen");
      currentInnings = 2;
      updateDeclareBtn();
      startBreakCountdown();
    }

    // ── LOCK_STATUS (spectators only) ──
    if (data.type === "LOCK_STATUS") {
      if (!isSpectator) return;
      const { lockedA, lockedB, nameA, nameB } = data.payload;
      document.getElementById("lockStatusBar").style.display = "flex";
      document.getElementById("lockNameA").innerText = nameA || "Player A";
      document.getElementById("lockNameB").innerText = nameB || "Player B";
      document.getElementById("lockStatusA").classList.toggle("locked", lockedA);
      document.getElementById("lockStatusB").classList.toggle("locked", lockedB);
      document.getElementById("lockStateA").innerText = lockedA ? "Locked 🔒" : "Waiting ⏳";
      document.getElementById("lockStateB").innerText = lockedB ? "Locked 🔒" : "Waiting ⏳";
    }

    // ── REMATCH_REQUEST ──
    if (data.type === "REMATCH_REQUEST") {
      if (isSpectator) {
        document.getElementById("rematchStatus").innerText =
          "⏳ " + data.payload.fromName + " wants a rematch...";
        return;
      }
      if (data.payload.from === mySlot) return;
      document.getElementById("rematchBtn").style.display          = "none";
      document.getElementById("rematchStatus").innerText           = "🏏 " + data.payload.fromName + " wants a rematch!";
      document.getElementById("rematchReceiverBtns").style.display = "flex";
    }

    // ── REMATCH_DECLINED ──
    if (data.type === "REMATCH_DECLINED") {
      document.getElementById("rematchReceiverBtns").style.display = "none";
      if (isSpectator) {
        document.getElementById("rematchStatus").innerText = "❌ " + data.payload.fromName + " declined.";
        return;
      }
      document.getElementById("rematchStatus").innerText =
        data.payload.fromName === playerName ? "❌ You declined." : "❌ " + data.payload.fromName + " declined.";
      setTimeout(() => {
        document.getElementById("rematchBtn").style.display = "block";
        document.getElementById("rematchBtn").disabled      = false;
        document.getElementById("rematchBtn").innerText     = "🔄 Request Rematch";
        document.getElementById("rematchStatus").innerText  = "";
      }, 500);
    }

    // ── REMATCH_START ──
    if (data.type === "REMATCH_START") {
      const old = document.getElementById("spectatorRematchChoice");
      if (old) old.remove();

      if (isSpectator) {
        window.spectatorWatchingRematch = false;
        window.rematchHasHappened       = true;
        document.getElementById("resultEmoji").innerText        = "👁️";
        document.getElementById("resultTitle").innerText        = "Rematch Starting!";
        document.getElementById("matchSummary").style.display   = "none";
        document.getElementById("matchStats").style.display     = "none";
        document.getElementById("rematchSection").style.display = "none";
        document.getElementById("exitMatchBtn").style.display   = "none";
        const choice = document.createElement("div");
        choice.id = "spectatorRematchChoice";
        choice.style.cssText = "display:flex;flex-direction:column;gap:10px;width:100%";
        choice.innerHTML = `
          <p style="color:var(--text-muted);font-size:14px;margin:0;">Players are starting a rematch.</p>
          <button class="btnPrimary fullWidth" onclick="watchRematch()">👁️ Watch Again</button>
          <button class="btnSecondary fullWidth" onclick="exitMatch()">← Back to Menu</button>
        `;
        document.querySelector("#resultScreen .centerCard").appendChild(choice);
        return;
      }

      isTossing = false;
      lastBalls = [];
      localBallCount = 0;
      selectedFingers = [];
      window.handLocked = false;
      document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
      showScreen("tossScreen");
    }

    // ── OPPONENT_LEFT ──
    if (data.type === "OPPONENT_LEFT") {
      const leaverName = data.payload.name || "Your opponent";

      // Update name displays
      const teamAEl = document.getElementById("teamA");
      const teamBEl = document.getElementById("teamB");
      if (teamAEl.innerText === leaverName) {
        if (currentBattingName === leaverName) document.getElementById("battingName").innerText = "Bat: Empty";
        if (currentBowlingName === leaverName) document.getElementById("bowlingName").innerText = "Bowl: Empty";
        teamAEl.innerText = "Empty";
      } else if (teamBEl.innerText === leaverName) {
        if (currentBattingName === leaverName) document.getElementById("battingName").innerText = "Bat: Empty";
        if (currentBowlingName === leaverName) document.getElementById("bowlingName").innerText = "Bowl: Empty";
        teamBEl.innerText = "Empty";
      }

      if (!isSpectator) {
        const activeScreen = document.querySelector(".screen.active");

        // Fix-04: result screen always gets "Room Ended" — no host popup ever
        if (activeScreen && activeScreen.id === "resultScreen") {
          const overlay = document.createElement("div");
          overlay.className = "popupOverlay";
          overlay.style.cssText = "display:flex;z-index:99999;";
          overlay.innerHTML = `
            <div class="popupCard">
              <p class="popupEmoji">🚪</p>
              <p style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;">Room Ended</p>
              <p class="popupMsg">${leaverName} has left.</p>
              <button class="btnPrimary fullWidth" onclick="confirmLeave()">← Back to Menu</button>
            </div>`;
          document.body.appendChild(overlay);
        } else {
          // Lobby or match — normal leave popup
          document.getElementById("opponentLeftMsg").innerText =
            leaverName + " has left. They may rejoin.";
          document.getElementById("opponentLeftPopup").style.display = "flex";
        }
      }
    }

    // ── Fix-02: BOTH_LEFT — spectators get kicked home ──
    if (data.type === "BOTH_LEFT") {
      if (!isSpectator) return;
      const overlay = document.createElement("div");
      overlay.className = "popupOverlay";
      overlay.style.cssText = "display:flex;z-index:99999;";
      overlay.innerHTML = `
        <div class="popupCard">
          <p class="popupEmoji">🚪</p>
          <p style="font-family:var(--font-display);font-size:18px;font-weight:700;margin:0;">Match Ended</p>
          <p class="popupMsg">Both players have left the match.</p>
          <button class="btnPrimary fullWidth" onclick="location.reload()">← Back to Menu</button>
        </div>`;
      document.body.appendChild(overlay);
    }
  };
}
