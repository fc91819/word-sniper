/* Review scheduling and local progress storage for Word Sniper. */
(function (root) {
  "use strict";

  const STORAGE_KEY = "wordSniperProgress.v1";
  const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 15 };
  const NEW_WORDS_PER_DAY = 12;
  const MAX_DUE_REVIEWS = 30;

  function dateOnly(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (date.getUTCFullYear() !== +match[1] || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]) return null;
    return date;
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function today() {
    try {
      const params = new URLSearchParams(root.location ? root.location.search : "");
      const simulated = params.get("today");
      if (dateOnly(simulated)) return simulated;
    } catch (_) {
      // A restricted URL API should not prevent the game from opening.
    }
    const now = new Date();
    return formatDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  }

  function addDays(dateString, days) {
    const date = dateOnly(dateString) || dateOnly(today());
    date.setUTCDate(date.getUTCDate() + days);
    return formatDate(date);
  }

  function freshProgress() {
    return { version: 1, words: {}, lastCompletedDate: null, streak: 0 };
  }

  function normalizeProgress(value) {
    if (!value || typeof value !== "object" || !value.words || typeof value.words !== "object") return freshProgress();
    const cleanWords = {};
    Object.keys(value.words).forEach(function (id) {
      const item = value.words[id];
      if (!item || !Number.isInteger(item.box) || item.box < 1 || item.box > 5 || !dateOnly(item.due)) return;
      cleanWords[id] = {
        box: item.box,
        due: item.due,
        wrongCount: Math.max(0, Number(item.wrongCount) || 0),
        lastSeen: dateOnly(item.lastSeen) ? item.lastSeen : item.due
      };
    });
    return {
      version: 1,
      words: cleanWords,
      lastCompletedDate: dateOnly(value.lastCompletedDate) ? value.lastCompletedDate : null,
      streak: Math.max(0, Number(value.streak) || 0)
    };
  }

  function loadProgress() {
    try {
      if (!root.localStorage) return freshProgress();
      const saved = root.localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeProgress(JSON.parse(saved)) : freshProgress();
    } catch (_) {
      return freshProgress();
    }
  }

  function saveProgress(progress) {
    try {
      if (!root.localStorage) return false;
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProgress(progress)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function boxFor(progress, id) {
    return progress.words[id] ? progress.words[id].box : 0;
  }

  function modeForBox(box) {
    if (box <= 1) return "aim";
    if (box <= 3) return "spell";
    return "recall";
  }

  function dueWords(words, progress, date, limit) {
    const todayDate = dateOnly(date) ? date : today();
    return words.filter(function (word) {
      const record = progress.words[word.id];
      return record && record.due <= todayDate;
    }).sort(function (a, b) {
      const left = progress.words[a.id];
      const right = progress.words[b.id];
      return left.due.localeCompare(right.due) || left.lastSeen.localeCompare(right.lastSeen) || a.id - b.id;
    }).slice(0, limit == null ? MAX_DUE_REVIEWS : limit);
  }

  function buildDailyQueue(words, progress, date) {
    const day = dateOnly(date) ? date : today();
    const due = dueWords(words, progress, day, MAX_DUE_REVIEWS).map(function (word) {
      const box = boxFor(progress, word.id);
      return { word: word, box: box, mode: modeForBox(box), retry: false, kind: "review" };
    });
    const dueIds = new Set(due.map(function (item) { return item.word.id; }));
    const fresh = words.filter(function (word) {
      return !progress.words[word.id] && !dueIds.has(word.id);
    }).slice(0, NEW_WORDS_PER_DAY).map(function (word) {
      return { word: word, box: 0, mode: "aim", retry: false, kind: "new" };
    });
    return due.concat(fresh);
  }

  function recordAnswer(progress, wordId, isCorrect, date) {
    const day = dateOnly(date) ? date : today();
    const previous = progress.words[wordId];
    const box = previous ? previous.box : 0;
    if (isCorrect) {
      const nextBox = Math.min(5, box + 1);
      progress.words[wordId] = {
        box: nextBox,
        due: addDays(day, INTERVALS[nextBox]),
        wrongCount: previous ? previous.wrongCount : 0,
        lastSeen: day
      };
    } else {
      progress.words[wordId] = {
        box: 1,
        due: addDays(day, 1),
        wrongCount: (previous ? previous.wrongCount : 0) + 1,
        lastSeen: day
      };
    }
    saveProgress(progress);
    return progress.words[wordId];
  }

  function completeSession(progress, date) {
    const day = dateOnly(date) ? date : today();
    if (progress.lastCompletedDate !== day) {
      progress.streak = progress.lastCompletedDate === addDays(day, -1) ? progress.streak + 1 : 1;
      progress.lastCompletedDate = day;
    }
    saveProgress(progress);
    return progress.streak;
  }

  function masteredCount(progress) {
    return Object.keys(progress.words).reduce(function (sum, id) {
      return sum + (progress.words[id].box >= 3 ? 1 : 0);
    }, 0);
  }

  function dueCount(words, progress, date) {
    const todayDate = dateOnly(date) ? date : today();
    return words.reduce(function (sum, word) {
      const record = progress.words[word.id];
      return sum + (record && record.due <= todayDate ? 1 : 0);
    }, 0);
  }

  root.SRS = {
    STORAGE_KEY: STORAGE_KEY,
    INTERVALS: INTERVALS,
    NEW_WORDS_PER_DAY: NEW_WORDS_PER_DAY,
    MAX_DUE_REVIEWS: MAX_DUE_REVIEWS,
    today: today,
    addDays: addDays,
    freshProgress: freshProgress,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    boxFor: boxFor,
    modeForBox: modeForBox,
    dueWords: dueWords,
    dueCount: dueCount,
    buildDailyQueue: buildDailyQueue,
    recordAnswer: recordAnswer,
    completeSession: completeSession,
    masteredCount: masteredCount
  };
})(typeof window !== "undefined" ? window : globalThis);
