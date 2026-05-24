const CONFIG = {
  totalRounds: 10,
  cardCount: 8,
  minFactor: 1,
  maxFactor: 9,
  statsKey: "factor-squad-stats-v1",
  musicKey: "factor-squad-music-enabled-v1",
};

const els = {
  playArea: document.querySelector("#playArea"),
  resultScreen: document.querySelector("#resultScreen"),
  roundText: document.querySelector("#roundText"),
  starText: document.querySelector("#starText"),
  scoreText: document.querySelector("#scoreText"),
  progressFill: document.querySelector("#progressFill"),
  timerText: document.querySelector("#timerText"),
  targetNumber: document.querySelector("#targetNumber"),
  feedbackText: document.querySelector("#feedbackText"),
  cardGrid: document.querySelector("#cardGrid"),
  musicButton: document.querySelector("#musicButton"),
  bgmAudio: document.querySelector("#bgmAudio"),
  submitButton: document.querySelector("#submitButton"),
  nextButton: document.querySelector("#nextButton"),
  restartButton: document.querySelector("#restartButton"),
  againButton: document.querySelector("#againButton"),
  resultScore: document.querySelector("#resultScore"),
  resultTime: document.querySelector("#resultTime"),
  resultDetail: document.querySelector("#resultDetail"),
  wrongList: document.querySelector("#wrongList"),
  fireworksLayer: document.querySelector("#fireworksLayer"),
};

const allEquations = buildEquations();
const targetPool = buildTargetPool();
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SOUND_VOLUME_BOOST = 1.45;
const BGM_VOLUME = 0.5;
const SOUND_ASSETS = {
  card: { src: "./点击答案音效.mp3", volume: 1 },
  notice: { src: "./没有选择就提交.mp3", volume: 1 },
  correct: { src: "./答对音效.mp3", volume: 1 },
  wrong: { src: "./答错音效.mp3", volume: 1 },
  finale: { src: "./最后结算庆祝.mp3", volume: 1 },
};

let state = createInitialState();
let timerInterval = null;
let audioContext = null;
let autoAdvanceTimer = null;
let musicEnabled = loadMusicPreference();
const soundPlayers = new Map();

function buildEquations() {
  const equations = [];

  for (let a = CONFIG.minFactor; a <= CONFIG.maxFactor; a += 1) {
    for (let b = CONFIG.minFactor; b <= CONFIG.maxFactor; b += 1) {
      equations.push({
        id: `${a}x${b}`,
        a,
        b,
        product: a * b,
        label: `${a} × ${b}`,
      });
    }
  }

  return equations;
}

function buildTargetPool() {
  const products = new Set();

  for (let a = 2; a <= CONFIG.maxFactor; a += 1) {
    for (let b = 2; b <= CONFIG.maxFactor; b += 1) {
      products.add(a * b);
    }
  }

  return [...products].sort((a, b) => a - b);
}

function createInitialState() {
  const stats = loadStats();

  return {
    answeredCount: 0,
    score: 0,
    stars: 0,
    selectedIds: new Set(),
    retryQueue: [...(stats.lastWrongTargets || [])],
    missedTargets: [],
    submitted: false,
    lastAnswerCorrect: null,
    currentQuestion: null,
    previousTarget: null,
    startTime: null,
    elapsedMs: 0,
    stats,
  };
}

function loadStats() {
  try {
    const raw = window.localStorage.getItem(CONFIG.statsKey);
    if (!raw) {
      return emptyStats();
    }

    return {
      ...emptyStats(),
      ...JSON.parse(raw),
    };
  } catch {
    return emptyStats();
  }
}

function emptyStats() {
  return {
    sessions: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    bestScore: 0,
    lastWrongTargets: [],
  };
}

function saveStats(nextStats) {
  try {
    window.localStorage.setItem(CONFIG.statsKey, JSON.stringify(nextStats));
  } catch {
    // The game should still finish if storage is unavailable.
  }
}

