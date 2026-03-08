let lastBalls = [];
let selectedFingers = [];
let socket = null;
let playerName = "";
let roomCode = "";
let isHost = false;
let gameMode = "limited";

const sounds = {
wicket: new Audio("sounds/wicket.mp3"),
six: new Audio("sounds/six.m4a")
};

function playSound(name){
if(sounds[name]){
sounds[name].currentTime=0;
sounds[name].play();
}
}

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("active");
    });

    document.getElementById(id).classList.add("active");
}

function goToMode() {
    const nameInput = document.getElementById("playerNameInput").value;

    if (!nameInput) {
        alert("Enter your name first!");
        return;
    }

    playerName = nameInput;
    showScreen("modeScreen");
}

function goToRoomSetup() {
    showScreen("roomSetupScreen");
}

function createRoom() {

    const overs = document.getElementById("oversInput").value;
    const wickets = document.getElementById("wicketsInput").value;
    const code = document.getElementById("createRoomCodeInput").value;

    if (gameMode === "limited") {

  if (!overs || !wickets || !code) {
    alert("Fill all fields!");
    return;
  }

} else {

  if (!wickets || !code) {
    alert("Fill all fields!");
    return;
  }

}

    roomCode = code;
    isHost = true;

    if (gameMode === "limited") {
  connectToServer(code, overs, wickets);
} else {
  connectToServer(code, null, wickets);
}

    showScreen("lobbyScreen");
}

function joinRoom() {

    const code = document.getElementById("joinRoomCodeInput").value;

    if (!code) {
        alert("Enter room code!");
        return;
    }

    roomCode = code;
    isHost = false;

    connectToServer(code, null, null);

    showScreen("lobbyScreen");
}

function sendToss(choice) {

  socket.send(JSON.stringify({
    type: "TOSS_CHOICE",
    player: isHost ? "A" : "B",
    choice: choice
  }));

}

function sendDecision(choice) {

  socket.send(JSON.stringify({
    type: "BAT_BOWL_CHOICE",
    player: isHost ? "A" : "B",
    choice: choice
  }));

}

function lockHand() {

  if (selectedFingers.length === 0) {
    alert("Select at least one finger!");
    return;
  }

  if(window.handLocked) return;
  window.handLocked = true;

  socket.send(JSON.stringify({
    type: "HAND_SELECT",
    player: isHost ? "A" : "B",
    fingers: selectedFingers
  }));

  socket.send(JSON.stringify({
    type: "HAND_LOCK",
    player: isHost ? "A" : "B"
  }));

  selectedFingers = [];

document.querySelectorAll(".fingerBtn").forEach(btn=>{
btn.classList.remove("selected");
});

document.getElementById("selectedDisplay").innerText =
"Locked! Waiting for opponent...";
}

function toggleFinger(finger, btn) {

  if (selectedFingers.includes(finger)) {

    selectedFingers = selectedFingers.filter(f => f !== finger);
    btn.classList.remove("selected");

  } else {

    selectedFingers.push(finger);
    btn.classList.add("selected");

  }

  document.getElementById("selectedDisplay").innerText =
    selectedFingers.length > 0
      ? selectedFingers.join(", ")
      : "None";
}

function continueGame(){

if(window.afterCopy){
window.afterCopy = false;
showScreen("lobbyScreen");
return;
}

showScreen("gameScreen");

}

function setMode(mode) {

  gameMode = mode;

  const oversInput = document.getElementById("oversInput");

  if (mode === "unlimited") {
    oversInput.value = "";
    oversInput.disabled = true;
    oversInput.style.display = "none";
  } else {
    oversInput.disabled = false;
    oversInput.style.display = "block";
  }

}

function startMatch() {

const teamA=document.getElementById("teamA").innerText;
const teamB=document.getElementById("teamB").innerText;

if(!isHost){
alert("Only host can start match");
return;
}

if(teamA==="Empty" || teamB==="Empty" || teamB==="Waiting..."){
alert("Waiting for opponent to join");
return;
}

socket.send(JSON.stringify({
type:"START_MATCH"
}));

}

function copyRoomCode(){

navigator.clipboard.writeText(roomCode);

document.getElementById("resultTitle").innerText = "Copied";
document.getElementById("resultText").innerText = "Room code copied to clipboard";

showScreen("resultScreen");

window.afterCopy = true;

}

function toggleTheme(){

document.body.classList.toggle("light");

const btn=document.getElementById("themeToggle");

if(document.body.classList.contains("light")){
btn.innerText="☀️";
}else{
btn.innerText="🌙";
}

}

