/* script.js — full replace with all new features */

let lastBalls = [];
let selectedFingers = [];
let socket = null;
let playerName = "";
let roomCode = "";
let isHost = false;
let gameMode = "limited";
let previewCountdownTimer = null;
let breakCountdownTimer = null;
let matchWickets = 0;
let isTossing = false;
let isSpectator = false;

// Game state tracked on frontend
let mySlot = null;
let currentBattingName = "";
let currentBowlingName = "";
let matchMode = "limited";
let matchOvers = 0;

// Match result data for enhanced display
let matchResultData = null;

// Rematch state
let rematchRequested = false;
let rematchRequestedBy = null;

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

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goToMode() {
  const nameInput = document.getElementById("playerNameInput").value.trim();
  if (!nameInput) { alert("Enter your name first!"); return; }
  playerName = nameInput;
  showScreen("modeScreen");
}

function spectateRoom() {
  const code = document.getElementById("joinRoomCodeInput").value.trim();
  if (!code) { alert("Enter room code!"); return; }
  roomCode = code;
  isHost = false;
  isSpectator = true;
  connectToServer(code, null, null, true);
  showScreen("lobbyScreen");
}

function startPreviewCountdown() {
  let secs = 5;
  document.getElementById("previewCountdownNum").innerText = secs;

  if (previewCountdownTimer) clearInterval(previewCountdownTimer);

  previewCountdownTimer = setInterval(() => {
    secs--;
    document.getElementById("previewCountdownNum").innerText = secs;
    if (secs <= 0) {
      clearInterval(previewCountdownTimer);
      previewCountdownTimer = null;
      startFromPreview();
    }
  }, 1000);
}

function skipPreview() {
  if (previewCountdownTimer) {
    clearInterval(previewCountdownTimer);
    previewCountdownTimer = null;
  }
  startFromPreview();
}

function startFromPreview() {
  lastBalls = [];
  selectedFingers = [];
  document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
  document.getElementById("selectedDisplay").innerText = "None";

  document.getElementById("mainScore").innerText = "0 / 0";
  document.getElementById("overDisplay").innerText = "0.0";
  document.getElementById("ballsLeftDisplay").innerText =
    matchMode === "limited" ? (matchOvers * 6) : "-";
  document.getElementById("runsLeftDisplay").innerText = "-";
  document.getElementById("rrrDisplay").innerText = "-";
  document.getElementById("inningsDisplay").innerText = "Innings: 1";
  document.getElementById("ballMessage").innerText = "";
  document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");
  window.handLocked = false;

  resetLockBar();

  if (isSpectator) {
    document.querySelector(".handContainer").style.display = "none";
    document.querySelector(".btnLock").style.display = "none";
    document.querySelector(".controlLabel").style.display = "none";
    document.querySelector(".selectedLabel").style.display = "none";
    document.getElementById("ballMessage").innerText = "Watching the match...";
  }

  showScreen("gameScreen");
}

function goToRoomSetup() {
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
  const overs = document.getElementById("oversInput").value;
  const wickets = document.getElementById("wicketsInput").value;
  const code = document.getElementById("createRoomCodeInput").value.trim();

  if (gameMode === "limited" && (!overs || !wickets || !code)) {
    alert("Fill all fields!"); return;
  }
  if (gameMode === "unlimited" && (!wickets || !code)) {
    alert("Fill all fields!"); return;
  }

  roomCode = code;
  isHost = true;
  connectToServer(code, gameMode === "limited" ? overs : null, wickets);
  showScreen("lobbyScreen");
}

function joinRoom() {
  const code = document.getElementById("joinRoomCodeInput").value.trim();
  if (!code) { alert("Enter room code!"); return; }
  roomCode = code;
  isHost = false;
  connectToServer(code, null, null);
  showScreen("lobbyScreen");
}

