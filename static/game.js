// ====== SPRINTLY - frontend ======

const socket = io();

// --- Elementy DOM ---
const startScreen       = document.getElementById('startScreen');
const gameScreen        = document.getElementById('gameScreen');
const camSelect         = document.getElementById('camSelect');
const refreshCamsBtn    = document.getElementById('refreshCams');
const startBtn          = document.getElementById('startBtn');
const gameCanvas        = document.getElementById('gameCanvas');
const gctx              = gameCanvas.getContext('2d');
const previewCanvas     = document.getElementById('previewCanvas');
const pctx              = previewCanvas.getContext('2d');
const scoreEl           = document.getElementById('score');
const bestEl            = document.getElementById('best');
const poseStatusEl      = document.getElementById('poseStatus');
const gameOverOverlay   = document.getElementById('gameOverOverlay');
const finalScoreEl      = document.getElementById('finalScore');
const restartBtn        = document.getElementById('restartBtn');
const menuBtn           = document.getElementById('menuBtn');
const recalBtn          = document.getElementById('recalBtn');
const fsBtn             = document.getElementById('fsBtn');
const exitBtn           = document.getElementById('exitBtn');
const statusMsg         = document.getElementById('statusMsg');

let cutoutImg = new Image();
let cutoutReady = false;
let gesture = { lane: 0, crouching: false, jump: false, running: false };

// --- Wczytaj listę kamer ---
async function loadCameras() {
  camSelect.innerHTML = '<option value="">Ładuję...</option>';
  try {
    const res = await fetch('/api/cameras');
    const cams = await res.json();
    if (cams.length === 0) {
      camSelect.innerHTML = '<option value="0">Brak wykrytych kamer (spróbuj 0)</option>';
    } else {
      camSelect.innerHTML = cams.map(c =>
        `<option value="${c.index}">${c.name}</option>`
      ).join('');
    }
  } catch {
    camSelect.innerHTML = '<option value="0">Kamera 0 (domyślna)</option>';
  }
}

refreshCamsBtn.addEventListener('click', loadCameras);
loadCameras();

// --- Start gry ---
startBtn.addEventListener('click', () => {
  const camIdx = parseInt(camSelect.value) || 0;
  socket.emit('start_camera', { index: camIdx });
  startScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  resetGame();
});

// --- Fullscreen ---
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    gameScreen.requestFullscreen().catch(err => console.warn('Fullscreen error:', err));
  } else {
    document.exitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '⛶ Wyjdź z fullscreen' : '⛶ Fullscreen';
});

// --- Wyjście do menu ---
exitBtn.addEventListener('click', goToMenu);
menuBtn.addEventListener('click', goToMenu);

function goToMenu() {
  gameScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  if (document.fullscreenElement) document.exitFullscreen();
}

// --- Socket ---
socket.on('connect', () => {
  statusMsg.textContent = 'Połączono z serwerem. Stań przed kamerą i zacznij truchtać.';
});
socket.on('disconnect', () => {
  statusMsg.textContent = 'Rozłączono z serwerem Python.';
});
socket.on('error', (data) => {
  statusMsg.textContent = 'Błąd: ' + (data.msg || '?');
});

socket.on('frame_update', (data) => {
  gesture = data.gesture || gesture;

  if (data.cutout) {
    cutoutImg = new Image();
    cutoutImg.onload = () => { cutoutReady = true; };
    cutoutImg.src = 'data:image/png;base64,' + data.cutout;
  }

  if (gesture.jump && !game.isJumping && game.alive) {
    game.isJumping = true;
    game.jumpVel = 18;
  }
  game.lane      = gesture.lane;
  game.isCrouching = gesture.crouching;
  game.running   = gesture.running;

  poseStatusEl.textContent =
    (game.isCrouching ? 'KUCASZ ' : '') +
    (game.isJumping   ? 'SKOK '   : '') +
    (game.running     ? 'BIEG'    : 'STÓJ');
});

recalBtn.addEventListener('click', () => { socket.emit('recalibrate'); });

// ===== LOGIKA GRY =====
const game = {
  lane: 0, playerX: 0,
  jumpVel: 0, jumpY: 0, isJumping: false,
  isCrouching: false, running: false,
  speed: 6, distance: 0, score: 0,
  best: Number(localStorage.getItem('sprintlyBest') || 0),
  obstacles: [], spawnTimer: 0, alive: true,
};
bestEl.textContent = game.best;

function resetGame() {
  Object.assign(game, {
    lane: 0, playerX: 0, jumpVel: 0, jumpY: 0,
    isJumping: false, isCrouching: false,
    speed: 6, distance: 0, score: 0,
    obstacles: [], spawnTimer: 0, alive: true,
  });
  gameOverOverlay.classList.remove('show');
  cutoutReady = false;
}

function spawnObstacle() {
  const lanes = [-1, 0, 1];
  const types = ['low', 'high', 'full'];
  game.obstacles.push({
    lane: lanes[Math.floor(Math.random() * 3)],
    z: 1600,
    type: types[Math.floor(Math.random() * 3)],
    passed: false,
  });
}