function connectToServer(code, overs, wickets) {

    socket = new WebSocket(
        "wss://handcricket-server.mahin-aistudio.workers.dev/" + code
    );

    socket.onopen = () => {

        socket.send(JSON.stringify({
    type: "JOIN_ROOM",
    payload: {
        playerName: playerName,
        overs: overs,
        wickets: wickets,
        mode: gameMode
    }
}));
    };

    socket.onmessage = (event) => {

        console.log("Received:", event.data);

        const data = JSON.parse(event.data);

if (data.type === "ROOM_JOINED") {

  roomCode = data.payload.roomCode;

  document.getElementById("lobbyRoomCode").innerText = roomCode;

}

        if (data.type === "LOBBY_UPDATE") {

    if (data.payload.roomCode) {
        roomCode = data.payload.roomCode;
    }

    document.getElementById("lobbyRoomCode").innerText = roomCode;

    document.getElementById("teamA").innerText =
        data.payload.teamA || "Empty";

    document.getElementById("teamB").innerText =
        data.payload.teamB || "Empty";

}

if (data.type === "MATCH_DECISION") {

alert(
"Batting: " + data.payload.batting +
"\nBowling: " + data.payload.bowling
);

  showScreen("gameScreen");
}

if (data.type === "TOSS_CALLER") {

  showScreen("tossScreen");

  if ((isHost && data.payload.caller === "A") ||
      (!isHost && data.payload.caller === "B")) {

    document.getElementById("tossButtons").style.display = "block";
  } else {
    document.getElementById("tossButtons").style.display = "none";
  }
}

if (data.type === "BALL_RESULT") {

window.handLocked = false;

const battingName = data.payload.battingName;
const bowlingName = data.payload.bowlingName;

document.getElementById("battingName").innerText = battingName;
document.getElementById("bowlingName").innerText = bowlingName;

if (battingName === document.getElementById("teamA").innerText) {

  batterRuns = data.payload.scoreA;
  batterWickets = data.payload.wicketsA;

} else {

  batterRuns = data.payload.scoreB;
  batterWickets = data.payload.wicketsB;

}

document.getElementById("batterStats").innerText =
  "(" + batterRuns + "-" + batterWickets + ")";

let battingScore;
let battingWickets;

if (battingName === data.payload.battingName) {

  if (battingName === document.getElementById("teamA").innerText) {
    battingScore = data.payload.scoreA;
    battingWickets = data.payload.wicketsA;
  } else {
    battingScore = data.payload.scoreB;
    battingWickets = data.payload.wicketsB;
  }

}

document.getElementById("mainScore").innerText =
  battingScore + " / " + battingWickets;

let balls = data.payload.balls;

let over = Math.floor(balls / 6);
let ball = balls % 6;

document.getElementById("overDisplay").innerText =
  over + "." + ball;

document.getElementById("ballsLeftDisplay").innerText =
  data.payload.ballsLeft;

if (data.payload.target) {

  let target = data.payload.target;
  let ballsLeft = data.payload.ballsLeft;

  document.getElementById("targetDisplay").innerText = target;

  let runsLeft = target - battingScore;

  if(runsLeft < 0){
  runsLeft = 0;
  }

  document.getElementById("runsLeftDisplay").innerText = runsLeft;

  if (ballsLeft > 0) {

    let runsNeeded = Math.max(target - battingScore, 0);

    let rrr = runsNeeded / ballsLeft;

    document.getElementById("rrrDisplay").innerText =
      rrr.toFixed(2);

  }
}

let ballRun;

if (data.payload.out) {
  ballRun = "W";
} else {
  ballRun = data.payload.out ? "W" : data.payload.lastRuns;
}

let ballNumber = balls % 6;

if(ballNumber === 1){
  lastBalls = [];
}

lastBalls.push(ballRun);

const boxes = document.querySelectorAll(".ballBox");

boxes.forEach((box, i) => {

  box.innerText = lastBalls[i] || "-";

  if(i === lastBalls.length-1){
    box.classList.add("ballFlash");

    setTimeout(()=>{
      box.classList.remove("ballFlash");
    },500);
  }

});

  document.getElementById("inningsDisplay").innerText = data.payload.innings;

  if (data.payload.target) {
    document.getElementById("targetDisplay").innerText = data.payload.target;
  }

const msg = document.getElementById("ballMessage");

if(data.payload.out){
playSound("wicket");

  msg.innerText = "WICKET!";
  msg.style.color = "#ff4444";

}else{

  let runs = data.payload.lastRuns;

  if(runs === 6){
playSound("six");
    msg.innerText = "SIX!";
    msg.style.color = "#ff9800";
  }
  else if(runs === 4){
    msg.innerText = "FOUR!";
    msg.style.color = "#4caf50";
  }
  else{
    msg.innerText = runs + " RUN";
    msg.style.color = "white";
  }

}
  if (data.payload.matchOver) {

  document.getElementById("ballMessage").innerText =
    "Match Over! Winner: " + data.payload.winner;

  const rematch = confirm("Match Over!\nWinner: " + data.payload.winner + "\n\nRematch?");

  if (rematch) {
    location.reload();
  } else {
    showScreen("nameScreen");
  }

}

}

if (data.type === "TOSS_RESULT") {

alert(
  "Coin: " + data.payload.coin +
  "\nWinner: " + data.payload.winner
);

  showScreen("decisionScreen");

  const amIWinner =
    (isHost && data.payload.winner === document.getElementById("teamA").innerText) ||
    (!isHost && data.payload.winner === document.getElementById("teamB").innerText);

  if (amIWinner) {
    document.getElementById("decisionButtons").style.display = "block";
    document.getElementById("decisionWaiting").style.display = "none";
  } else {
    document.getElementById("decisionButtons").style.display = "none";
    document.getElementById("decisionWaiting").style.display = "block";
  }
}

        if (data.type === "ROOM_FULL") {
            alert("Room is full!");
            showScreen("modeScreen");
        }
    };
}
