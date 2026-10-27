/* Single playback coordinator with automatic recovery across three speech routes. */
(function (root) {
  "use strict";

  const synthesis = root.speechSynthesis || null;
  const Utterance = root.SpeechSynthesisUtterance || null;
  let sequence = 0;
  let routeLevel = 2;
  let onlineMode = "youdao";
  let selectedVoice = null;
  let currentAudio = null;
  let preparedAudio = null;
  let preparedText = "";
  let activeSpeechAttempt = null;
  let activeDiagnostic = null;
  let speechRequestToken = 0;
  let speechRequestedAt = 0;
  let speechStartedAt = 0;
  let speechDidStart = false;
  let speechEnded = false;
  let nextAttemptId = 0;

  const preferredVoiceNames = [
    "Samantha", "Ava", "Allison", "Susan", "Zoe", "Nicky", "Tom", "Alex",
    "Aaron", "Evan", "Nathan", "Joelle", "Noelle", "Microsoft Zira", "Microsoft Aria",
    "Microsoft Jenny", "Microsoft David", "Microsoft Mark", "English United States"
  ];
  const blockedVoiceNames = [
    "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Good News",
    "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Junior",
    "Ralph", "Fred", "Kathy", "Grandma", "Grandpa", "Eddy", "Flo", "Reed", "Rocko",
    "Sandy", "Shelley", "Deranged", "Hysterical", "Pipe Organ"
  ];

  function isEnglish(voice) {
    return /^en([_-]|$)/i.test(voice.lang || "");
  }

  function isUsEnglish(voice) {
    return /^en[-_]US$/i.test(voice.lang || "");
  }

  function isBlocked(voice) {
    const name = String(voice.name || "").toLowerCase();
    return /google|online/i.test(name) || blockedVoiceNames.some(function (blocked) {
      return name.includes(blocked.toLowerCase());
    });
  }

  function isLocalVoice(voice) {
    return voice.localService === true && !isBlocked(voice);
  }

  function englishVoice(voices) {
    const eligible = voices.filter(function (voice) {
      return isLocalVoice(voice) && isEnglish(voice);
    });
    const usVoices = eligible.filter(isUsEnglish);

    for (const preferredName of preferredVoiceNames) {
      const matching = usVoices.filter(function (voice) {
        return String(voice.name || "").toLowerCase().includes(preferredName.toLowerCase());
      });
      if (matching.length) {
        return matching.find(function (voice) { return /enhanced|premium/i.test(voice.name || ""); }) || matching[0];
      }
    }

    return eligible.find(function (voice) { return voice.default === true; }) ||
      usVoices[0] || eligible[0] || null;
  }

  function currentRouteLabel() {
    if (routeLevel === 0 && selectedVoice) return selectedVoice.name + "（本机）";
    if (routeLevel === 1) return "系统默认声音（本机）";
    return onlineMode === "baidu" ? "百度翻译朗读（需联网）" : "有道词典（需联网）";
  }

  function updateVoiceStatus() {
    try {
      const status = root.document && root.document.getElementById("voiceStatus");
      if (status) {
        status.textContent = "当前发音：" + currentRouteLabel();
        if (status.dataset) {
          const voices = readVoices();
          const englishVoices = voices.filter(isEnglish);
          status.dataset.selectedVoiceName = selectedVoice ? selectedVoice.name : "未找到";
          status.dataset.routeLevel = String(routeLevel);
          status.dataset.englishVoiceCount = String(englishVoices.length);
          status.dataset.localEnglishVoiceCount = String(englishVoices.filter(function (voice) {
            return voice.localService === true;
          }).length);
        }
      }
    } catch (_) {}
  }

  function reportSelectedVoice() {
    updateVoiceStatus();
    if (selectedVoice && root.console && typeof root.console.info === "function") {
      try { root.console.info("单词狙击手发音：" + selectedVoice.name + " " + selectedVoice.lang); } catch (_) {}
    }
  }

  function setRouteLevel(level) {
    routeLevel = Math.max(0, Math.min(2, level));
    updateVoiceStatus();
  }

  function readVoices() {
    try {
      return synthesis && typeof synthesis.getVoices === "function" ? synthesis.getVoices() : [];
    } catch (_) {
      return [];
    }
  }

  const voicesReady = new Promise(function (resolve) {
    if (!synthesis || !Utterance) {
      routeLevel = 2;
      updateVoiceStatus();
      resolve();
      return;
    }

    let settled = false;
    let timer = null;
    let previousHandler = null;
    const canListen = typeof synthesis.addEventListener === "function";
    const onVoicesChanged = function () { settle(false); };
    const removeListener = function () {
      if (canListen && typeof synthesis.removeEventListener === "function") {
        synthesis.removeEventListener("voiceschanged", onVoicesChanged);
      } else if (synthesis.onvoiceschanged !== previousHandler) {
        synthesis.onvoiceschanged = previousHandler;
      }
    };
    const settle = function (force) {
      if (settled) return;
      const voice = englishVoice(readVoices());
      if (!voice && !force) return;
      selectedVoice = voice;
      routeLevel = voice ? 0 : 2;
      reportSelectedVoice();
      settled = true;
      if (timer !== null) root.clearTimeout(timer);
      removeListener();
      resolve();
    };

    if (canListen) {
      synthesis.addEventListener("voiceschanged", onVoicesChanged);
    } else {
      previousHandler = synthesis.onvoiceschanged;
      synthesis.onvoiceschanged = function (event) {
        if (typeof previousHandler === "function") previousHandler.call(synthesis, event);
        onVoicesChanged();
      };
    }
    timer = root.setTimeout(function () { settle(true); }, 1500);
    settle(false);
  });

  function latest(token) {
    return token === sequence;
  }

  function speechIsStuck(now) {
    if (!synthesis || !speechRequestToken) return false;
    try {
      if (!speechDidStart && !speechEnded && now - speechRequestedAt >= 3000) return true;
      return Boolean(synthesis.speaking) && speechDidStart && !speechEnded && now - speechStartedAt >= 15000;
    } catch (_) {
      return false;
    }
  }

  function clearAttemptTimers(attempt) {
    if (!attempt) return;
    if (attempt.noStartTimer !== null && attempt.noStartTimer !== undefined) root.clearTimeout(attempt.noStartTimer);
    if (attempt.guardTimer !== null && attempt.guardTimer !== undefined) root.clearTimeout(attempt.guardTimer);
    attempt.noStartTimer = null;
    attempt.guardTimer = null;
  }

  function clearAudio(audio) {
    if (!audio) return;
    try { audio.pause(); } catch (_) {}
    try {
      if (typeof audio.removeAttribute === "function") audio.removeAttribute("src");
      else audio.src = "";
      if (typeof audio.load === "function") audio.load();
    } catch (_) {}
  }

  function cancelSynthesis() {
    let shouldDelaySpeech = false;
    if (synthesis) {
      try {
        shouldDelaySpeech = Boolean(synthesis.speaking || synthesis.pending);
        synthesis.cancel();
      } catch (_) {}
    }
    return shouldDelaySpeech;
  }

  function stopCurrent() {
    clearAttemptTimers(activeSpeechAttempt);
    activeSpeechAttempt = null;
    const shouldDelaySpeech = cancelSynthesis();
    clearAudio(currentAudio);
    currentAudio = null;
    return shouldDelaySpeech;
  }

  function discardPrepared() {
    clearAudio(preparedAudio);
    preparedAudio = null;
    preparedText = "";
  }

  function finishDiagnostic(token, result) {
    if (!activeDiagnostic || activeDiagnostic.token !== token) return;
    const pending = activeDiagnostic;
    const callback = pending.onResult;
    activeDiagnostic = null;
    (pending.timers || []).forEach(function (timer) { root.clearTimeout(timer); });
    try { callback(result); } catch (_) {}
  }

  function diagnosticIsCurrent(attempt) {
    return attempt.diagnostic && activeDiagnostic && activeDiagnostic.token === attempt.token;
  }

  function attemptIsCurrent(attempt) {
    return latest(attempt.token) && activeSpeechAttempt === attempt;
  }

  function diagnosticFailure(type, error) {
    return { type: type, error: error || "" };
  }

  function showTapHint(show) {
    try {
      const hint = root.document && root.document.getElementById("audioTapHint");
      if (hint) hint.hidden = !show;
    } catch (_) {}
  }

  function audioUrl(text) {
    return "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(text) + "&type=2";
  }

  function onlineAudioUrl(text) {
    if (!/\s/.test(text)) return audioUrl(text);
    const encodedText = encodeURIComponent(text).replace(/'/g, "%27");
    return "https://fanyi.baidu.com/gettts?lan=en&text=" + encodedText + "&spd=3&source=web";
  }

  function preloadWord(nextText, token) {
    if (!nextText) return;
    if (preparedAudio && preparedText === nextText) return;
    discardPrepared();
    try {
      const audio = new Audio();
      audio.preload = "auto";
      audio.onerror = function () {
        if (!latest(token)) return;
        if (preparedAudio === audio) discardPrepared();
      };
      audio.src = audioUrl(nextText);
      preparedAudio = audio;
      preparedText = nextText;
      if (typeof audio.load === "function") audio.load();
    } catch (_) {}
  }

  function preloadNext(text, token) {
    const node = root.document && root.document.getElementById("nextAudioWord");
    const nextText = node ? String(node.value || "").trim() : "";
    if (!nextText || nextText === text) {
      if (preparedText && preparedText !== nextText) discardPrepared();
      return;
    }
    preloadWord(nextText, token);
  }

  function finishSpeechAttempt(attempt, result) {
    if (!attemptIsCurrent(attempt)) return;
    clearAttemptTimers(attempt);
    activeSpeechAttempt = null;
    speechEnded = true;
    if (diagnosticIsCurrent(attempt)) finishDiagnostic(attempt.token, result);
  }

  function startSpeechAttempt(text, token, level, shouldDelaySpeech, diagnostic) {
    const begin = function () {
      if (!latest(token)) return;
      let utterance;
      try {
        utterance = new Utterance(text);
      } catch (_) {
        speechAttemptFailed({ token: token, level: level, text: text, diagnostic: diagnostic, noStartTimer: null, guardTimer: null }, "error", "utterance");
        return;
      }

      const attempt = {
        id: ++nextAttemptId,
        token: token,
        level: level,
        text: text,
        utterance: utterance,
        diagnostic: diagnostic,
        requestedAt: Date.now(),
        startedAt: 0,
        didStart: false,
        ended: false,
        noStartTimer: null,
        guardTimer: null
      };
      activeSpeechAttempt = attempt;
      utterance.lang = level === 0 && selectedVoice ? (selectedVoice.lang || "en-US") : "en-US";
      if (level === 0 && selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = 0.9;
      speechRequestToken = token;
      speechRequestedAt = attempt.requestedAt;
      speechStartedAt = 0;
      speechDidStart = false;
      speechEnded = false;

      utterance.onstart = function () {
        if (!attemptIsCurrent(attempt)) return;
        if (attempt.ended) return;
        attempt.didStart = true;
        attempt.startedAt = Date.now();
        showTapHint(false);
        speechDidStart = true;
        speechStartedAt = attempt.startedAt;
        if (attempt.noStartTimer !== null) root.clearTimeout(attempt.noStartTimer);
        attempt.noStartTimer = null;
        if (diagnosticIsCurrent(attempt)) {
          attempt.guardTimer = root.setTimeout(function () {
            if (!attemptIsCurrent(attempt)) return;
            finishSpeechAttempt(attempt, {
              type: "started",
              seconds: Math.max(0, attempt.startedAt - attempt.requestedAt) / 1000
            });
          }, 15000);
        }
      };
      utterance.onend = function () {
        if (!attemptIsCurrent(attempt)) return;
        const elapsed = Date.now() - attempt.requestedAt;
        attempt.ended = true;
        if (text.length > 2 && elapsed < 300) {
          speechAttemptFailed(attempt, "immediate-end");
          return;
        }
        if (!attempt.didStart) return;
        if (diagnosticIsCurrent(attempt)) {
          finishSpeechAttempt(attempt, {
            type: "started",
            seconds: Math.max(0, attempt.startedAt - attempt.requestedAt) / 1000
          });
          return;
        }
        finishSpeechAttempt(attempt, null);
      };
      utterance.onerror = function (event) {
        if (!attemptIsCurrent(attempt)) return;
        const error = String(event && event.error || "unknown");
        const normalized = error.toLowerCase();
        if (normalized === "interrupted" || normalized === "canceled") return;
        speechAttemptFailed(attempt, "error", error);
      };

      attempt.noStartTimer = root.setTimeout(function () {
        if (!attemptIsCurrent(attempt) || attempt.didStart) return;
        speechAttemptFailed(attempt, "no-start");
      }, 1500);
      try {
        synthesis.speak(utterance);
      } catch (_) {
        speechAttemptFailed(attempt, "error", "speak");
      }
    };

    if (shouldDelaySpeech) root.setTimeout(begin, 80);
    else begin();
  }

  function speechAttemptFailed(attempt, type, error) {
    if (!latest(attempt.token)) return;
    if (activeSpeechAttempt && activeSpeechAttempt !== attempt) return;
    clearAttemptTimers(attempt);
    if (activeSpeechAttempt === attempt) activeSpeechAttempt = null;
    speechEnded = true;

    if (attempt.diagnostic) {
      cancelSynthesis();
      finishDiagnostic(attempt.token, diagnosticFailure(type, error));
      return;
    }

    const nextLevel = Math.min(2, Math.max(routeLevel, attempt.level + 1));
    setRouteLevel(nextLevel);
    const shouldDelay = cancelSynthesis();
    if (nextLevel === 2) {
      playOnlineAudio(attempt.text, attempt.token, null, false);
    } else {
      startSpeechAttempt(attempt.text, attempt.token, nextLevel, shouldDelay, false);
    }
  }

  function playOnlineAudio(text, token, reusableAudio, diagnostic) {
    onlineMode = /\s/.test(text) ? "baidu" : "youdao";
    updateVoiceStatus();
    let audio = reusableAudio || null;
    const requestedAt = Date.now();
    let reported = false;
    let hasStarted = false;
    let startDelay = 0;
    let diagnosticFinishTimer = null;
    const reportStarted = function () {
      if (!latest(token) || reported) return;
      if (diagnostic) {
        if (!hasStarted) {
          hasStarted = true;
          startDelay = Math.max(0, Date.now() - requestedAt) / 1000;
          diagnosticFinishTimer = root.setTimeout(function () {
            if (!diagnosticIsCurrent({ token: token, diagnostic: true })) return;
            reportDiagnosticSuccess();
          }, 15000);
          if (activeDiagnostic && activeDiagnostic.token === token) activeDiagnostic.timers.push(diagnosticFinishTimer);
        }
        return;
      }
      reported = true;
      showTapHint(false);
    };
    const reportDiagnosticSuccess = function () {
      if (reported || !latest(token)) return;
      reported = true;
      showTapHint(false);
      finishDiagnostic(token, { type: "started", seconds: startDelay });
    };
    const reportFailure = function (type, error) {
      if (reported || !latest(token)) return;
      reported = true;
      if (type === "rejected" || type === "error") showTapHint(true);
      if (diagnostic) finishDiagnostic(token, diagnosticFailure(type, error));
    };

    try {
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.src = onlineAudioUrl(text);
      }
      currentAudio = audio;
      audio.onplaying = function () {
        if (!latest(token)) return;
        reportStarted();
      };
      audio.onerror = function () {
        if (!latest(token)) return;
        const code = audio.error && audio.error.code ? String(audio.error.code) : "audio";
        reportFailure("error", code);
      };
      audio.onended = function () {
        if (!latest(token)) return;
        if (currentAudio === audio) currentAudio = null;
        if (diagnostic) {
          if (hasStarted) reportDiagnosticSuccess();
          else reportFailure(Date.now() - requestedAt < 300 ? "immediate-end" : "no-start");
          return;
        }
      };
      if (!diagnostic) preloadNext(text, token);
      const playing = audio.play();
      if (playing && typeof playing.then === "function") {
        playing.then(function () {
          if (!latest(token)) return;
          reportStarted();
        }).catch(function () {
          if (!latest(token)) return;
          reportFailure("rejected");
        });
      } else if (diagnostic) {
        root.setTimeout(function () {
          if (!reported && !hasStarted && latest(token)) reportFailure("rejected");
        }, 1500);
      }
    } catch (_) {
      reportFailure("rejected");
    }
  }

  function beginRoute(text, token, level, shouldDelaySpeech, diagnostic) {
    if (!latest(token)) return;
    if (level >= 2) {
      if (!diagnostic) setRouteLevel(2);
      playOnlineAudio(text, token, null, diagnostic);
      return;
    }
    if (!synthesis || !Utterance) {
      if (diagnostic) {
        finishDiagnostic(token, diagnosticFailure("error", "speech-unavailable"));
        return;
      }
      setRouteLevel(2);
      playOnlineAudio(text, token, null, false);
      return;
    }
    startSpeechAttempt(text, token, level, shouldDelaySpeech, diagnostic);
  }

  function unlockSpeech(token, shouldDelaySpeech) {
    if (!synthesis || !Utterance) return;
    try {
      const utterance = new Utterance(" ");
      utterance.lang = selectedVoice ? (selectedVoice.lang || "en-US") : "en-US";
      if (routeLevel === 0 && selectedVoice) utterance.voice = selectedVoice;
      utterance.volume = 0;
      utterance.rate = 0.9;
      const start = function () {
        if (!latest(token)) return;
        try { synthesis.speak(utterance); } catch (_) {}
      };
      if (shouldDelaySpeech) root.setTimeout(start, 80);
      else start();
    } catch (_) {}
  }

  function say(text, options) {
    try {
      const wasStuck = speechIsStuck(Date.now());
      if (activeDiagnostic) finishDiagnostic(activeDiagnostic.token, diagnosticFailure("canceled"));
      const token = ++sequence;
      const phrase = String(text == null ? "" : text);
      const settings = options || {};
      const diagnosticRequest = Number.isInteger(settings.testLevel) && typeof settings.onTestResult === "function";
      if (diagnosticRequest) activeDiagnostic = { token: token, onResult: settings.onTestResult, timers: [] };
      let reusableAudio = null;
      if (preparedAudio && preparedText === phrase) {
        reusableAudio = preparedAudio;
        preparedAudio = null;
        preparedText = "";
      }
      const shouldDelaySpeech = stopCurrent();
      if (wasStuck) {
        speechRequestToken = 0;
        speechDidStart = false;
        speechEnded = true;
      }
      if (!phrase.trim()) {
        discardPrepared();
        unlockSpeech(token, shouldDelaySpeech);
        return;
      }

      voicesReady.then(function () {
        try {
          if (!latest(token)) return;
          if (diagnosticRequest) {
            if (settings.testLevel === 0 && !selectedVoice) {
              finishDiagnostic(token, diagnosticFailure("error", "voice-unavailable"));
              return;
            }
            beginRoute(phrase, token, settings.testLevel, shouldDelaySpeech, true);
            return;
          }
          if (engineForCurrentRoute() === "youdao" && reusableAudio) {
            playOnlineAudio(phrase, token, reusableAudio, false);
            return;
          }
          if (reusableAudio) clearAudio(reusableAudio);
          beginRoute(phrase, token, routeLevel, shouldDelaySpeech, false);
        } catch (_) {}
      }, function () {});
    } catch (_) {
      try { sequence += 1; } catch (_) {}
      try { stopCurrent(); } catch (_) {}
      try { discardPrepared(); } catch (_) {}
    }
  }

  function engineForCurrentRoute() {
    return routeLevel >= 2 ? "youdao" : "speech";
  }

  function stop() {
    try {
      sequence += 1;
      if (activeDiagnostic) finishDiagnostic(activeDiagnostic.token, diagnosticFailure("canceled"));
      stopCurrent();
      discardPrepared();
      speechRequestToken = 0;
      speechDidStart = false;
      speechEnded = true;
    } catch (_) {}
  }

  if (root.document && typeof root.document.addEventListener === "function") {
    root.document.addEventListener("sniper:question", function () {
      const token = sequence;
      voicesReady.then(function () {
        try {
          if (!latest(token) || routeLevel < 2) return;
          preloadNext("", token);
        } catch (_) {}
      }, function () {});
    });
  }

  root.Speaker = { say: say, stop: stop };
})(window);
