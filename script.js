let lastBalls = [];
let selectedFingers = [];
let syncedBallHistory = [];
let leavePopupFromInMatch = false;
let socket = null;
let playerName = "";
let spectatorRematchBuffer = [];
let roomCode = "";
let generatedCode = "";
let currentInnings = 1;
let isHost = false;
let isSpectator = false;
let declareFromMenu = false;
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
  six:    new Audio("sounds/six.m4a")
};
// Force preload
Object.values(sounds).forEach(a => { a.preload = "auto"; a.load(); });

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

  const isGame  = id === "gameScreen";
  const isName  = id === "nameScreen";
  const showSettings = isName || isGame;

  document.getElementById("globalBackBtn").style.display = isName ? "none" : "block";
  if (!isGame) document.getElementById("gameDeclareBtn").style.display = "none";
  if (isSpectator) document.getElementById("spectatorBadge").style.display = "block";

  const settingsBtn = document.getElementById("settingsBtn");
  settingsBtn.style.display = showSettings ? "flex" : "none";
  settingsBtn.classList.remove("with-declare"); // declare is never visible outside gameScreen

  if (isGame) {
    document.getElementById("keybindSection").style.display = "none";
  } else {
    document.getElementById("keybindSection").style.display = "block";
  }
}

// ── Back / Leave Logic ──
function handleBack() {
  const active = document.querySelector(".screen.active");
  if (!active) return;
  const id = active.id;

  if (id === "modeScreen")      { showScreen("nameScreen"); return; }
  if (id === "roomSetupScreen") { showScreen("modeScreen"); return; }

  if (id === "resultScreen") { exitMatch(); return; }

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
      // Always open inMatchLeavePopup for batter2, leavePopup for others
      // Never navigate away directly
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

function confirmLeaveWithConfirm() {
  // Close the 3-option menu first so leavePopup becomes the topmost popup
  closePopup("inMatchLeavePopup");
  leavePopupFromInMatch = true;
  document.getElementById("leavePopupMsg").innerText = "Leave the match? Your opponent will be notified.";
  document.getElementById("leavePopup").style.display = "flex";
}

function cancelLeavePopup() {
  closePopup("leavePopup");
  // If we came from inMatchLeavePopup, go back to it
  if (leavePopupFromInMatch) {
    leavePopupFromInMatch = false;
    document.getElementById("inMatchLeavePopup").style.display = "flex";
  }
}

function cancelDeclare() {
  closePopup("declarePopup");
  if (declareFromMenu) {
    declareFromMenu = false;
    document.getElementById("inMatchLeavePopup").style.display = "flex";
  }
  // If opened directly via D key, just closes — no popup reopened
}

function showDeclareFromMenu() {
  closePopup("inMatchLeavePopup");
  declareFromMenu = true;
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
  setTimeout(() => { btn.disabled = false; btn.innerText = "✋ Ready to Play!"; }, 1000);
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
  setTimeout(() => t.remove(), 1000);
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

  const layer = document.getElementById('layer-' + finger);
  if (!layer) return;

  if (selectedFingers.includes(finger)) {
    selectedFingers = selectedFingers.filter(f => f !== finger);
    layer.classList.remove('open');
  } else {
    selectedFingers.push(finger);
    layer.classList.add('open');
  }

  const names = { thumb:'👍 Thumb', index:'☝️ Index', middle:'🖕 Middle', ring:'💍 Ring', pinky:'🤙 Pinky' };
  document.getElementById('selectedDisplay').innerText =
    selectedFingers.length > 0 ? selectedFingers.map(f => names[f]).join(', ') : 'None';
}

function lockHand() {
  if (selectedFingers.length === 0) { showAlert('Select at least one finger!', '✋'); return; }
  if (window.handLocked) return;
  window.handLocked = true;

  socket.send(JSON.stringify({ type: 'HAND_SELECT', player: mySlot, fingers: selectedFingers }));
  socket.send(JSON.stringify({ type: 'HAND_LOCK',   player: mySlot }));

  const rig = document.getElementById('handRig');
  rig.classList.add('locking');
  setTimeout(() => {
    rig.classList.remove('locking');
  }, 300);

  document.getElementById('selectedDisplay').innerText = '🔒 Locked! Waiting...';
}

// ── Declare ──
function declareMatch() {
  declareFromMenu = false; // opened directly, not from menu
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
    window.playSound("wicket");
    msg.innerText = "WICKET! 🔴"; msg.style.color = "var(--red)";
  } else if (lastRuns === 6) {
    window.playSound("six");
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
  document.querySelectorAll('.handLayer').forEach(l => {
  if (!l.classList.contains('base')) l.classList.remove('open');
});
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
  const isBatter2 = isGame && !isSpectator
    && currentInnings === 2
    && ((mySlot === "A" && currentBattingName === document.getElementById("teamA").innerText)
     || (mySlot === "B" && currentBattingName === document.getElementById("teamB").innerText));

  document.getElementById("gameDeclareBtn").style.display = isBatter2 ? "block" : "none";
}

function startFromPreview() {
  const stash = [...syncedBallHistory];
  resetGameScreenForInnings(currentInnings); // wipes lastBalls
  if (stash.length > 0) {
    lastBalls = stash;
    syncedBallHistory = [];
    const boxes = document.querySelectorAll(".ballBox");
    boxes.forEach((box, i) => {
      box.innerText = lastBalls[i] !== undefined ? lastBalls[i] : "-";
    });
  }
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
  document.getElementById("marginText").innerText = (data.declaredBy || "A player") + " declared the match";
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
  window.rematchHasHappened = false;
  const el = document.getElementById("spectatorRematchChoice");
  if (el) el.remove();

  const buffer = [...spectatorRematchBuffer];
  spectatorRematchBuffer = [];

  // Determine the furthest stage reached in the buffer
  const hasBalls    = buffer.some(m => m.type === "BALL_RESULT" || m.type === "INNINGS_BREAK");
  const hasPreview  = buffer.some(m => m.type === "MATCH_DECISION");
  const hasTossResult = buffer.some(m => m.type === "TOSS_RESULT");
  const hasTossCaller = buffer.some(m => m.type === "TOSS_CALLER");

  if (hasBalls) {
    // Match is already running — sync from server (handles scoreboard + ball history)
    socket.send(JSON.stringify({ type: "SYNC_REQUEST" }));
    return;
  }

  if (hasPreview) {
    // Players are on preview screen — jump straight to preview
    const msg = buffer.find(m => m.type === "MATCH_DECISION");
    _applyMatchDecision(msg.payload);
    showScreen("matchPreviewScreen");
    updateDeclareBtn();
    startPreviewCountdown();
    return;
  }

  if (hasTossResult) {
    // Toss done but bat/bowl not chosen yet — play coin animation then decision screen
    // But first check: did MATCH_DECISION arrive live AFTER buffer was drained?
    // We handle that by setting a flag so live MATCH_DECISION navigates normally
    const msg = buffer.find(m => m.type === "TOSS_RESULT");
    showScreen("tossScreen");
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossWaiting").style.display = "block";
    document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
    animateCoinFlip(msg.payload.coin);
    setTimeout(() => {
      // After animation, check if MATCH_DECISION already arrived live during this delay
      // If yes, live handler already navigated — don't double-navigate
      const activeNow = document.querySelector(".screen.active").id;
      if (activeNow !== "tossScreen") return; // live message already moved us on
      showScreen("decisionScreen");
      document.getElementById("decisionWaiting").innerText =
        "🪙 " + msg.payload.coin.toUpperCase() + " — " + msg.payload.winner + " won the toss!";
      document.getElementById("decisionButtons").style.display = "none";
      document.getElementById("decisionWaiting").style.display = "block";
    }, 2500);
    return;
  }

  if (hasTossCaller) {
    // Toss just started — go to toss screen and wait
    showScreen("tossScreen");
    document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossWaiting").style.display = "block";
    document.getElementById("tossMessage").innerText     = "Waiting for toss...";
    isTossing = false;
    return;
  }

  // Buffer is empty — rematch just announced, nothing happened yet
  showScreen("tossScreen");
  document.getElementById("tossButtons").style.display = "none";
  document.getElementById("tossWaiting").style.display = "block";
  document.getElementById("tossMessage").innerText     = "Waiting for toss...";
  document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
  isTossing = false;
}

// Shared helper — applies MATCH_DECISION payload to DOM without navigating
function _applyMatchDecision(p) {
  matchMode    = p.mode;
  matchOvers   = p.overs || 0;
  matchWickets = p.wicketsLimit || 0;
  currentBattingName = p.batting;
  currentBowlingName = p.bowling;
  document.getElementById("previewBattingName").innerText = p.batting;
  document.getElementById("previewBowlingName").innerText = p.bowling;
  document.getElementById("previewMode").innerText    = matchMode === "limited" ? "Limited" : "Unlimited";
  document.getElementById("previewOvers").innerText   = matchMode === "limited" ? matchOvers : "∞";
  document.getElementById("previewWickets").innerText = matchWickets;
  document.getElementById("battingName").innerText    = "Bat: " + p.batting;
  document.getElementById("bowlingName").innerText    = "Bowl: " + p.bowling;
  document.getElementById("modeDisplay").innerText    = "Single • " + (matchMode === "limited" ? "Limited" : "Unlimited");
  lastBalls = [];
  localBallCount = 0;
  currentInnings = 1;
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

// ── SYNC_STATE ──
if (data.type === "SYNC_STATE") {
  const p = data.payload;

  // Restore match config
  matchMode    = p.mode;
  matchOvers   = p.overs;
  matchWickets = p.wicketsLimit;
  currentInnings = p.currentInnings;

  // Restore player name displays
  document.getElementById("teamA").innerText = p.playerA || "Empty";
  document.getElementById("teamB").innerText = p.playerB || "Empty";

  // ── Phase: match not started yet ──
  if (!p.matchStarted) {
    showScreen("lobbyScreen");
    return;
  }

  // ── Phase: toss in progress ──
  if (p.matchStarted && !p.battingTeam && !p.matchStopped) {
    showScreen("tossScreen");
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossWaiting").style.display = "block";
    document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
    if (p.tossWinnerSlot) {
      // Toss done, waiting for bat/bowl choice
      const winnerName = p.tossWinnerSlot === "A" ? p.playerA : p.playerB;
      document.getElementById("tossMessage").innerText = winnerName + " won the toss!";
      showScreen("decisionScreen");
      document.getElementById("decisionButtons").style.display = "none";
      document.getElementById("decisionWaiting").innerText = winnerName + " is choosing...";
    } else if (p.tossCaller) {
      const callerName = p.tossCaller === "A" ? p.playerA : p.playerB;
      document.getElementById("tossMessage").innerText = callerName + " is calling...";
    }
    return;
  }

if (p.battingTeam) {
  currentBattingName = p.battingName;
  currentBowlingName = p.bowlingName;

  document.getElementById("battingName").innerText  = "Bat: " + p.battingName;
  document.getElementById("bowlingName").innerText  = "Bowl: " + p.bowlingName;
  document.getElementById("mainScore").innerText    =
    (p.battingTeam === "A" ? p.scoreA : p.scoreB) + " / " +
    (p.battingTeam === "A" ? p.wicketsA : p.wicketsB);
  document.getElementById("inningsDisplay").innerText = "Innings: " + p.currentInnings;
  document.getElementById("modeDisplay").innerText    = "Single • " + (p.mode === "limited" ? "Limited" : "Unlimited");

  const balls = p.balls;
  if (p.mode === "limited") {
    document.getElementById("overDisplay").innerText      = Math.floor(balls / 6) + "." + (balls % 6);
    const ballsLeft = (p.overs * 6) - balls;
    document.getElementById("ballsLeftDisplay").innerText = ballsLeft;
  } else {
    document.getElementById("overDisplay").innerText      = "-";
    document.getElementById("ballsLeftDisplay").innerText = "-";
  }

  if (p.target) {
    const battingScore = p.battingTeam === "A" ? p.scoreA : p.scoreB;
    const runsLeft     = Math.max(p.target - battingScore, 0);
    const ballsLeft    = (p.overs * 6) - balls;
    document.getElementById("targetDisplay").innerText   = p.target;
    document.getElementById("runsLeftDisplay").innerText = runsLeft;
    document.getElementById("rrrDisplay").innerText      =
      (p.mode === "limited" && ballsLeft > 0) ? (runsLeft / ballsLeft).toFixed(2) : "-";
  } else {
    document.getElementById("targetDisplay").innerText   = "-";
    document.getElementById("runsLeftDisplay").innerText = "-";
    document.getElementById("rrrDisplay").innerText      = "-";
  }

  // Restore lock bar
  document.getElementById("lockStatusBar").style.display = "flex";
  document.getElementById("lockNameA").innerText = p.playerA;
  document.getElementById("lockNameB").innerText = p.playerB;
  document.getElementById("lockStatusA").classList.toggle("locked", p.lockedA);
  document.getElementById("lockStatusB").classList.toggle("locked", p.lockedB);
  document.getElementById("lockStateA").innerText = p.lockedA ? "Locked 🔒" : "Waiting ⏳";
  document.getElementById("lockStateB").innerText = p.lockedB ? "Locked 🔒" : "Waiting ⏳";

  // ── Restore ball history BEFORE showing screen ──
  lastBalls = [];
  document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");
  if (p.ballHistory && p.ballHistory.length > 0) {
    lastBalls = [...p.ballHistory];
    const boxes = document.querySelectorAll(".ballBox");
    boxes.forEach((box, i) => {
      box.innerText = lastBalls[i] !== undefined ? lastBalls[i] : "-";
    });
  }

  // ── Stash ball history — will be restored after preview countdown ──
  syncedBallHistory = (p.ballHistory && p.ballHistory.length > 0) ? [...p.ballHistory] : [];

  // Hide player controls (spectator)
  document.querySelector(".handContainer").style.display = "none";
  document.querySelector(".btnLock").style.display       = "none";
  document.querySelector(".controlLabel").style.display  = "none";
  document.querySelector(".selectedLabel").style.display = "none";
  document.getElementById("ballMessage").innerText       = "Watching the match...";

  updateDeclareBtn();

  // Show preview first, then startFromPreview() will restore the stashed ball history
  document.getElementById("previewBattingName").innerText = p.battingName;
  document.getElementById("previewBowlingName").innerText = p.bowlingName;
  document.getElementById("previewMode").innerText        = p.mode === "limited" ? "Limited" : "Unlimited";
  document.getElementById("previewOvers").innerText       = p.mode === "limited" ? p.overs : "∞";
  document.getElementById("previewWickets").innerText     = p.wicketsLimit;
  showScreen("matchPreviewScreen");
  startPreviewCountdown();
}
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
  if (isSpectator && window.rematchHasHappened) {
    spectatorRematchBuffer.push(data);
    return;
  }
  showScreen("tossScreen");
  document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
  isTossing = false;

  const iAmCaller = data.payload.caller === mySlot;
  if (isSpectator) {
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossWaiting").style.display = "block";
    document.getElementById("tossMessage").innerText     = "Waiting for toss...";
  } else {
    document.getElementById("tossButtons").style.display  = iAmCaller ? "flex" : "none";
    document.getElementById("tossWaiting").style.display  = iAmCaller ? "none" : "block";
    document.getElementById("tossMessage").innerText      = iAmCaller ? "Make your call!" : "Opponent is calling...";
  }
}

    // ── TOSS_RESULT ──
    if (data.type === "TOSS_RESULT") {
  if (isSpectator && window.rematchHasHappened) {
    spectatorRematchBuffer.push(data);
    return;
  };
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
  if (isSpectator && window.rematchHasHappened) {
    spectatorRematchBuffer.push(data);
    return;
  }

  _applyMatchDecision(data.payload); // ← use shared helper

  showScreen("matchPreviewScreen");
  updateDeclareBtn();
  startPreviewCountdown();
}

    // ── BALL_RESULT ──
    if (data.type === "BALL_RESULT") {
  if (isSpectator && window.rematchHasHappened) {
    spectatorRematchBuffer.push(data);
    return;
  }
  window.handLocked = false;
  selectedFingers   = [];
  document.querySelectorAll('.handLayer').forEach(l => { if (!l.classList.contains('base')) l.classList.remove('open'); });
  document.getElementById("selectedDisplay").innerText = "None";

  // ← NEW: if spectator is still on preview, keep stash in sync
  const activeNow = document.querySelector(".screen.active")?.id;
  if (isSpectator && activeNow === "matchPreviewScreen") {
    const ballEntry = data.payload.out ? "W" : data.payload.lastRuns;
    if (syncedBallHistory.length >= 6) syncedBallHistory = [];
    syncedBallHistory.push(ballEntry);
    // still update scoreboard silently so it's ready when game screen opens
    updateScoreboard(data.payload);
    updateDeclareBtn();
    return; // don't touch lastBalls or ballBoxes yet
  }

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
if (isSpectator && window.rematchHasHappened) {
    spectatorRematchBuffer.push(data);
    return;
  }
  window.handLocked = false;
  const p = data.payload;

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

  currentInnings = 2;
  updateDeclareBtn();

  // ← Point 9: show last ball result for 600ms first, then switch screen
  setTimeout(() => {
  lastBalls = [];
  localBallCount = 0;
  showScreen("inningsBreakScreen");
  startBreakCountdown();
}, 900);
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
    // ← Reset back to waiting message after a beat
    setTimeout(() => {
      document.getElementById("rematchStatus").innerText = "Waiting to see if players rematch...";
    }, 500);
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
  spectatorRematchBuffer = []; // ← clear any stale buffer from previous match
  window.rematchHasHappened = true;
  const old = document.getElementById("spectatorRematchChoice");
  if (old) old.remove();

  if (isSpectator) {
    // Do NOT reset spectatorWatchingRematch here — keep it false until watchRematch() is clicked
    window.rematchHasHappened = true;
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

/* script.js — Settings & Keyboard Control */

// ── Default keybinds ──
const DEFAULT_KEYBINDS = {
  // ── Game controls ──
  thumb:      'Digit1',
  index:      'Digit2',
  middle:     'Digit3',
  ring:       'Digit4',
  pinky:      'Digit5',
  lock:       'Space',
  toss_heads: 'KeyH',
  toss_tails: 'KeyT',
  toss_pass:  'KeyP',
  bat:        'KeyB',
  bowl:       'KeyW',
  // ── UI shortcuts ──
  confirm:    'Enter',
  back_cancel:'Escape',
  theme:      'Backquote',
  spectate:   'ShiftLeft',
  settings:   'F1',
  declare:    'KeyD',
};

const KEYBIND_LABELS = {
  thumb:      '👍 Thumb',
  index:      '☝️ Index',
  middle:     '🖕 Middle',
  ring:       '💍 Ring',
  pinky:      '🤙 Pinky',
  lock:       '🔒 Lock Hand',
  toss_heads: '🪙 Toss — Heads',
  toss_tails: '🪙 Toss — Tails',
  toss_pass:  '🪙 Toss — Pass',
  bat:        '🏏 Choose Bat',
  bowl:       '🎳 Choose Bowl',
  confirm:    '✅ Confirm / Enter',
  back_cancel:'⬅️ Back / Cancel / Esc',
  theme:      '🌙 Toggle Theme',
  settings:   '⚙️ Open Settings',
  declare:    '🏳️ Declare Match',
  spectate:   '👁️ Spectate Join (Button+Enter)',
};

// Which keybinds are "risky" — rebinding may break expected behaviour
const RISKY_KEYBINDS = new Set(['confirm', 'back_cancel', 'spectate']);
const RISKY_REASONS = {
  confirm:    'This key confirms actions on every screen (Enter). Rebinding it may make navigation impossible.',
  back_cancel:'This key cancels popups and goes back on all screens (Esc). Rebinding it may lock you in screens.',
  spectate:   'This key is held while pressing Confirm to join as spectator. Must be a modifier key (Shift/Alt/Ctrl).',
};

let keybinds = { ...DEFAULT_KEYBINDS };
let keyboardEnabled = false;
let mouseEnabled    = true;
let sfxEnabled      = true;
let sfxVolume       = 80;

// Load saved settings
function loadSettings() {
  try {
    const saved = localStorage.getItem('crickverse_settings');
    if (!saved) return;
    const s = JSON.parse(saved);
    if (s.keybinds)        keybinds        = { ...DEFAULT_KEYBINDS, ...s.keybinds };
    if (s.keyboardEnabled !== undefined) keyboardEnabled = s.keyboardEnabled;
    if (s.mouseEnabled    !== undefined) mouseEnabled    = s.mouseEnabled;
    if (s.sfxEnabled      !== undefined) sfxEnabled      = s.sfxEnabled;
    if (s.sfxVolume       !== undefined) sfxVolume       = s.sfxVolume;
    if (s.bgmEnabled      !== undefined) bgmEnabled      = s.bgmEnabled;
    if (s.bgmVolume       !== undefined) bgmVolume       = s.bgmVolume;
  } catch(e) {}
}

function saveSettings() {
  localStorage.setItem('crickverse_settings', JSON.stringify({
    keybinds, keyboardEnabled, mouseEnabled,
    sfxEnabled, sfxVolume, bgmEnabled, bgmVolume
  }));
}

let bgmEnabled = true;
let bgmVolume  = 50;
const bgmAudio = document.getElementById('bgmAudio');
bgmAudio.src    = 'sounds/bgm.mp3';
bgmAudio.loop   = true;
bgmAudio.volume = bgmVolume / 100;

// BGM starts on first user interaction (browser autoplay policy)
function initBGM() {
  if (!bgmEnabled) return;
  bgmAudio.play().catch(() => {});
}

function toggleBGM() {
  bgmEnabled = !bgmEnabled;
  document.getElementById('bgmToggleTrack').classList.toggle('on', bgmEnabled);
  if (bgmEnabled) bgmAudio.play().catch(() => {});
  else bgmAudio.pause();
  saveSettings();
}

function setBGMVolume(val) {
  bgmVolume = parseInt(val);
  document.getElementById('bgmVolumeVal').textContent = bgmVolume;
  bgmAudio.volume = bgmEnabled ? bgmVolume / 100 : 0;
  saveSettings();
}

// ── Open / Close settings ──
function openSettings() {
  loadSettingsUI();
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
  stopListening(); // cancel any active keybind capture
}

function switchSettingsTab(tab) {
  ['controls','audio'].forEach(t => {
    document.getElementById('sTab-' + t).classList.toggle('active', t === tab);
    document.getElementById('settingsPane-' + t).style.display = t === tab ? 'flex' : 'none';
  });
}

// ── Populate UI from state ──
function loadSettingsUI() {
  document.getElementById('kbToggleTrack').classList.toggle('on', keyboardEnabled);
  document.getElementById('mouseToggleTrack').classList.toggle('on', mouseEnabled);
  document.getElementById('sfxToggleTrack').classList.toggle('on', sfxEnabled);
  document.getElementById('sfxVolumeSlider').value = sfxVolume;
  document.getElementById('sfxVolumeVal').textContent = sfxVolume;
  document.getElementById('bgmToggleTrack').classList.toggle('on', bgmEnabled);
  document.getElementById('bgmVolumeSlider').value = bgmVolume;
  document.getElementById('bgmVolumeVal').textContent = bgmVolume;
  renderKeybindList();
}

function renderKeybindList() {
  const list = document.getElementById('keybindList');
  list.innerHTML = '';

  // Find all codes that appear more than once
  const codeCounts = {};
  for (const code of Object.values(keybinds)) {
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  }

  for (const [action, code] of Object.entries(keybinds)) {
    const isRisky     = RISKY_KEYBINDS.has(action);
    const isDuplicate = codeCounts[code] > 1;
    const row = document.createElement('div');
    row.className = 'keybindRow';
    row.innerHTML = `
      <span class="keybindName">
        ${KEYBIND_LABELS[action] || action}
        ${isRisky ? `<button class="keybindWarningBtn" onclick="showKeybindWarning('${action}')" title="Risky keybind">⚠️</button>` : ''}
      </span>
      <button class="keybindKey${isDuplicate ? ' conflict' : ''}" id="kb-${action}" onclick="startListening('${action}')">${codeToLabel(code)}</button>
    `;
    list.appendChild(row);
  }
}

function showKeybindWarning(action) {
  const reason = RISKY_REASONS[action] || 'This keybind affects core navigation.';
  const label  = KEYBIND_LABELS[action] || action;
  showAlert(`\n${reason}`, '⚠️');
}

// Convert KeyboardEvent.code → readable label
function codeToLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Digit'))  return code.replace('Digit','');
  if (code.startsWith('Key'))    return code.replace('Key','');
  if (code === 'Space')          return 'SPC';
  if (code === 'Enter')          return 'ENT';
  if (code === 'Backspace')      return 'BSP';
  if (code.startsWith('Arrow'))  return code.replace('Arrow','↑↓←→'.split('')[['Up','Down','Left','Right'].indexOf(code.replace('Arrow',''))]) || code;
  if (code.startsWith('Numpad')) return 'N' + code.replace('Numpad','');
  if (code.startsWith('F') && !isNaN(code.slice(1))) return code;
  return code.slice(0,4);
}

// ── Keybind capture ──
let listeningAction = null;
let listeningKeyEl  = null;

function startListening(action) {
  stopListening();
  listeningAction = action;
  listeningKeyEl  = document.getElementById('kb-' + action);
  if (listeningKeyEl) listeningKeyEl.classList.add('listening');
  document.getElementById('keybindTarget').textContent = KEYBIND_LABELS[action] || action;
  document.getElementById('keybindCapture').style.display = 'flex';
  document.addEventListener('keydown', captureKey, { once: true });
}

function stopListening() {
  if (listeningKeyEl) listeningKeyEl.classList.remove('listening');
  listeningAction = null;
  listeningKeyEl  = null;
  document.getElementById('keybindCapture').style.display = 'none';
  document.removeEventListener('keydown', captureKey);
}

function captureKey(e) {
  e.preventDefault();
  document.getElementById('keybindCapture').style.display = 'none';
  if (e.code === 'Escape') { stopListening(); return; }
  if (listeningAction) {
    keybinds[listeningAction] = e.code;
    saveSettings();
    renderKeybindList();
  }
  listeningAction = null;
  listeningKeyEl  = null;
}

function resetKeybinds() {
  keybinds = { ...DEFAULT_KEYBINDS };
  saveSettings();
  renderKeybindList();
  showToast('✅ Keybinds reset to defaults', 'var(--green)', '#0f172a');
}

// ── Toggle handlers ──
function toggleKeyboard() {
  keyboardEnabled = !keyboardEnabled;
  document.getElementById('kbToggleTrack').classList.toggle('on', keyboardEnabled);
  saveSettings();
  showToast(keyboardEnabled ? '⌨️ Keyboard enabled' : '⌨️ Keyboard disabled', 'var(--accent)');
}

function getTopPopup() {
  const all = [...document.querySelectorAll('.popupOverlay')].filter(
    el => el.id !== 'settingsModal' && el.id !== 'keybindCapture' && el.style.display !== 'none'
  );
  return all.length ? all[all.length - 1] : null;
}

function toggleMouse() {
  mouseEnabled = !mouseEnabled;
  document.getElementById('mouseToggleTrack').classList.toggle('on', mouseEnabled);
  // Toggle pointer-events on hand & lock button
  const hand = document.querySelector('.handContainer');
  const lockBtn = document.querySelector('.btnLock');
  if (hand)    hand.style.pointerEvents    = mouseEnabled ? 'auto' : 'none';
  if (lockBtn) lockBtn.style.pointerEvents = mouseEnabled ? 'auto' : 'none';
  saveSettings();
  showToast(mouseEnabled ? '🖱️ Mouse enabled' : '🖱️ Mouse disabled', 'var(--accent)');
}

function toggleSFX() {
  sfxEnabled = !sfxEnabled;
  document.getElementById('sfxToggleTrack').classList.toggle('on', sfxEnabled);
  saveSettings();
}

function setSFXVolume(val) {
  sfxVolume = parseInt(val);
  document.getElementById('sfxVolumeVal').textContent = sfxVolume;
  // Apply to game sounds
  Object.values(sounds).forEach(a => { a.volume = sfxEnabled ? sfxVolume / 100 : 0; });
  saveSettings();
}

// ── Patch playSound to respect settings ──
const _origPlaySound = playSound;
// Override playSound defined earlier
window.playSound = function(name) {
  if (!sfxEnabled) return;
  if (sounds[name]) {
    sounds[name].volume  = sfxVolume / 100;
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  }
};

// ── Global keyboard listener ──
document.addEventListener('keydown', (e) => {
  const key = e.code;

  // ── Layer 1: keybind capture open ──
  if (document.getElementById('keybindCapture').style.display !== 'none') {
    if (key === 'Escape') { e.preventDefault(); stopListening(); }
    return;
  }

  // ── Layer 2: settings modal open ──
  if (document.getElementById('settingsModal').style.display !== 'none') {
    if (key === keybinds.back_cancel || key === 'Escape') { e.preventDefault(); closeSettings(); }
    return;
  }

  // ── Layer 3: popup stacking — ALWAYS use topmost visible popup ──
  const topPopup = getTopPopup();
  if (topPopup) {
    const popupId = topPopup.id;

    if (key === keybinds.confirm || key === 'Enter') {
      e.preventDefault();
      // inMatchLeavePopup: Enter = Leave (first btnPrimary = Leave)
      const primary = topPopup.querySelector('.btnPrimary');
      if (primary) primary.click();
    }

    if (key === keybinds.back_cancel || key === 'Escape') {
      e.preventDefault();
      // Always find the Cancel / last btnSecondary in the top popup
      const allSecondary = topPopup.querySelectorAll('.btnSecondary');
      const cancelBtn = allSecondary[allSecondary.length - 1]; // last secondary = Cancel
      if (cancelBtn) cancelBtn.click();
    }

    // D key = Declare inside inMatchLeavePopup
    if (popupId === 'inMatchLeavePopup' && key === keybinds.declare) {
      e.preventDefault();
      showDeclareFromMenu();
    }

    return;
  }

  // ── Layer 4: screen-level shortcuts (always-on) ──
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return;
  const screenId = activeScreen.id;

  if (key === keybinds.theme || key === 'Backquote') {
    e.preventDefault(); toggleTheme(); return;
  }

  if (key === keybinds.settings || key === 'F1') {
    const sb = document.getElementById('settingsBtn');
    if (sb && sb.style.display !== 'none') { e.preventDefault(); openSettings(); }
    return;
  }

  // Declare key — only when declare button is visible (game screen, innings 2 batter)
  if (key === keybinds.declare) {
    const declareBtn = document.getElementById('gameDeclareBtn');
    if (declareBtn && declareBtn.style.display !== 'none') { e.preventDefault(); declareMatch(); }
    return;
  }

// Decision screen — bat/bowl always-on (like Enter=bat, these are the dedicated keys)
  if (screenId === 'decisionScreen') {
    if (key === keybinds.bat  && key !== keybinds.confirm) { e.preventDefault(); sendDecision('bat');  return; }
    if (key === keybinds.bowl && key !== keybinds.confirm) { e.preventDefault(); sendDecision('bowl'); return; }
  }

  // ── Esc / Back ──
  if (key === keybinds.back_cancel || key === 'Escape') {
    e.preventDefault();

    // Result screen: Esc declines rematch first if request showing, else back
    if (screenId === 'resultScreen') {
      const receiverBtns = document.getElementById('rematchReceiverBtns');
      if (receiverBtns && receiverBtns.style.display !== 'none') {
        declineRematch();
      } else {
        exitMatch();
      }
      return;
    }

    const backBtn = document.getElementById('globalBackBtn');
    if (backBtn && backBtn.style.display !== 'none') { handleBack(); }
    return;
  }

  // ── Enter / Confirm ──
  if (key === keybinds.confirm || key === 'Enter') {
    e.preventDefault();

    if (screenId === 'nameScreen') { goToMode(); return; }

    if (screenId === 'modeScreen') {
      const code = document.getElementById('joinRoomCodeInput').value.trim();
      if (code) {
        // Only spectate if the spectate modifier key is physically held RIGHT NOW
        // Never infer from keybind string alone — that caused Enter to always spectate
        const spectateKeyHeld = e.shiftKey || e.altKey || e.ctrlKey
          ? (
              (keybinds.spectate.startsWith('Shift') && e.shiftKey) ||
              (keybinds.spectate.startsWith('Alt')   && e.altKey)   ||
              (keybinds.spectate.startsWith('Control') && e.ctrlKey)
            )
          : false;
        if (spectateKeyHeld) spectateRoom();
        else joinRoom();
      }
      return;
    }

    if (screenId === 'roomSetupScreen') { createRoom(); return; }

    if (screenId === 'lobbyScreen') {
      if (!isSpectator && isHost) startMatch();
      else if (!isSpectator && !isHost) sendReady();
      return;
    }

    if (screenId === 'matchPreviewScreen') { skipPreview(); return; }
    if (screenId === 'inningsBreakScreen') { skipBreak(); return; }

    if (screenId === 'resultScreen') {
      const specChoice = document.getElementById('spectatorRematchChoice');
      if (specChoice) {
        const watchBtn = specChoice.querySelector('.btnPrimary');
        if (watchBtn) watchBtn.click();
        return;
      }
      const receiverBtns = document.getElementById('rematchReceiverBtns');
      if (receiverBtns && receiverBtns.style.display !== 'none') {
        acceptRematch();
      } else {
        const rematchBtn = document.getElementById('rematchBtn');
        if (rematchBtn && rematchBtn.style.display !== 'none') requestRematch();
      }
      return;
    }

    if (screenId === 'decisionScreen') {
      const btns = document.getElementById('decisionButtons');
      if (btns && btns.style.display !== 'none') sendDecision('bat');
      return;
    }

    return;
  }

  // ── Layer 5: keyboard-mode-gated game controls ──
  if (!keyboardEnabled) return;
  if (listeningAction)  return;

  if (screenId === 'tossScreen') {
    const btns = document.getElementById('tossButtons');
    if (btns && btns.style.display !== 'none') {
      if (key === keybinds.toss_heads) { e.preventDefault(); sendToss('head'); }
      if (key === keybinds.toss_tails) { e.preventDefault(); sendToss('tail'); }
      if (key === keybinds.toss_pass)  { e.preventDefault(); sendToss('pass'); }
    }
  }

  if (screenId === 'gameScreen' && !isSpectator) {
    if (window.handLocked) return;
    const fingerMap = {
      [keybinds.thumb]:  'thumb',
      [keybinds.index]:  'index',
      [keybinds.middle]: 'middle',
      [keybinds.ring]:   'ring',
      [keybinds.pinky]:  'pinky',
    };
    if (fingerMap[key]) { e.preventDefault(); toggleHandFinger(fingerMap[key]); }
    if (key === keybinds.lock) { e.preventDefault(); lockHand(); }
  }
});

// Init on load
loadSettings();
// Show settings btn on name screen immediately (showScreen not called yet)
document.getElementById('settingsBtn').style.display = 'flex';
// BGM: start on first user interaction (browser autoplay policy)
document.addEventListener('click',  initBGM, { once: true });
document.addEventListener('keydown', initBGM, { once: true });