function updateGame() {
  if (!game.alive) return;

  game.playerX += (game.lane * 160 - game.playerX) * 0.22;

  if (game.isJumping) {
    game.jumpY += game.jumpVel;
    game.jumpVel -= 1.3;
    if (game.jumpY <= 0) { game.jumpY = 0; game.isJumping = false; }
  }

  game.speed = 6 + Math.min(12, game.distance / 500);

  if (game.running) {
    game.distance += game.speed;
    game.score = Math.floor(game.distance / 10);
  }

  game.spawnTimer -= game.speed;
  if (game.spawnTimer <= 0) {
    spawnObstacle();
    game.spawnTimer = 500 - Math.min(280, game.distance / 10);
  }

  for (const ob of game.obstacles) {
    if (game.running) ob.z -= game.speed * 4;
  }
  game.obstacles = game.obstacles.filter(ob => ob.z > -120);

  for (const ob of game.obstacles) {
    if (ob.z < 70 && ob.z > -30 && !ob.passed) {
      if (ob.lane === game.lane) {
        const safe =
          (ob.type === 'low'  && game.isCrouching) ||
          (ob.type === 'high' && game.jumpY > 50);
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
    localStorage.setItem('sprintlyBest', game.best);
    bestEl.textContent = game.best;
  }
  finalScoreEl.textContent = game.score;
  gameOverOverlay.classList.add('show');
}

restartBtn.addEventListener('click', resetGame);

// ===== RYSOWANIE GRY =====
function laneX(lane, depth, w) {
  return w / 2 + lane * (w * 0.14) * (1 - depth * 0.82);
}

function drawGame() {
  const w = gameCanvas.width, h = gameCanvas.height;
  const horizon = h * 0.38;
  const cx = w / 2;

  // Tło
  const sky = gctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0d1829');
  sky.addColorStop(1, '#1e4d7a');
  gctx.fillStyle = sky;
  gctx.fillRect(0, 0, w, horizon);

  const road = gctx.createLinearGradient(0, horizon, 0, h);
  road.addColorStop(0, '#2a2a2a');
  road.addColorStop(1, '#111');
  gctx.fillStyle = road;
  gctx.fillRect(0, horizon, w, h - horizon);

  // Linie toru
  gctx.lineWidth = 3;
  gctx.strokeStyle = 'rgba(255,255,255,.2)';
  for (const off of [-1.5, -0.5, 0.5, 1.5]) {
    gctx.beginPath();
    gctx.moveTo(cx + off * w * 0.015, horizon);
    gctx.lineTo(cx + off * w * 0.22, h);
    gctx.stroke();
  }

  // Animowane linie ruchu
  const t = (game.distance * 0.4) % 80;
  for (let i = 0; i < 10; i++) {
    const depth = (i * 80 + t) / 800;
    const y = horizon + depth * (h - horizon);
    gctx.strokeStyle = `rgba(255,255,255,${0.12 * (1 - depth)})`;
    gctx.lineWidth = 1;
    gctx.beginPath();
    gctx.moveTo(cx - w * 0.22 * depth, y);
    gctx.lineTo(cx + w * 0.22 * depth, y);
    gctx.stroke();
  }

  // Przeszkody
  for (const ob of game.obstacles) {
    const depth = Math.max(0, Math.min(1, ob.z / 1600));
    const y = horizon + (1 - depth) * (h - horizon);
    const x = laneX(ob.lane, depth, w);
    const scale = (1 - depth) + 0.06;
    const sw = 100 * scale, sh = 100 * scale;

    gctx.save();
    if (ob.type === 'low') {
      gctx.fillStyle = '#ff5e5e';
      gctx.beginPath();
      gctx.roundRect(x - sw / 2, y - sh * 0.4, sw, sh * 0.4, 6);
      gctx.fill();
    } else if (ob.type === 'high') {
      gctx.fillStyle = '#ffb347';
      gctx.fillRect(x - sw / 2, y - sh * 1.3, sw, sh * 0.45);
      gctx.fillStyle = 'rgba(255,179,71,.35)';
      gctx.fillRect(x - sw / 2, y - sh * 0.85, sw, sh * 0.45);
    } else {
      gctx.fillStyle = '#3ddc97';
      gctx.beginPath();
      gctx.roundRect(x - sw / 2, y - sh, sw, sh, 8);
      gctx.fill();
    }
    gctx.restore();
  }

  // Gracz (sylwetka jeśli jest cutout, inaczej prostokąt)
  const px = cx + game.playerX;
  const groundY = h * 0.86;
  const py = groundY - game.jumpY * 2.8;
  const bodyH = game.isCrouching ? 70 : 120;

  gctx.save();
  gctx.translate(px, py);

  // Cień
  gctx.fillStyle = 'rgba(0,0,0,.4)';
  gctx.beginPath();
  gctx.ellipse(0, groundY - py + 10, 38, 10, 0, 0, Math.PI * 2);
  gctx.fill();

  // Sylwetka gracza
  gctx.fillStyle = '#3ddc97';
  gctx.beginPath();
  gctx.roundRect(-26, -bodyH, 52, bodyH, 16);
  gctx.fill();
  gctx.beginPath();
  gctx.arc(0, -bodyH - 22, 22, 0, Math.PI * 2);
  gctx.fill();
  gctx.restore();
}

// ===== PODGLĄD: osoba bez tła na tle gry =====
function drawPreview() {
  const w = previewCanvas.width, h = previewCanvas.height;
  pctx.drawImage(gameCanvas, 0, 0, gameCanvas.width, gameCanvas.height, 0, 0, w, h);
  pctx.fillStyle = 'rgba(0,0,0,.18)';
  pctx.fillRect(0, 0, w, h);

  if (cutoutReady && cutoutImg.width) {
    const scale = (h / cutoutImg.height) * 1.05;
    const dw = cutoutImg.width * scale, dh = cutoutImg.height * scale;
    pctx.drawImage(cutoutImg, (w - dw) / 2, h - dh);
  }
}

// ===== PĘTLA =====
function loop() {
  requestAnimationFrame(loop);
  updateGame();
  drawGame();
  drawPreview();
}

resetGame();
loop();
