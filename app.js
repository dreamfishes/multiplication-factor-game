const CONFIG = {
  totalRounds: 10,
  cardCount: 8,
  minFactor: 1,
  maxFactor: 9,
  statsKey: "factor-squad-stats-v1",
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
  submitButton: document.querySelector("#submitButton"),
  nextButton: document.querySelector("#nextButton"),
  restartButton: document.querySelector("#restartButton"),
  againButton: document.querySelector("#againButton"),
  resultScore: document.querySelector("#resultScore"),
  resultTime: document.querySelector("#resultTime"),
  resultDetail: document.querySelector("#resultDetail"),
  wrongList: document.querySelector("#wrongList"),
};

const allEquations = buildEquations();
const targetPool = buildTargetPool();

let state = createInitialState();
let timerInterval = null;

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
  stopTimer();
  state = createInitialState();
  els.resultScreen.classList.add("hidden");
  els.playArea.classList.remove("hidden");
  startTimer();
  nextQuestion();
}

function nextQuestion() {
  state.selectedIds = new Set();
  state.submitted = false;
  state.lastAnswerCorrect = null;
  state.currentQuestion = createQuestion();
  render();
}

function retryCurrentQuestion() {
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

  if (state.selectedIds.size === 0) {
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
  } else {
    state.missedTargets.push(state.currentQuestion.target);
  }

  render(isCorrect);
}

function moveForward() {
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
}

function render(lastAnswerCorrect = null) {
  const isCorrectReview = state.submitted && state.lastAnswerCorrect === true;
  const currentRound = Math.min(state.answeredCount + (isCorrectReview ? 0 : 1), CONFIG.totalRounds);
  const progress = (state.answeredCount / CONFIG.totalRounds) * 100;

  els.roundText.textContent = `第 ${currentRound} 题 / ${CONFIG.totalRounds}`;
  els.starText.textContent = String(state.stars);
  els.scoreText.textContent = String(state.score);
  els.progressFill.style.width = `${progress}%`;
  els.targetNumber.textContent = String(state.currentQuestion.target);

  renderFeedback(lastAnswerCorrect ?? state.lastAnswerCorrect);
  renderCards();

  els.submitButton.classList.toggle("hidden", state.submitted);
  els.nextButton.classList.toggle("hidden", !state.submitted);
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
      state.answeredCount >= CONFIG.totalRounds ? "第 10 题答对了，去看总用时。" : "答对了，星星已经收好。";
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

  if (state.selectedIds.has(cardId)) {
    state.selectedIds.delete(cardId);
  } else {
    state.selectedIds.add(cardId);
  }

  render();
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

els.submitButton.addEventListener("click", submitAnswer);
els.nextButton.addEventListener("click", moveForward);
els.restartButton.addEventListener("click", startSession);
els.againButton.addEventListener("click", startSession);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

startSession();