function startMatch() {
  const teamB = document.getElementById("teamB").innerText;
  if (!isHost) { alert("Only host can start match"); return; }
  if (teamB === "Empty" || teamB === "Waiting...") {
    alert("Waiting for opponent to join"); return;
  }
  socket.send(JSON.stringify({ type: "START_MATCH" }));
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode);

  // Use a simple toast-style overlay instead of hijacking the result screen
  const toast = document.createElement("div");
  toast.innerText = "✅ Room code copied!";
  toast.style.cssText = `
    position:fixed; bottom:30px; left:50%; transform:translateX(-50%);
    background:var(--green); color:#0f172a;
    padding:12px 24px; border-radius:10px;
    font-weight:700; font-size:15px;
    z-index:9999; box-shadow:0 4px 16px rgba(0,0,0,0.3);
    animation: fadeInUp 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function continueGame() {
  if (window.afterCopy) {
    window.afterCopy = false;
    showScreen("lobbyScreen");
    return;
  }
  if (window.matchOverResult) {
    window.matchOverResult = false;
    location.reload();
    return;
  }
  if (window.afterInningsBreak) {
    window.afterInningsBreak = false;
    showScreen("gameScreen");
    return;
  }
  showScreen("gameScreen");
}

function toggleTheme() {
  document.body.classList.toggle("light");
  document.getElementById("themeToggle").innerText =
    document.body.classList.contains("light") ? "☀️" : "🌙";
}

function sendToss(choice) {
  if (isTossing) return;
  
  socket.send(JSON.stringify({
    type: "TOSS_CHOICE",
    player: mySlot,
    choice
  }));
  
  if (choice !== "pass") {
    isTossing = true;
    document.getElementById("tossButtons").style.display = "none";
    document.getElementById("tossMessage").innerText = "Flipping coin...";
  }
}

function animateCoinFlip(result) {
  const coin = document.getElementById("coin");
  const message = document.getElementById("tossMessage");
  
  coin.classList.remove("flip-heads", "flip-tails");
  void coin.offsetWidth;
  
  if (result === "head") {
    coin.classList.add("flip-heads");
  } else {
    coin.classList.add("flip-tails");
  }
  
  message.innerText = "Coin is in the air...";
  
  setTimeout(() => {
    message.innerText = result === "head" ? "It's HEADS! 🟡" : "It's TAILS! 🔵";
    isTossing = false;
  }, 2000);
}

function sendDecision(choice) {
  socket.send(JSON.stringify({
    type: "BAT_BOWL_CHOICE",
    player: mySlot,
    choice
  }));
}

function toggleHandFinger(finger) {
  if (window.handLocked) return;
  
  const fingerElement = document.getElementById(finger);
  
  if (selectedFingers.includes(finger)) {
    selectedFingers = selectedFingers.filter(f => f !== finger);
    fingerElement.classList.remove("open");
  } else {
    selectedFingers.push(finger);
    fingerElement.classList.add("open");
  }
  
  const fingerNames = {
    thumb: "👍 Thumb",
    index: "☝️ Index", 
    middle: "🖕 Middle",
    ring: "💍 Ring",
    pinky: "🤙 Pinky"
  };
  
  const displayText = selectedFingers.length > 0 
    ? selectedFingers.map(f => fingerNames[f]).join(", ")
    : "None";
  
  document.getElementById("selectedDisplay").innerText = displayText;
}

function lockHand() {
  if (selectedFingers.length === 0) { 
    alert("Select at least one finger!"); 
    return; 
  }
  if (window.handLocked) return;
  
  window.handLocked = true;
  
  socket.send(JSON.stringify({
    type: "HAND_SELECT",
    player: mySlot,
    fingers: selectedFingers
  }));

  socket.send(JSON.stringify({
    type: "HAND_LOCK",
    player: mySlot
  }));
  
  const hand = document.querySelector(".hand");
  hand.classList.add("locking");
  
  setTimeout(() => {
    document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
    hand.classList.remove("locking");
  }, 500);
  
  document.getElementById("selectedDisplay").innerText = "🔒 Locked! Waiting...";
}

function updateScoreboard(payload) {
  const {
    battingName, bowlingName,
    scoreA, scoreB, wicketsA, wicketsB,
    balls, ballsLeft, innings, target,
    out, lastRuns
  } = payload;

  currentBattingName = battingName;
  currentBowlingName = bowlingName;

  document.getElementById("battingName").innerText = "Bat: " + battingName;
  document.getElementById("bowlingName").innerText = "Bowl: " + bowlingName;

  const teamAName = document.getElementById("teamA").innerText;
  const battingScore = battingName === teamAName ? scoreA : scoreB;
  const battingWickets = battingName === teamAName ? wicketsA : wicketsB;

  document.getElementById("batterStats").innerText =
    "(" + battingScore + "-" + battingWickets + ")";

  document.getElementById("mainScore").innerText =
    battingScore + " / " + battingWickets;

  if (matchMode === "limited") {
    const over = Math.floor(balls / 6);
    const ball = balls % 6;
    document.getElementById("overDisplay").innerText = over + "." + ball;
    document.getElementById("ballsLeftDisplay").innerText = ballsLeft ?? "-";
  } else {
    document.getElementById("overDisplay").innerText = "-";
    document.getElementById("ballsLeftDisplay").innerText = "-";
  }

  document.getElementById("inningsDisplay").innerText = "Innings: " + innings;

  if (target) {
    const runsLeft = Math.max(target - battingScore, 0);
    document.getElementById("targetDisplay").innerText = target;
    document.getElementById("runsLeftDisplay").innerText = runsLeft;

    if (matchMode === "limited" && ballsLeft > 0) {
      document.getElementById("rrrDisplay").innerText =
        (runsLeft / ballsLeft * 6).toFixed(2);
    } else {
      document.getElementById("rrrDisplay").innerText = "-";
    }
  } else {
    document.getElementById("targetDisplay").innerText = "-";
    document.getElementById("runsLeftDisplay").innerText = "-";
    document.getElementById("rrrDisplay").innerText = "-";
  }

  document.getElementById("modeDisplay").innerText =
    "Single • " + (matchMode === "limited" ? "Limited" : "Unlimited");
}

function updateBallHistory(balls, out, lastRuns) {
  const ballRun = out ? "W" : lastRuns;

  if (balls % 6 === 1) {
    lastBalls = [];
  }

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

function startBreakCountdown() {
  let secs = 5;
  document.getElementById("breakCountdownNum").innerText = secs;

  if (breakCountdownTimer) clearInterval(breakCountdownTimer);

  breakCountdownTimer = setInterval(() => {
    secs--;
    document.getElementById("breakCountdownNum").innerText = secs;
    if (secs <= 0) {
      clearInterval(breakCountdownTimer);
      breakCountdownTimer = null;
      goToInnings2();
    }
  }, 1000);
}

function skipBreak() {
  if (breakCountdownTimer) {
    clearInterval(breakCountdownTimer);
    breakCountdownTimer = null;
  }
  goToInnings2();
}

function goToInnings2() {
  lastBalls = [];
  selectedFingers = [];
  document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
  document.getElementById("selectedDisplay").innerText = "None";

  document.getElementById("mainScore").innerText = "0 / 0";
  document.getElementById("overDisplay").innerText = "0.0";
  document.getElementById("ballsLeftDisplay").innerText =
    matchMode === "limited" ? (matchOvers * 6) : "-";
  document.getElementById("runsLeftDisplay").innerText = "-";
  document.getElementById("rrrDisplay").innerText = "-";
  document.getElementById("inningsDisplay").innerText = "Innings: 2";
  document.getElementById("ballMessage").innerText = "";
  document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");
  window.handLocked = false;

  resetLockBar();

  if (isSpectator) {
    document.querySelector(".handContainer").style.display = "none";
    document.querySelector(".btnLock").style.display = "none";
    document.querySelector(".controlLabel").style.display = "none";
    document.querySelector(".selectedLabel").style.display = "none";
    document.getElementById("ballMessage").innerText = "Watching the match...";
  }

  showScreen("gameScreen");
}

function showBallMessage(out, lastRuns) {
  const msg = document.getElementById("ballMessage");
  if (out) {
    playSound("wicket");
    msg.innerText = "WICKET! 🔴";
    msg.style.color = "var(--red)";
  } else if (lastRuns === 6) {
    playSound("six");
    msg.innerText = "SIX! 🚀";
    msg.style.color = "var(--amber)";
  } else if (lastRuns === 4) {
    msg.innerText = "FOUR! 💥";
    msg.style.color = "var(--green)";
  } else if (lastRuns === 0) {
    msg.innerText = "DOT BALL •";
    msg.style.color = "var(--text-muted)";
  } else {
    msg.innerText = lastRuns + (lastRuns === 1 ? " RUN" : " RUNS");
    msg.style.color = "var(--text)";
  }
}

/// Enhanced result display
function displayMatchResult(data) {
  matchResultData = data;

  const { winner, scoreA, scoreB, wicketsA, wicketsB, ballsLeft } = data;
  const teamAName = document.getElementById("teamA").innerText;
  const teamBName = document.getElementById("teamB").innerText;

  document.getElementById("matchSummary").style.display = "block";
  document.getElementById("matchStats").style.display = "block";

  const isDraw = winner === "Draw";
  document.getElementById("resultEmoji").innerText = isDraw ? "🤝" : "🏆";
  document.getElementById("resultTitle").innerText = isDraw ? "It's a Draw!" : "Match Over!";

  if (isDraw) {
    document.getElementById("winnerText").innerText = "Match Drawn";
    document.getElementById("marginText").innerText = "Both teams scored equal runs";
  } else {
    document.getElementById("winnerText").innerText = "🎉 " + winner + " Wins!";
    const winnerIsA = winner === teamAName;
    const winnerScore = winnerIsA ? scoreA : scoreB;
    const loserScore = winnerIsA ? scoreB : scoreA;
    const runMargin = winnerScore - loserScore;
    document.getElementById("marginText").innerText =
      ballsLeft !== null && ballsLeft > 0
        ? `Won by ${runMargin} run${runMargin !== 1 ? "s" : ""} with ${ballsLeft} ball${ballsLeft !== 1 ? "s" : ""} remaining`
        : `Won by ${runMargin} run${runMargin !== 1 ? "s" : ""}`;
  }

  document.getElementById("team1Name").innerText = teamAName + ":";
  document.getElementById("team1Score").innerText = scoreA + "/" + wicketsA;
  document.getElementById("team2Name").innerText = teamBName + ":";
  document.getElementById("team2Score").innerText = scoreB + "/" + wicketsB;
  document.getElementById("ballsRemaining").innerText = ballsLeft !== null ? ballsLeft : "—";

  // Always clean up any leftover spectator rematch UI from previous match
  const oldChoice = document.getElementById("spectatorRematchChoice");
  if (oldChoice) oldChoice.remove();

  if (isSpectator) {
    // Spectators see result + status area for rematch updates + back button
    document.getElementById("matchSummary").style.display = "block";
    document.getElementById("matchStats").style.display = "block";
    document.getElementById("rematchSection").style.display = "block";
    document.getElementById("rematchBtn").style.display = "none";
    document.getElementById("rematchReceiverBtns").style.display = "none";
    document.getElementById("rematchStatus").innerText = "Waiting to see if players rematch...";
    document.getElementById("exitMatchBtn").style.display = "block";
  } else {
    document.getElementById("rematchBtn").style.display = "block";
    document.getElementById("rematchBtn").innerText = "🔄 Request Rematch";
    document.getElementById("rematchReceiverBtns").style.display = "none";
    document.getElementById("rematchStatus").innerText = "";
    document.getElementById("rematchSection").style.display = "block";
    document.getElementById("exitMatchBtn").style.display = "block";
  }
}

// Rematch functionality
function requestRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_REQUEST", player: mySlot }));
  document.getElementById("rematchBtn").style.display = "none";
  document.getElementById("rematchStatus").innerText = "⏳ Waiting for opponent...";
  // exitMatchBtn stays visible so requester can still back out
}

function watchRematch() {
  window.spectatorWatchingRematch = true;
  const el = document.getElementById("spectatorRematchChoice");
  if (el) el.remove();
  // Show toss screen — TOSS_CALLER already fired so manually set up spectator view
  showScreen("tossScreen");
  document.getElementById("tossButtons").style.display = "none";
  document.getElementById("tossWaiting").style.display = "block";
  document.getElementById("tossMessage").innerText = "Waiting for toss...";
  document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
}

function declineRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_DECLINE", player: mySlot }));
  document.getElementById("rematchReceiverBtns").style.display = "none";
  document.getElementById("rematchStatus").innerText = "❌ You declined.";
  // exitMatchBtn is already visible
}

function exitMatch() {
  location.reload();
}

// Server connection
function connectToServer(code, overs, wickets, spectate = false) {

  socket = new WebSocket(
    "wss://handcricket-server.mahin-aistudio.workers.dev/" + code
  );

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "JOIN_ROOM",
      payload: { 
        playerName, 
        overs, 
        wickets, 
        mode: gameMode,
        spectate
      }
    }));
  };

  socket.onmessage = (event) => {
    console.log("Received:", event.data);
    const data = JSON.parse(event.data);

    if (data.type === "ROOM_JOINED") {
      roomCode = data.payload.roomCode;
      mySlot = data.payload.slot;
      document.getElementById("lobbyRoomCode").innerText = roomCode;
      
      if (mySlot === "SPECTATOR") {
        isSpectator = true;
        const badge = document.createElement("div");
        badge.className = "spectatorBadge active";
        badge.innerText = "👁️ Spectating";
        badge.id = "spectatorBadge";
        document.body.appendChild(badge);
        
        document.getElementById("startMatchBtn").style.display = "none";
      }
    }

    if (data.type === "LOBBY_UPDATE") {
      document.getElementById("lobbyRoomCode").innerText = roomCode;
      document.getElementById("teamA").innerText = data.payload.teamA || "Empty";
      document.getElementById("teamB").innerText = data.payload.teamB || "Empty";
      
      if (data.payload.spectatorCount !== undefined) {
        document.getElementById("spectatorCount").innerText = data.payload.spectatorCount;
        document.getElementById("liveSpectatorCount").innerText = data.payload.spectatorCount;
      }
    }

    if (data.type === "TOSS_CALLER") {
      // Block spectators ONLY during rematch toss (they need to click "Watch Again" first)
      // During the first match, spectators follow along automatically
      if (isSpectator && !window.spectatorWatchingRematch && window.rematchHasHappened) return;

      showScreen("tossScreen");

      const coin = document.getElementById("coin");
      coin.classList.remove("flip-heads", "flip-tails");
      isTossing = false;

      const iAmCaller = data.payload.caller === mySlot;

      if (isSpectator) {
        document.getElementById("tossButtons").style.display = "none";
        document.getElementById("tossWaiting").style.display = "block";
        document.getElementById("tossMessage").innerText = "Waiting for toss...";
      } else {
        document.getElementById("tossButtons").style.display = iAmCaller ? "flex" : "none";
        document.getElementById("tossWaiting").style.display = iAmCaller ? "none" : "block";
        document.getElementById("tossMessage").innerText = iAmCaller
          ? "Make your call!"
          : "Opponent is calling...";
      }
    }

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

    if (data.type === "MATCH_DECISION") {
      matchMode = data.payload.mode;
      matchOvers = data.payload.overs || 0;
      matchWickets = data.payload.wicketsLimit || 0;
      currentBattingName = data.payload.batting;
      currentBowlingName = data.payload.bowling;

      document.getElementById("previewBattingName").innerText = data.payload.batting;
      document.getElementById("previewBowlingName").innerText = data.payload.bowling;
      document.getElementById("previewMode").innerText = 
        matchMode === "limited" ? "Limited" : "Unlimited";
      document.getElementById("previewOvers").innerText = 
        matchMode === "limited" ? matchOvers : "∞";
      document.getElementById("previewWickets").innerText = matchWickets;

      lastBalls = [];
      document.getElementById("mainScore").innerText = "0 / 0";
      document.getElementById("overDisplay").innerText = "0.0";
      document.getElementById("targetDisplay").innerText = "-";
      document.getElementById("ballsLeftDisplay").innerText =
        matchMode === "limited" ? (matchOvers * 6) : "-";
      document.getElementById("runsLeftDisplay").innerText = "-";
      document.getElementById("rrrDisplay").innerText = "-";
      document.getElementById("battingName").innerText = "Bat: " + data.payload.batting;
      document.getElementById("bowlingName").innerText = "Bowl: " + data.payload.bowling;
      document.getElementById("inningsDisplay").innerText = "Innings: 1";
      document.getElementById("modeDisplay").innerText =
        "Single • " + (matchMode === "limited" ? "Limited" : "Unlimited");
      document.getElementById("ballMessage").innerText = "";
      document.querySelectorAll(".ballBox").forEach(b => b.innerText = "-");

      showScreen("matchPreviewScreen");
      startPreviewCountdown();
    }

    if (data.type === "BALL_RESULT") {
      window.handLocked = false;
if (isSpectator) {
        document.getElementById("lockStatusA").classList.remove("locked");
        document.getElementById("lockStatusB").classList.remove("locked");
        document.getElementById("lockStateA").innerText = "Waiting ⏳";
        document.getElementById("lockStateB").innerText = "Waiting ⏳";
      }
      selectedFingers = [];
      document.querySelectorAll(".finger").forEach(f => f.classList.remove("open"));
      document.getElementById("selectedDisplay").innerText = "None";

      updateScoreboard(data.payload);
      updateBallHistory(data.payload.balls, data.payload.out, data.payload.lastRuns);
      showBallMessage(data.payload.out, data.payload.lastRuns);

      if (data.payload.matchOver) {
        setTimeout(() => {
          displayMatchResult(data.payload);
          window.afterCopy = false;
          window.matchOverResult = true;
          showScreen("resultScreen");
        }, 900);
      }
    }

    if (data.type === "INNINGS_BREAK") {
      window.handLocked = false;
      lastBalls = [];

      const p = data.payload;

      document.getElementById("breakBattedName").innerText = p.nextBowlingName;
      document.getElementById("breakScore1").innerText =
        p.innings1Score + " / " + p.innings1Wickets;
      document.getElementById("breakTarget").innerText = p.target;
      document.getElementById("breakBattingNext").innerText = p.nextBattingName;
      document.getElementById("breakModeInfo").innerText =
        p.mode === "limited"
          ? "Needs " + p.target + " in " + (p.overs * 6) + " balls"
          : "Needs " + p.target + " runs (no ball limit)";

      showScreen("inningsBreakScreen");
      startBreakCountdown();
    }

if (data.type === "LOCK_STATUS") {
      if (!isSpectator) return; // players don't need this

      const { lockedA, lockedB, nameA, nameB } = data.payload;

      // Make sure bar is visible for spectator
      document.getElementById("lockStatusBar").style.display = "flex";

      document.getElementById("lockNameA").innerText = nameA || "Player A";
      document.getElementById("lockNameB").innerText = nameB || "Player B";

      const elA = document.getElementById("lockStatusA");
      const elB = document.getElementById("lockStatusB");

      elA.classList.toggle("locked", lockedA);
      elB.classList.toggle("locked", lockedB);

      document.getElementById("lockStateA").innerText = lockedA ? "Locked 🔒" : "Waiting ⏳";
      document.getElementById("lockStateB").innerText = lockedB ? "Locked 🔒" : "Waiting ⏳";
    }

    if (data.type === "REMATCH_REQUEST") {
      if (isSpectator) {
        // Show spectators who requested
        document.getElementById("rematchStatus").innerText =
          "⏳ " + data.payload.fromName + " wants a rematch. Waiting for opponent...";
        return;
      }
      if (data.payload.from === mySlot) {
        // I am the requester — already updated locally in requestRematch()
        return;
      }
      // I am the receiver
      document.getElementById("rematchBtn").style.display = "none";
      document.getElementById("rematchStatus").innerText =
        "🏏 " + data.payload.fromName + " wants a rematch!";
      document.getElementById("rematchReceiverBtns").style.display = "flex";
    }

if (data.type === "REMATCH_DECLINED") {
      document.getElementById("rematchReceiverBtns").style.display = "none";
      document.getElementById("rematchBtn").style.display = "none";

      if (isSpectator) {
        document.getElementById("rematchStatus").innerText =
          "❌ " + data.payload.fromName + " declined. No rematch.";
        return;
      }
      // Personalised message: decliner vs requester
      if (data.payload.fromName === playerName) {
        document.getElementById("rematchStatus").innerText = "❌ You declined.";
      } else {
        document.getElementById("rematchStatus").innerText =
          "❌ " + data.payload.fromName + " declined.";
      }
    }

    if (data.type === "REMATCH_START") {
      const old = document.getElementById("spectatorRematchChoice");
      if (old) old.remove();

      if (isSpectator) {
        window.spectatorWatchingRematch = false;
        window.rematchHasHappened = true; // from now on block TOSS_CALLER until Watch Again

        document.getElementById("resultEmoji").innerText = "👁️";
        document.getElementById("resultTitle").innerText = "Rematch Starting!";
        document.getElementById("matchSummary").style.display = "none";
        document.getElementById("matchStats").style.display = "none";
        document.getElementById("rematchSection").style.display = "none";
        document.getElementById("exitMatchBtn").style.display = "none";

        const spectatorChoice = document.createElement("div");
        spectatorChoice.id = "spectatorRematchChoice";
        spectatorChoice.style.cssText = "display:flex;flex-direction:column;gap:10px;width:100%";
        spectatorChoice.innerHTML = `
          <p style="color:var(--text-muted);font-size:14px;margin:0;">Players are starting a rematch.</p>
          <button class="btnPrimary fullWidth" onclick="watchRematch()">👁️ Watch Again</button>
          <button class="btnSecondary fullWidth" onclick="exitMatch()">← Back to Menu</button>
        `;
        document.querySelector("#resultScreen .centerCard").appendChild(spectatorChoice);
        return;
      }

      isTossing = false;
      lastBalls = [];
      selectedFingers = [];
      window.handLocked = false;

      document.getElementById("tossMessage").innerText = "Starting rematch...";
      document.getElementById("tossButtons").style.display = "none";
      document.getElementById("tossWaiting").style.display = "none";
      document.getElementById("coin").classList.remove("flip-heads", "flip-tails");
      showScreen("tossScreen");
    }

    if (data.type === "ROOM_FULL") {
      if (data.payload && data.payload.canSpectate) {
        if (confirm("Room is full! Would you like to spectate instead?")) {
          spectateRoom();
        } else {
          showScreen("modeScreen");
        }
      } else {
        alert("Room is full!");
        showScreen("modeScreen");
      }
    }
  };
}

function resetLockBar() {
  document.getElementById("lockStatusA").classList.remove("locked");
  document.getElementById("lockStatusB").classList.remove("locked");
  document.getElementById("lockStateA").innerText = "Waiting ⏳";
  document.getElementById("lockStateB").innerText = "Waiting ⏳";
  // Hide bar — will show again when LOCK_STATUS arrives for spectators
  document.getElementById("lockStatusBar").style.display = "none";
}

function acceptRematch() {
  socket.send(JSON.stringify({ type: "REMATCH_ACCEPT", player: mySlot }));
  document.getElementById("rematchReceiverBtns").style.display = "none";
  document.getElementById("rematchStatus").innerText = "✅ Accepted! Starting...";
}
