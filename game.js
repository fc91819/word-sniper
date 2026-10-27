(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  const BACKUP_META_KEY = "wordSniperBackupMeta.v1";
  const RANKS = [
    { name: "列兵", at: 0 }, { name: "上等兵", at: 10 }, { name: "下士", at: 25 },
    { name: "中士", at: 45 }, { name: "上士", at: 70 }, { name: "少尉", at: 100 },
    { name: "中尉", at: 130 }, { name: "上尉", at: 160 }, { name: "少校", at: 200 }
  ];
  const app = {
    progress: SRS.loadProgress(),
    date: SRS.today(),
    queue: [],
    index: 0,
    current: null,
    session: null,
    detailRevealTimeout: null,
    detailGateTimeout: null,
    detailReadyAt: 0,
    toastTimeout: null,
    correctionRequired: false,
    answeredCurrent: false,
    storageAvailable: true
  };
  let workerLifecycle = null;

  function getRank(count) {
    let index = 0;
    for (let i = 0; i < RANKS.length; i += 1) {
      if (count >= RANKS[i].at) index = i;
      else break;
    }
    return { current: RANKS[index], next: RANKS[index + 1] || null };
  }

  function updateHome() {
    const mastered = SRS.masteredCount(app.progress);
    const rank = getRank(mastered);
    const due = SRS.dueCount(WORDS, app.progress, app.date);
    const fresh = WORDS.filter(function (word) { return !app.progress.words[word.id]; }).length;
    const planned = Math.min(SRS.NEW_WORDS_PER_DAY, fresh);
    $("dateLabel").textContent = app.date + " / READY";
    $("rankName").textContent = rank.current.name;
    $("masteredCount").textContent = String(mastered);
    $("dueCount").textContent = String(due);
    $("streakCount").innerHTML = String(app.progress.streak) + "<em>天</em>";
    if (rank.next) {
      $("rankNext").textContent = "距离" + rank.next.name;
      $("rankGap").textContent = "还差 " + Math.max(0, rank.next.at - mastered) + " 词";
      const previousThreshold = rank.current.at;
      const span = rank.next.at - previousThreshold;
      $("rankProgress").style.width = Math.max(0, Math.min(100, ((mastered - previousThreshold) / span) * 100)) + "%";
    } else {
      $("rankNext").textContent = "最高军衔";
      $("rankGap").textContent = "已达成";
      $("rankProgress").style.width = "100%";
    }
    $("queuePreview").textContent = due ? due + " 个复习 · " + planned + " 个新词" : planned + " 个新词";
    $("missionMeta").textContent = due ? "先复习 " + due + " 个到期词 · 再学 " + planned + " 个新词" : "新词 " + planned + " 个 · 约 5–8 分钟";
    app.storageAvailable = SRS.saveProgress(app.progress);
    $("storageNotice").hidden = app.storageAvailable;
    updateBackupReminder();
    const queue = SRS.buildDailyQueue(WORDS, app.progress, app.date);
    $("startButton").disabled = queue.length === 0;
    if (!queue.length) $("missionMeta").textContent = "词库已完成 · 今天没有待复习单词";
  }

  function setScreen(name) {
    $("homeView").hidden = name !== "home";
    $("gameView").hidden = name !== "game";
    $("resultView").hidden = name !== "result";
  }

  function createWorkerLifecycle(serviceWorkerContainer, doc, win, isHome) {
    let registration = null;
    let updatePending = false;
    let reloadRequested = false;

    function reloadAtHome() {
      if (!updatePending || reloadRequested || !isHome()) return;
      reloadRequested = true;
      win.location.reload();
    }

    serviceWorkerContainer.addEventListener("controllerchange", function () {
      updatePending = true;
      reloadAtHome();
    });
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState !== "visible" || !registration || typeof registration.update !== "function") return;
      try {
        const update = registration.update();
        if (update && typeof update.catch === "function") update.catch(function () {});
      } catch (_) {}
    });

    return {
      setRegistration: function (value) { registration = value; },
      onHome: reloadAtHome
    };
  }

  function startSession() {
    if (app.storageAvailable) app.progress = SRS.loadProgress();
    app.queue = SRS.buildDailyQueue(WORDS, app.progress, app.date);
    if (!app.queue.length) {
      showToast("今日任务已完成，明天再来。 ");
      return;
    }
    app.index = 0;
    app.current = null;
    app.session = {
      totalAnswers: 0,
      correctAnswers: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      lives: 5,
      wrongWords: new Map(),
      newWords: new Set(),
      seen: new Set()
    };
    $("livesDisplay").setAttribute("aria-label", "剩余 5 格血");
    setScreen("game");
    renderQuestion();
  }

  function shuffle(list) {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function multiplier() {
    if (app.session.combo >= 6) return 3;
    if (app.session.combo >= 3) return 2;
    return 1;
  }

  function updateHud() {
    const total = Math.max(1, app.queue.length);
    const displayIndex = Math.min(app.index + 1, total);
    $("taskCount").textContent = "任务 " + displayIndex + " / " + total;
    $("taskProgress").style.width = Math.min(100, (app.index / total) * 100) + "%";
    $("comboCount").textContent = String(app.session.combo);
    $("comboMultiplier").textContent = multiplier() + "×";
    $("scoreCount").textContent = String(app.session.score);
    const hearts = [];
    for (let i = 0; i < 5; i += 1) hearts.push('<span class="' + (i < app.session.lives ? "life-on" : "life-off") + '">♥</span>');
    $("livesDisplay").innerHTML = hearts.join(" ");
    $("livesDisplay").setAttribute("aria-label", "剩余 " + app.session.lives + " 格血");
  }

  function configureMode(item) {
    const isAim = item.mode === "aim";
    $("aimArea").hidden = !isAim;
    $("spellArea").hidden = isAim;
    $("questionPanel").hidden = false;
    $("wordDetail").hidden = true;
    $("feedback").textContent = "";
    $("feedback").className = "feedback";
    $("questionText").textContent = item.word.cn;
    $("boxLabel").textContent = "BOX " + item.box;
    $("questionHint").textContent = !isAim ? "听发音，拼出单词" : item.kind === "new" && !item.retry ? "新目标 / 记住中文，找到正确单词" : "中文释义 / 选择正确答案";
    if (isAim) {
      $("modeEyebrow").textContent = "TARGET RANGE / CHOOSE";
      $("modeTitle").textContent = "打靶认词";
      $("questionLabel").textContent = "锁定目标 / 选择正确单词";
      renderTargets(item);
    } else {
      const recall = item.mode === "recall";
      $("modeEyebrow").textContent = recall ? "NO HINT / RECALL" : "LOAD & SPELL / HINT ON";
      $("modeTitle").textContent = recall ? "默写" : "装弹拼写";
      $("questionLabel").textContent = recall ? "无提示 / 听音默写" : "装弹 / 首字母与长度提示";
      renderSpelling(item, recall);
    }
    updateHud();
  }

  function renderTargets(item) {
    const options = shuffle([item.word.word].concat(item.word.distractors));
    const grid = $("targetGrid");
    grid.innerHTML = "";
    options.forEach(function (word, index) {
      const target = document.createElement("button");
      target.type = "button";
      target.className = "target";
      target.dataset.word = word;
      target.innerHTML = '<span class="target-index">T-' + String(index + 1).padStart(2, "0") + '</span><span class="target-word"></span>';
      target.querySelector(".target-word").textContent = word;
      target.addEventListener("click", function () { answerAim(word, target); });
      grid.appendChild(target);
    });
  }

  function renderKeyboard() {
    const keyboard = $("keyboard");
    keyboard.innerHTML = "";
    const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
    rows.forEach(function (letters, rowIndex) {
      const row = document.createElement("div");
      row.className = "keyboard-row";
      letters.split("").forEach(function (letter) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key-button";
        key.textContent = letter;
        key.setAttribute("aria-label", letter);
        key.addEventListener("click", function () { insertLetter(letter); });
        row.appendChild(key);
      });
      if (rowIndex === 2) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "key-button utility";
        back.textContent = "⌫ 删除";
        back.addEventListener("click", function () { $("spellInput").value = $("spellInput").value.slice(0, -1); $("spellInput").focus(); });
        row.appendChild(back);
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "key-button utility";
        clear.textContent = "清空";
        clear.addEventListener("click", function () { $("spellInput").value = ""; $("spellInput").focus(); });
        row.appendChild(clear);
      }
      keyboard.appendChild(row);
    });
  }

  function renderSpelling(item, recall) {
    const input = $("spellInput");
    input.value = "";
    input.disabled = false;
    $("correctionPanel").hidden = true;
    $("submitLabel").textContent = "确认拼写";
    $("spellHint").hidden = recall;
    $("spellHint").textContent = recall ? "" : "首字母：" + item.word.word.charAt(0).toUpperCase() + "　·　字母数：" + item.word.word.length;
    $("replayButton").hidden = false;
    app.correctionRequired = false;
    $("submitSpell").onclick = submitSpelling;
    $("spellInput").onkeydown = function (event) {
      if (event.key === "Enter") { event.preventDefault(); submitSpelling(); }
    };
    renderKeyboard();
    Speaker.say(item.word.word);
  }

  function insertLetter(letter) {
    const input = $("spellInput");
    if (input.disabled) return;
    const start = input.selectionStart == null ? input.value.length : input.selectionStart;
    const end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    input.value = input.value.slice(0, start) + letter + input.value.slice(end);
    input.focus();
    const cursor = start + letter.length;
    try { input.setSelectionRange(cursor, cursor); } catch (_) { /* Input type may not expose selection. */ }
  }

  function markSeen(item) {
    if (item.kind === "new" && !item.retry) app.session.newWords.add(item.word.id);
  }

  function markWrong(item) {
    app.session.wrongWords.set(item.word.id, item.word);
  }

  function scheduleRetry(item) {
    if (item.retry || app.session.seen.has(item.word.id + ":retry")) return;
    app.session.seen.add(item.word.id + ":retry");
    app.queue.push(SRS.makeRetryItem(item));
  }

  function updateCombo(correct) {
    if (!correct) {
      app.session.combo = 0;
      return;
    }
    app.session.combo += 1;
    app.session.maxCombo = Math.max(app.session.maxCombo, app.session.combo);
    app.session.score += 10 * multiplier();
  }

  function answerAim(selectedWord, clickedTarget) {
    if (app.answeredCurrent) return;
    app.answeredCurrent = true;
    const item = app.current;
    const correct = selectedWord.toLowerCase() === item.word.word.toLowerCase();
    const allTargets = Array.from($("targetGrid").querySelectorAll(".target"));
    allTargets.forEach(function (button) {
      button.disabled = true;
      if (button.dataset.word.toLowerCase() === item.word.word.toLowerCase()) button.classList.add("correct-answer");
      if (!correct && button === clickedTarget) button.classList.add("missed");
      if (button !== clickedTarget && correct) button.classList.add("dimmed");
    });
    markSeen(item);
    app.session.totalAnswers += 1;
    if (correct) {
      app.session.correctAnswers += 1;
      updateCombo(true);
      SRS.recordAttempt(app.progress, item, true, app.date);
      clickedTarget.classList.add("hit");
      $("feedback").textContent = "命中！";
      $("feedback").className = "feedback good";
      updateHud();
      scheduleWordDetail(item, 420);
    } else {
      app.session.lives = Math.max(0, app.session.lives - 1);
      updateCombo(false);
      markWrong(item);
      scheduleRetry(item);
      SRS.recordAttempt(app.progress, item, false, app.date);
      $("feedback").textContent = "未命中 · 正确答案已标出";
      $("feedback").className = "feedback bad";
      updateHud();
      scheduleWordDetail(item, 1500);
    }
  }

  function submitSpelling() {
    if (app.answeredCurrent && !app.correctionRequired) return;
    const item = app.current;
    const typed = $("spellInput").value.trim().toLowerCase();
    const correct = typed === item.word.word.toLowerCase();
    if (app.correctionRequired) {
      if (!correct) {
        $("feedback").textContent = "请照着正确拼写再输入一次。";
        $("feedback").className = "feedback bad";
        return;
      }
      app.correctionRequired = false;
      $("feedback").textContent = "装弹完成。";
      $("feedback").className = "feedback good";
      $("spellInput").disabled = true;
      showWordDetail(item);
      return;
    }
    app.answeredCurrent = true;
    markSeen(item);
    app.session.totalAnswers += 1;
    if (!correct) {
      updateCombo(false);
      markWrong(item);
      scheduleRetry(item);
      SRS.recordAttempt(app.progress, item, false, app.date);
      app.correctionRequired = true;
      $("correctWord").textContent = item.word.word;
      $("correctionPanel").hidden = false;
      $("spellInput").value = "";
      $("spellInput").disabled = false;
      $("submitLabel").textContent = "完成装弹";
      $("feedback").textContent = "拼写有误 · 按正确拼写再输入一次";
      $("feedback").className = "feedback bad";
      updateHud();
      $("spellInput").focus();
      return;
    }
    app.session.correctAnswers += 1;
    updateCombo(true);
    SRS.recordAttempt(app.progress, item, true, app.date);
    $("spellInput").disabled = true;
    $("feedback").textContent = "装弹完成 · 开火命中";
    $("feedback").className = "feedback good";
    updateHud();
    showWordDetail(item);
  }

  function scheduleWordDetail(item, delay) {
    window.clearTimeout(app.detailRevealTimeout);
    app.detailRevealTimeout = window.setTimeout(function () {
      app.detailRevealTimeout = null;
      if (!$("gameView").hidden) showWordDetail(item);
    }, delay);
  }

  function showWordDetail(item) {
    Speaker.stop();
    window.clearTimeout(app.detailGateTimeout);
    $("questionPanel").hidden = true;
    $("wordDetail").hidden = false;
    $("detailWord").textContent = item.word.word;
    $("detailPhonetic").textContent = item.word.phonetic;
    $("detailMeaning").textContent = item.word.pos + "　" + item.word.cn;
    $("detailExample").textContent = item.word.example;
    $("detailExampleCn").textContent = item.word.exampleCn;
    $("detailPos").textContent = item.word.topic + " · " + item.word.pos;
    app.detailReadyAt = Date.now() + 800;
    $("skipDetail").disabled = true;
    app.detailGateTimeout = window.setTimeout(function () {
      app.detailGateTimeout = null;
      if (!$("wordDetail").hidden) $("skipDetail").disabled = false;
    }, 800);
    $("wordDetail").focus();
    Speaker.say(item.word.word);
  }

  function nextQuestion() {
    if (!$("wordDetail").hidden && Date.now() < app.detailReadyAt) return;
    window.clearTimeout(app.detailGateTimeout);
    app.detailGateTimeout = null;
    $("skipDetail").disabled = false;
    app.detailReadyAt = 0;
    app.index += 1;
    app.answeredCurrent = false;
    app.correctionRequired = false;
    try { Speaker.stop(); } catch (_) { /* Playback errors must not block question changes. */ }
    renderQuestion();
  }

  function renderQuestion() {
    if (app.index >= app.queue.length) {
      finishSession();
      return;
    }
    app.current = app.queue[app.index];
    app.answeredCurrent = false;
    const nextItem = app.queue[app.index + 1];
    $("nextAudioWord").value = nextItem ? nextItem.word.word : "";
    document.dispatchEvent(new Event("sniper:question"));
    configureMode(app.current);
  }

  function finishSession() {
    Speaker.stop();
    window.clearTimeout(app.detailRevealTimeout);
    window.clearTimeout(app.detailGateTimeout);
    SRS.completeSession(app.progress, app.date);
    SRS.saveProgress(app.progress);
    const accuracy = app.session.totalAnswers ? Math.round((app.session.correctAnswers / app.session.totalAnswers) * 100) : 0;
    const ratingValue = Math.round(accuracy * 0.75 + (app.session.lives / 5) * 25);
    const rating = ratingValue >= 90 ? "A" : ratingValue >= 75 ? "B" : ratingValue >= 55 ? "C" : "D";
    $("accuracyResult").textContent = accuracy + "%";
    $("comboResult").textContent = String(app.session.maxCombo);
    $("newWordsResult").textContent = String(app.session.newWords.size);
    $("resultSubhead").textContent = "本局评价 " + rating + " · 命中率与剩余生命共同计分";
    const wrongWords = Array.from(app.session.wrongWords.values());
    $("wrongCard").hidden = wrongWords.length === 0;
    $("cleanCard").hidden = wrongWords.length !== 0;
    $("wrongCountLabel").textContent = wrongWords.length + " 个";
    const list = $("wrongList");
    list.innerHTML = "";
    wrongWords.forEach(function (word) {
      const row = document.createElement("li");
      const english = document.createElement("strong");
      const chinese = document.createElement("span");
      english.textContent = word.word;
      chinese.textContent = word.cn;
      row.append(english, chinese);
      list.appendChild(row);
    });
    updateHome();
    setScreen("result");
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(app.toastTimeout);
    app.toastTimeout = window.setTimeout(function () { toast.classList.remove("show"); }, 2200);
  }

  function populateAudioDiagnostics() {
    const voiceStatus = $("voiceStatus");
    const selectedVoice = voiceStatus.dataset && voiceStatus.dataset.selectedVoiceName
      ? voiceStatus.dataset.selectedVoiceName
      : "未找到";
    const englishVoiceCount = voiceStatus.dataset && voiceStatus.dataset.englishVoiceCount || "0";
    const localEnglishVoiceCount = voiceStatus.dataset && voiceStatus.dataset.localEnglishVoiceCount || "0";
    let standalone = navigator.standalone === true;
    try {
      standalone = standalone || Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (_) {}
    const lines = [
      "版本：" + (window.APP_VERSION || "未知"),
      "浏览器：" + String(navigator.userAgent || "未知").slice(0, 120),
      "从主屏幕打开：" + (standalone ? "是" : "否"),
      "英文语音总数：" + englishVoiceCount,
      "本机英文语音总数：" + localEnglishVoiceCount,
      "当前选中的声音名：" + selectedVoice
    ];
    $("audioDiagnosticInfo").textContent = lines.join("\n");
    $("diagnosticVoiceLabel").textContent = "指定声音：" + selectedVoice;
  }

  function formatAudioTestResult(result) {
    if (!result) return "✗ 出错：unknown";
    if (result.type === "started") return "✓ 已开始播放（" + Number(result.seconds || 0).toFixed(2) + " 秒）";
    if (result.type === "no-start") return "✗ 1.5 秒没开始";
    if (result.type === "immediate-end") return "✗ 立刻结束";
    if (result.type === "rejected") return "✗ 被拒绝播放";
    if (result.type === "canceled") return "✗ 已取消";
    return "✗ 出错：" + (result.error || result.type || "unknown");
  }

  function attachAudioTest(buttonId, resultId, testLevel) {
    $(buttonId).addEventListener("click", function () {
      const result = $(resultId);
      result.textContent = "检测中…";
      Speaker.say("Hello, let's learn English.", {
        testLevel: testLevel,
        onTestResult: function (outcome) { result.textContent = formatAudioTestResult(outcome); }
      });
    });
  }

  function updateBackupReminder() {
    let lastBackup = null;
    try {
      lastBackup = window.localStorage.getItem(BACKUP_META_KEY);
    } catch (_) {
      // Storage may be disabled; keep the reminder visible in that case.
    }
    const lastTime = lastBackup ? Date.parse(lastBackup + "T00:00:00Z") : NaN;
    const currentTime = Date.parse(app.date + "T00:00:00Z");
    const daysSince = (currentTime - lastTime) / 86400000;
    $("backupReminder").hidden = Number.isFinite(daysSince) && daysSince <= 7;
  }

  function openBackupPane(pane) {
    $("backupTools").hidden = false;
    $("backupExportPane").hidden = pane !== "export";
    $("backupImportPane").hidden = pane !== "import";
  }

  function createBackupCode() {
    if (!app.storageAvailable) {
      showToast("当前浏览器无法读取本机进度，暂时不能生成备份码。");
      return;
    }
    try {
      const saved = window.localStorage.getItem(SRS.STORAGE_KEY);
      const progress = saved ? JSON.parse(saved) : SRS.freshProgress();
      $("backupCode").value = ProgressBackup.encode(progress);
      openBackupPane("export");
      try {
        window.localStorage.setItem(BACKUP_META_KEY, app.date);
      } catch (_) {
        // The code remains available even if backup reminder metadata cannot be stored.
      }
      updateBackupReminder();
    } catch (_) {
      showToast("读取进度失败，无法生成备份码。");
    }
  }

  function validateRestoreCode() {
    const status = $("restoreStatus");
    const preview = $("restorePreview");
    const confirmButton = $("confirmRestoreButton");
    restoreCandidate = null;
    preview.hidden = true;
    confirmButton.hidden = true;
    status.classList.remove("good");
    try {
      restoreCandidate = ProgressBackup.decode($("restoreCode").value, WORDS);
      const mastered = SRS.masteredCount(restoreCandidate);
      const lastDate = restoreCandidate.lastCompletedDate || "未记录";
      preview.textContent = "将恢复：已掌握 " + mastered + " 词，最后学习日期 " + lastDate;
      preview.hidden = false;
      confirmButton.hidden = false;
      status.textContent = "备份码校验通过。确认后才会覆盖当前进度。";
      status.classList.add("good");
    } catch (error) {
      status.textContent = error && error.message ? error.message : "备份码校验失败，请检查内容。";
    }
  }

  function confirmRestore() {
    if (!restoreCandidate) return;
    try {
      window.localStorage.setItem(SRS.STORAGE_KEY, JSON.stringify(restoreCandidate));
      app.progress = restoreCandidate;
      app.storageAvailable = true;
      updateHome();
      $("backupTools").hidden = true;
      restoreCandidate = null;
      showToast("进度已恢复。 ");
    } catch (_) {
      $("restoreStatus").classList.remove("good");
      $("restoreStatus").textContent = "保存失败：当前浏览器无法写入本机进度。";
    }
  }

  function setupServiceWorker() {
    const host = window.location.hostname;
    const allowed = window.location.protocol === "https:" || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (!allowed || !("serviceWorker" in navigator)) return;

    workerLifecycle = createWorkerLifecycle(navigator.serviceWorker, document, window, function () {
      return !$("homeView").hidden;
    });

    const workerUrl = new URL("service-worker.js", document.baseURI).href;
    const scope = new URL("./", document.baseURI).pathname;
    navigator.serviceWorker.register(workerUrl, { scope: scope }).then(function (result) {
      workerLifecycle.setRegistration(result);
      result.update().catch(function () {});
    }).catch(function () {
      // Local files and unsupported browser contexts remain playable without offline caching.
    });
  }

  let restoreCandidate = null;

  function returnHome() {
    Speaker.stop();
    window.clearTimeout(app.detailRevealTimeout);
    window.clearTimeout(app.detailGateTimeout);
    app.detailRevealTimeout = null;
    app.detailGateTimeout = null;
    app.detailReadyAt = 0;
    updateHome();
    setScreen("home");
    if (workerLifecycle) workerLifecycle.onHome();
  }

  $("startButton").addEventListener("click", function () {
    $("audioDiagnostics").hidden = true;
    Speaker.say(" ");
    startSession();
  });
  $("previewAudioButton").addEventListener("click", function () {
    Speaker.say("Hello, let's learn English.");
  });
  $("openAudioDiagnostics").addEventListener("click", function () {
    populateAudioDiagnostics();
    $("audioDiagnostics").hidden = false;
  });
  $("closeAudioDiagnostics").addEventListener("click", function () {
    $("audioDiagnostics").hidden = true;
    Speaker.stop();
  });
  attachAudioTest("testSelectedVoice", "diagnosticVoiceResult", 0);
  attachAudioTest("testDefaultVoice", "diagnosticDefaultResult", 1);
  $("testYoudaoVoice").addEventListener("click", function () {
    const result = $("diagnosticYoudaoResult");
    result.textContent = "检测中…";
    Speaker.say("hello", {
      testLevel: 2,
      onTestResult: function (outcome) { result.textContent = formatAudioTestResult(outcome); }
    });
  });
  $("testBaiduVoice").addEventListener("click", function () {
    const result = $("diagnosticBaiduResult");
    result.textContent = "检测中…";
    Speaker.say("Hello, let's learn English.", {
      testLevel: 3,
      onTestResult: function (outcome) { result.textContent = formatAudioTestResult(outcome); }
    });
  });
  $("homeButton").addEventListener("click", returnHome);
  $("backupButton").addEventListener("click", createBackupCode);
  $("restoreButton").addEventListener("click", function () {
    restoreCandidate = null;
    $("restoreCode").value = "";
    $("restoreStatus").textContent = "";
    $("restoreStatus").classList.remove("good");
    $("restorePreview").hidden = true;
    $("confirmRestoreButton").hidden = true;
    openBackupPane("import");
  });
  $("copyBackupButton").addEventListener("click", async function () {
    const field = $("backupCode");
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(field.value);
      showToast("备份码已复制，请妥善保存。 ");
    } catch (_) {
      field.focus();
      field.select();
      showToast("请长按文本框手动复制");
    }
  });
  $("validateRestoreButton").addEventListener("click", validateRestoreCode);
  $("confirmRestoreButton").addEventListener("click", confirmRestore);
  $("quitButton").addEventListener("click", function () { returnHome(); showToast("训练已结束，已完成的单词进度保留。 "); });
  $("replayButton").addEventListener("click", function () {
    if (app.current) Speaker.say(app.current.word.word);
  });
  $("detailReplay").addEventListener("click", function () {
    if (app.current) Speaker.say(app.current.word.word);
  });
  $("exampleButton").addEventListener("click", function () {
    if (app.current) Speaker.say(app.current.word.example);
  });
  $("skipDetail").addEventListener("click", function () {
    nextQuestion();
  });
  document.addEventListener("keydown", function (event) {
    if ($("gameView").hidden) return;
    if ($("wordDetail").hidden || (event.key !== "Enter" && event.key !== " ")) return;
    if (event.target && typeof event.target.closest === "function" && event.target.closest("button")) return;
    event.preventDefault();
    nextQuestion();
  });

  updateHome();
  setupServiceWorker();
})();
