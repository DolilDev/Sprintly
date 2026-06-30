// ====== CAM RUNNER - frontend ======
// Cala detekcja pozy i segmentacja tla dzieje sie w Pythonie (server.py).
// Ten plik tylko: laczy sie przez WebSocket, rysuje gre i podglad.

const socket = io();

const gameCanvas = document.getElementById('gameCanvas');
const gctx = gameCanvas.getContext('2d');
const previewCanvas = document.getElementById('previewCanvas');
const pctx = previewCanvas.getContext('2d');

const statusMsg = document.getElementById('statusMsg');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const poseStatusEl = document.getElementById('poseStatus');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');
const recalBtn = document.getElementById('recalBtn');

let cutoutImg = new Image();
let cutoutReady = false;

let gesture = { lane: 0, crouching: false, jump: false, running: false };

// ---------- Stan gry ----------
const game = {
  lane: 0,
  playerX: 0,
  jumpVel: 0,
  jumpY: 0,
  isJumping: false,
  isCrouching: false,
  speed: 6,
  distance: 0,
  score: 0,
  best: Number(localStorage.getItem('camRunnerBest') || 0),
  obstacles: [],
  spawnTimer: 0,
  alive: true,
  running: false
};
bestEl.textContent = game.best;

function resetGame() {
  game.lane = 0;
  game.playerX = 0;
  game.jumpVel = 0;
  game.jumpY = 0;
  game.isJumping = false;
  game.isCrouching = false;
  game.speed = 6;
  game.distance = 0;
  game.score = 0;
  game.obstacles = [];
  game.spawnTimer = 0;
  game.alive = true;
  gameOverOverlay.classList.remove('show');
}

function spawnObstacle() {
  const lanes = [-1, 0, 1];
  const lane = lanes[Math.floor(Math.random() * 3)];
  const types = ['low', 'high', 'full'];
  const type = types[Math.floor(Math.random() * types.length)];
  game.obstacles.push({ lane, z: 1400, type, passed: false });
}

// ---------- Odbieranie danych z serwera Python ----------
socket.on('connect', () => {
  statusMsg.textContent = 'Połączono z serwerem. Stań w kadrze kamery, zacznij truchtać.';
  resetGame();
});

socket.on('disconnect', () => {
  statusMsg.textContent = 'Rozłączono z serwerem Python. Sprawdź, czy server.py wciąż działa.';
});

socket.on('frame_update', (data) => {
  gesture = data.gesture || gesture;

  if (data.cutout) {
    cutoutImg.onload = () => { cutoutReady = true; };
    cutoutImg.src = 'data:image/png;base64,' + data.cutout;
  }

  if (gesture.jump && !game.isJumping && game.alive) {
    game.isJumping = true;
    game.jumpVel = 13;
  }
  game.lane = gesture.lane;
  game.isCrouching = gesture.crouching;
  game.running = gesture.running;

  poseStatusEl.textContent =
    (game.isCrouching ? 'KUCASZ ' : '') +
    (game.isJumping ? 'SKOK ' : '') +
    (game.running ? 'BIEG' : 'STÓJ');
});

recalBtn.addEventListener('click', () => {
  socket.emit('recalibrate');
  statusMsg.textContent = 'Skalibrowano pozycję bazową na nowo.';
});

// ---------- Logika gry ----------
function updateGame() {
  if (!game.alive) return;

  const targetLaneX = game.lane * 140;
  game.playerX += (targetLaneX - game.playerX) * 0.25;

  if (game.isJumping) {
    game.jumpY += game.jumpVel;
    game.jumpVel -= 1.1;
    if (game.jumpY <= 0) {
      game.jumpY = 0;
      game.isJumping = false;
    }
  }

  game.speed = 6 + Math.min(10, game.distance / 600);

  if (game.running) {
    game.distance += game.speed;
    game.score = Math.floor(game.distance / 10);
  }

  game.spawnTimer -= game.speed;
  if (game.spawnTimer <= 0) {
    spawnObstacle();
    game.spawnTimer = 480 - Math.min(260, game.distance / 12);
  }

  for (const ob of game.obstacles) {
    if (game.running) ob.z -= game.speed * 4;
  }
  game.obstacles = game.obstacles.filter(ob => ob.z > -100);

  for (const ob of game.obstacles) {
    if (ob.z < 60 && ob.z > -20 && !ob.passed) {
      if (ob.lane === game.lane) {
        let safe = false;
        if (ob.type === 'low' && game.isCrouching) safe = true;
        if (ob.type === 'high' && game.jumpY > 40) safe = true;
        if (!safe) gameOver();
      }
      ob.passed = true;
    }
  }

  scoreEl.textContent = game.score;
}