function loadMusicPreference() {
  try {
    const stored = window.localStorage.getItem(CONFIG.musicKey);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function saveMusicPreference() {
  try {
    window.localStorage.setItem(CONFIG.musicKey, String(musicEnabled));
  } catch {
    // Music should still work even if preference storage is unavailable.
  }
}

function shuffle(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function uniqueNumbers(numbers) {
  return [...new Set(numbers)].filter(Number.isFinite);
}

function chooseTarget() {
  if (state.retryQueue.length > 0) {
    return state.retryQueue.shift();
  }

  const availableTargets = targetPool.filter((target) => target !== state.previousTarget);
  const pool = availableTargets.length > 0 ? availableTargets : targetPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function createQuestion() {
  const target = chooseTarget();
  return createQuestionForTarget(target);
}

function createQuestionForTarget(target) {
  const correctCards = allEquations.filter((equation) => equation.product === target);
  const correctIds = new Set(correctCards.map((equation) => equation.id));
  const distractorCount = Math.max(CONFIG.cardCount - correctCards.length, 0);
  const distractors = pickDistractors(target, correctIds, distractorCount);
  const cards = shuffle([...correctCards, ...distractors]);

  state.previousTarget = target;

  return {
    target,
    cards,
    correctIds,
  };
}

function pickDistractors(target, correctIds, count) {
  const candidates = allEquations
    .filter((equation) => equation.product !== target && !correctIds.has(equation.id))
    .map((equation) => ({
      ...equation,
      distance: Math.abs(equation.product - target),
    }))
    .sort((a, b) => a.distance - b.distance || a.product - b.product);

  const near = candidates.filter((equation) => equation.distance <= 12);
  const far = candidates.filter((equation) => equation.distance > 12);

  return shuffle([...near.slice(0, 24), ...shuffle(far).slice(0, 16)]).slice(0, count);
}

function startSession() {
  clearAutoAdvanceTimer();
  stopTimer();
  state = createInitialState();
  els.resultScreen.classList.add("hidden");
  els.resultScreen.classList.remove("is-celebrating");
  els.playArea.classList.remove("hidden");
  startTimer();
  nextQuestion();
}

function nextQuestion() {
  clearAutoAdvanceTimer();
  state.selectedIds = new Set();
  state.submitted = false;
  state.lastAnswerCorrect = null;
  state.currentQuestion = createQuestion();
  render();
}

function retryCurrentQuestion() {
  clearAutoAdvanceTimer();
  const target = state.currentQuestion.target;

  state.selectedIds = new Set();
  state.submitted = false;
  state.lastAnswerCorrect = null;
  state.currentQuestion = createQuestionForTarget(target);
  render();
}

function submitAnswer() {
  if (state.submitted) {
    return;
  }

  ensureBackgroundMusic();

  if (state.selectedIds.size === 0) {
    playNoticeSound();
    els.feedbackText.textContent = "先选出等于目标数字的卡片。";
    return;
  }

  const correctIds = state.currentQuestion.correctIds;
  const selectedIds = state.selectedIds;
  const hasAllCorrect = [...correctIds].every((id) => selectedIds.has(id));
  const hasOnlyCorrect = [...selectedIds].every((id) => correctIds.has(id));
  const isCorrect = hasAllCorrect && hasOnlyCorrect;

  state.submitted = true;
  state.lastAnswerCorrect = isCorrect;

  if (isCorrect) {
    state.answeredCount += 1;
    state.score += 1;
    state.stars += 1;
    playCorrectSound();
  } else {
    state.missedTargets.push(state.currentQuestion.target);
    playWrongSound();
  }

  render(isCorrect);

  if (isCorrect) {
    launchSmallFirework();
    scheduleAutoAdvance();
  }
}

function moveForward() {
  clearAutoAdvanceTimer();

  if (!state.submitted) {
    return;
  }

  if (state.lastAnswerCorrect === false) {
    retryCurrentQuestion();
    return;
  }

  if (state.answeredCount >= CONFIG.totalRounds) {
    finishSession();
    return;
  }

  nextQuestion();
}

function finishSession() {
  stopTimer();
  const visibleWrongTargets = uniqueNumbers(state.missedTargets);

  const nextStats = {
    sessions: state.stats.sessions + 1,
    totalQuestions: state.stats.totalQuestions + CONFIG.totalRounds,
    totalCorrect: state.stats.totalCorrect + state.score,
    bestScore: Math.max(state.stats.bestScore, state.score),
    lastWrongTargets: visibleWrongTargets,
  };

  saveStats(nextStats);
  state.stats = nextStats;

  els.playArea.classList.add("hidden");
  els.resultScreen.classList.remove("hidden");
  els.resultScreen.classList.add("is-celebrating");
  els.resultScore.textContent = `${CONFIG.totalRounds} 题全部答对`;
  els.resultTime.textContent = `总用时 ${formatElapsed(state.elapsedMs)}`;

  if (visibleWrongTargets.length > 0) {
    els.resultDetail.textContent = "中途重做过这些数字，已经全部订正。下次练习会优先复习。";
  } else {
    els.resultDetail.textContent = "本轮一次通过，可以继续保持速度和准确率。";
  }

  els.wrongList.replaceChildren();
  visibleWrongTargets.forEach((target) => {
    const chip = document.createElement("span");
    chip.className = "wrong-chip";
    chip.textContent = String(target);
    els.wrongList.append(chip);
  });

  playFinaleSound();
  launchFinaleFireworks();
}

function render(lastAnswerCorrect = null) {
  const isCorrectReview = state.submitted && state.lastAnswerCorrect === true;
  const currentRound = Math.min(state.answeredCount + (isCorrectReview ? 0 : 1), CONFIG.totalRounds);
  const progress = (state.answeredCount / CONFIG.totalRounds) * 100;
  const shouldHideNextButton = !state.submitted || state.lastAnswerCorrect === true;

  els.roundText.textContent = `第 ${currentRound} 题 / ${CONFIG.totalRounds}`;
  els.starText.textContent = String(state.stars);
  els.scoreText.textContent = String(state.score);
  els.progressFill.style.width = `${progress}%`;
  els.targetNumber.textContent = String(state.currentQuestion.target);

  renderFeedback(lastAnswerCorrect ?? state.lastAnswerCorrect);
  renderCards();

  els.submitButton.classList.toggle("hidden", state.submitted);
  els.nextButton.classList.toggle("hidden", shouldHideNextButton);
  if (state.lastAnswerCorrect === false) {
    els.nextButton.textContent = "再做一次";
  } else {
    els.nextButton.textContent = state.answeredCount >= CONFIG.totalRounds ? "看结果" : "下一题";
  }
}

function renderFeedback(lastAnswerCorrect) {
  if (!state.submitted) {
    els.feedbackText.textContent = `找出所有等于 ${state.currentQuestion.target} 的卡片。`;
    return;
  }

  if (lastAnswerCorrect) {
    els.feedbackText.textContent =
      state.answeredCount >= CONFIG.totalRounds ? "第 10 题答对了，马上看结果。" : "答对了，马上进入下一题。";
    return;
  }

  els.feedbackText.textContent = `差一点。正确答案是：${getCorrectLabels().join("、")}。看清绿色卡片，再做一遍。`;
}

function getCorrectLabels() {
  return state.currentQuestion.cards
    .filter((card) => state.currentQuestion.correctIds.has(card.id))
    .map((card) => card.label);
}

function renderCards() {
  els.cardGrid.replaceChildren();

  state.currentQuestion.cards.forEach((card) => {
    const button = document.createElement("button");
    const isSelected = state.selectedIds.has(card.id);
    const isCorrect = state.currentQuestion.correctIds.has(card.id);
    const isWrongSelection = state.submitted && isSelected && !isCorrect;

    button.type = "button";
    button.className = "factor-card";
    button.textContent = card.label;
    button.setAttribute("aria-pressed", String(isSelected));

    if (isSelected) {
      button.classList.add("is-selected");
    }

    if (state.submitted && isCorrect) {
      button.classList.add("is-correct");
    }

    if (isWrongSelection) {
      button.classList.add("is-wrong");
    }

    button.disabled = state.submitted;
    button.addEventListener("click", () => toggleCard(card.id));
    els.cardGrid.append(button);
  });
}

function toggleCard(cardId) {
  if (state.submitted) {
    return;
  }

  ensureBackgroundMusic();

  if (state.selectedIds.has(cardId)) {
    state.selectedIds.delete(cardId);
    playCardSound(false);
  } else {
    state.selectedIds.add(cardId);
    playCardSound(true);
  }

  render();
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (audioContext === null) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playTone({ frequency, duration = 0.12, delay = 0, type = "sine", volume = 0.08 }) {
  const context = getAudioContext();

  if (context === null) {
    return;
  }

  const startAt = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  const boostedVolume = Math.min(volume * SOUND_VOLUME_BOOST, 0.34);

  gain.gain.exponentialRampToValueAtTime(boostedVolume, startAt + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function getSoundPlayer(name) {
  if (soundPlayers.has(name)) {
    return soundPlayers.get(name);
  }

  const asset = SOUND_ASSETS[name];

  if (!asset) {
    return null;
  }

  const audio = new Audio(asset.src);
  audio.preload = "auto";
  audio.volume = asset.volume;
  soundPlayers.set(name, audio);
  return audio;
}

function playAudioAsset(name, fallback) {
  const audio = getSoundPlayer(name);

  if (audio === null) {
    fallback();
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  audio.play().catch(() => {
    fallback();
  });
}

function playCardTone(isSelected) {
  playTone({
    frequency: isSelected ? 660 : 440,
    duration: 0.08,
    type: "triangle",
    volume: 0.12,
  });
}

function playCardSound(isSelected) {
  playAudioAsset("card", () => playCardTone(isSelected));
}

function ensureBackgroundMusic() {
  if (!musicEnabled || els.bgmAudio === null || !els.bgmAudio.paused) {
    return;
  }

  els.bgmAudio.play().catch(() => {});
}

function stopBackgroundMusic() {
  if (els.bgmAudio !== null) {
    els.bgmAudio.pause();
  }
}

function configureBackgroundMusic() {
  if (els.bgmAudio === null) {
    return;
  }

  els.bgmAudio.volume = BGM_VOLUME;
  els.bgmAudio.loop = true;
}

function toggleBackgroundMusic() {
  musicEnabled = !musicEnabled;
  saveMusicPreference();
  renderMusicButton();

  if (musicEnabled) {
    ensureBackgroundMusic();
  } else {
    stopBackgroundMusic();
  }
}

function renderMusicButton() {
  els.musicButton.textContent = musicEnabled ? "音乐：开" : "音乐：关";
  els.musicButton.setAttribute("aria-pressed", String(musicEnabled));
}

function clearAutoAdvanceTimer() {
  if (autoAdvanceTimer !== null) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

function scheduleAutoAdvance() {
  const delay = state.answeredCount >= CONFIG.totalRounds ? 1100 : 900;

  clearAutoAdvanceTimer();
  autoAdvanceTimer = window.setTimeout(() => {
    autoAdvanceTimer = null;
    moveForward();
  }, delay);
}

function playNoticeSound() {
  playAudioAsset("notice", playNoticeTone);
}

function playNoticeTone() {
  playTone({ frequency: 360, duration: 0.09, type: "triangle", volume: 0.1 });
  playTone({ frequency: 480, duration: 0.09, delay: 0.075, type: "triangle", volume: 0.09 });
}

function playCorrectSound() {
  playAudioAsset("correct", playCorrectTone);
}

function playCorrectTone() {
  [523, 659, 784].forEach((frequency, index) => {
    playTone({
      frequency,
      duration: 0.15,
      delay: index * 0.07,
      type: "triangle",
      volume: 0.16,
    });
  });
}

function playWrongSound() {
  playAudioAsset("wrong", playWrongTone);
}

function playWrongTone() {
  playTone({ frequency: 260, duration: 0.13, type: "sine", volume: 0.09 });
  playTone({ frequency: 210, duration: 0.15, delay: 0.09, type: "sine", volume: 0.075 });
}

function playFinaleSound() {
  playAudioAsset("finale", playFinaleTone);
}

function playFinaleTone() {
  [392, 523, 659, 784, 1046, 1318].forEach((frequency, index) => {
    playTone({
      frequency,
      duration: 0.2,
      delay: index * 0.075,
      type: "triangle",
      volume: 0.17,
    });
  });
}

function launchSmallFirework() {
  const rect = els.targetNumber.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height * 0.28;

  createFireworkBurst({
    x,
    y,
    particleCount: 28,
    distance: 122,
    duration: 940,
    size: "small",
  });
}

function launchFinaleFireworks() {
  if (prefersReducedMotion) {
    return;
  }

  const bursts = [
    { x: 18, y: 18, delay: 0 },
    { x: 82, y: 18, delay: 120 },
    { x: 50, y: 28, delay: 240 },
    { x: 28, y: 48, delay: 380 },
    { x: 72, y: 50, delay: 520 },
    { x: 50, y: 16, delay: 680 },
    { x: 14, y: 64, delay: 820 },
    { x: 86, y: 66, delay: 960 },
  ];

  bursts.forEach((burst) => {
    window.setTimeout(() => {
      createFireworkBurst({
        x: (window.innerWidth * burst.x) / 100,
        y: (window.innerHeight * burst.y) / 100,
        particleCount: 44,
        distance: 190,
        duration: 1380,
        size: "large",
      });
    }, burst.delay);
  });
}

function createFireworkBurst({ x, y, particleCount, distance, duration, size }) {
  if (els.fireworksLayer === null || prefersReducedMotion) {
    return;
  }

  const burst = document.createElement("div");
  burst.className = `firework-burst firework-${size}`;
  burst.style.setProperty("--x", `${x}px`);
  burst.style.setProperty("--y", `${y}px`);
  burst.style.setProperty("--duration", `${duration}ms`);

  for (let index = 0; index < particleCount; index += 1) {
    const particle = document.createElement("span");
    const angle = (Math.PI * 2 * index) / particleCount;
    const spread = distance * (0.72 + Math.random() * 0.45);

    particle.style.setProperty("--dx", `${Math.cos(angle) * spread}px`);
    particle.style.setProperty("--dy", `${Math.sin(angle) * spread}px`);
    particle.style.setProperty("--hue", String(Math.floor(Math.random() * 360)));
    particle.style.setProperty("--delay", `${Math.random() * 60}ms`);
    burst.append(particle);
  }

  els.fireworksLayer.append(burst);
  window.setTimeout(() => burst.remove(), duration + 240);
}

function startTimer() {
  state.startTime = Date.now();
  state.elapsedMs = 0;
  updateTimer();
  timerInterval = window.setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }

  if (state.startTime !== null) {
    state.elapsedMs = Date.now() - state.startTime;
  }
}

function updateTimer() {
  if (state.startTime === null) {
    els.timerText.textContent = "00:00";
    return;
  }

  state.elapsedMs = Date.now() - state.startTime;
  els.timerText.textContent = formatElapsed(state.elapsedMs);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

els.musicButton.addEventListener("click", toggleBackgroundMusic);
els.submitButton.addEventListener("click", submitAnswer);
els.nextButton.addEventListener("click", moveForward);
els.restartButton.addEventListener("click", () => {
  ensureBackgroundMusic();
  startSession();
});
els.againButton.addEventListener("click", () => {
  ensureBackgroundMusic();
  startSession();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopBackgroundMusic();
    return;
  }

  ensureBackgroundMusic();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

configureBackgroundMusic();
renderMusicButton();
startSession();