function gameOver() {
  game.alive = false;
  if (game.score > game.best) {
    game.best = game.score;
    localStorage.setItem('camRunnerBest', game.best);
  }
  bestEl.textContent = game.best;
  finalScoreEl.textContent = game.score;
  gameOverOverlay.classList.add('show');
}

// ---------- Rysowanie gry ----------
function laneScreenX(lane, depth, w) {
  const spread = (w * 0.22) * (1 - depth * 0.85);
  const cx = w / 2;
  return cx + lane * spread;
}

function drawGame() {
  const w = gameCanvas.width, h = gameCanvas.height;
  const grad = gctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1b2a4a');
  grad.addColorStop(0.45, '#3a5f8a');
  grad.addColorStop(0.46, '#444');
  grad.addColorStop(1, '#1a1a1a');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, w, h);

  const horizon = h * 0.4;
  const cx = w / 2;

  gctx.strokeStyle = 'rgba(255,255,255,0.25)';
  gctx.lineWidth = 2;
  for (const off of [-0.5, 0.5, -1.5, 1.5]) {
    gctx.beginPath();
    gctx.moveTo(cx + off * w * 0.18, h);
    gctx.lineTo(cx + off * 10, horizon);
    gctx.stroke();
  }

  const t = (game.distance * 0.5) % 60;
  for (let i = 0; i < 8; i++) {
    const depth = (i * 60 + t) / 480;
    const y = horizon + depth * (h - horizon);
    gctx.strokeStyle = `rgba(255,255,255,${0.15 * (1 - depth)})`;
    gctx.beginPath();
    gctx.moveTo(cx - w * 0.17 * (1 - depth * 0.8), y);
    gctx.lineTo(cx + w * 0.17 * (1 - depth * 0.8), y);
    gctx.stroke();
  }

  for (const ob of game.obstacles) {
    const depth = Math.max(0, Math.min(1, ob.z / 1400));
    const y = horizon + (1 - depth) * (h - horizon);
    const x = laneScreenX(ob.lane, depth, w);
    const scale = (1 - depth) * 1.0 + 0.08;
    const size = 70 * scale;

    gctx.save();
    if (ob.type === 'low') {
      gctx.fillStyle = '#ff5e5e';
      gctx.fillRect(x - size / 2, y - size * 0.4, size, size * 0.4);
    } else if (ob.type === 'high') {
      gctx.fillStyle = '#ffb347';
      gctx.fillRect(x - size / 2, y - size * 1.3, size, size * 0.5);
      gctx.fillStyle = 'rgba(255,179,71,0.4)';
      gctx.fillRect(x - size / 2, y - size * 0.8, size, size * 0.4);
    } else {
      gctx.fillStyle = '#3ddc97';
      gctx.fillRect(x - size / 2, y - size, size, size);
    }
    gctx.restore();
  }

  const px = cx + game.playerX;
  const groundY = h * 0.85;
  const py = groundY - game.jumpY * 2.2;
  const bodyH = game.isCrouching ? 60 : 100;

  gctx.save();
  gctx.translate(px, py);
  gctx.fillStyle = 'rgba(0,0,0,0.4)';
  gctx.beginPath();
  gctx.ellipse(0, groundY - py + 8, 30, 8, 0, 0, Math.PI * 2);
  gctx.fill();

  gctx.fillStyle = '#3ddc97';
  gctx.beginPath();
  gctx.roundRect(-22, -bodyH, 44, bodyH, 14);
  gctx.fill();
  gctx.beginPath();
  gctx.arc(0, -bodyH - 18, 18, 0, Math.PI * 2);
  gctx.fill();
  gctx.restore();
}

// ---------- Podgląd: osoba bez tła na miniaturze gry ----------
function drawPreview() {
  const w = previewCanvas.width, h = previewCanvas.height;
  pctx.drawImage(gameCanvas, 0, 0, gameCanvas.width, gameCanvas.height, 0, 0, w, h);
  pctx.fillStyle = 'rgba(0,0,0,0.15)';
  pctx.fillRect(0, 0, w, h);

  if (cutoutReady && cutoutImg.width) {
    const scale = (h / cutoutImg.height) * 1.05;
    const dw = cutoutImg.width * scale, dh = cutoutImg.height * scale;
    pctx.drawImage(cutoutImg, (w - dw) / 2, h - dh);
  }
}

// ---------- Pętla renderowania ----------
function loop() {
  requestAnimationFrame(loop);
  updateGame();
  drawGame();
  drawPreview();
}

restartBtn.addEventListener('click', () => resetGame());

resetGame();
loop();
