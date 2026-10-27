/* Single playback coordinator for speech synthesis and the Youdao fallback. */
(function (root) {
  "use strict";

  const synthesis = root.speechSynthesis || null;
  const Utterance = root.SpeechSynthesisUtterance || null;
  let sequence = 0;
  let engine = "youdao";
  let selectedVoice = null;
  let currentAudio = null;
  let preparedAudio = null;
  let preparedText = "";
  const preferredVoiceNames = [
    "Samantha", "Ava", "Allison", "Susan", "Zoe", "Nicky", "Tom", "Alex",
    "Aaron", "Evan", "Nathan", "Joelle", "Noelle"
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
    return blockedVoiceNames.some(function (blocked) { return name.includes(blocked.toLowerCase()); });
  }

  function englishVoice(voices) {
    const eligible = voices.filter(function (voice) { return isEnglish(voice) && !isBlocked(voice); });
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

  function updateVoiceStatus() {
    const status = root.document && root.document.getElementById("voiceStatus");
    if (status) status.textContent = "当前发音：" + (selectedVoice ? selectedVoice.name : "有道词典");
  }

  function reportSelectedVoice() {
    updateVoiceStatus();
    if (selectedVoice && root.console && typeof root.console.info === "function") {
      root.console.info("单词狙击手发音：" + selectedVoice.name + " " + selectedVoice.lang);
    }
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
      engine = voice ? "speech" : "youdao";
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

  function clearAudio(audio) {
    if (!audio) return;
    try { audio.pause(); } catch (_) {}
    try {
      if (typeof audio.removeAttribute === "function") audio.removeAttribute("src");
      else audio.src = "";
      if (typeof audio.load === "function") audio.load();
    } catch (_) {}
  }

  function stopCurrent() {
    let shouldDelaySpeech = false;
    if (synthesis) {
      try {
        shouldDelaySpeech = Boolean(synthesis.speaking || synthesis.pending);
        synthesis.cancel();
      } catch (_) {}
    }
    clearAudio(currentAudio);
    currentAudio = null;
    return shouldDelaySpeech;
  }

  function discardPrepared() {
    clearAudio(preparedAudio);
    preparedAudio = null;
    preparedText = "";
  }

  function audioUrl(text) {
    return "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(text) + "&type=2";
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
    } catch (_) {
      // A failed preload does not block the current word or sentence.
    }
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

  function playSpeech(text, token, shouldDelaySpeech) {
    const utterance = new Utterance(text);
    utterance.lang = selectedVoice.lang || "en-US";
    utterance.voice = selectedVoice;
    utterance.rate = 0.9;
    utterance.onerror = function (event) {
      if (!latest(token)) return;
      const error = String(event && event.error || "").toLowerCase();
      if (error === "interrupted" || error === "canceled") return;
      // Speech synthesis is the selected engine for this page; do not mix in a second voice.
    };
    utterance.onend = function () {
      if (!latest(token)) return;
    };
    const start = function () {
      if (!latest(token)) return;
      try {
        synthesis.speak(utterance);
      } catch (_) {
        // Keep the selected engine stable for the page instead of mixing voices.
      }
    };
    if (shouldDelaySpeech) root.setTimeout(start, 80);
    else start();
  }

  function unlockSpeech(token, shouldDelaySpeech) {
    if (!synthesis || !Utterance) return;
    try {
      const utterance = new Utterance(" ");
      utterance.lang = selectedVoice ? selectedVoice.lang : "en-US";
      utterance.voice = selectedVoice;
      utterance.volume = 0;
      utterance.rate = 0.9;
      utterance.onerror = function (event) {
        if (!latest(token)) return;
        const error = String(event && event.error || "").toLowerCase();
        if (error === "interrupted" || error === "canceled") return;
      };
      utterance.onend = function () {
        if (!latest(token)) return;
      };
      const start = function () {
        if (!latest(token)) return;
        try { synthesis.speak(utterance); } catch (_) { /* Unlocking is best-effort. */ }
      };
      if (shouldDelaySpeech) root.setTimeout(start, 80);
      else start();
    } catch (_) {
      // Unlocking is best-effort; the selected playback engine remains unchanged.
    }
  }

  function playYoudao(text, token, reusableAudio) {
    let audio = reusableAudio || null;
    try {
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.src = audioUrl(text);
      }
      currentAudio = audio;
      audio.onerror = function () {
        if (!latest(token)) return;
      };
      audio.onended = function () {
        if (!latest(token)) return;
        if (currentAudio === audio) currentAudio = null;
      };
      preloadNext(text, token);
      const playing = audio.play();
      if (playing && typeof playing.then === "function") {
        playing.then(function () {
          if (!latest(token)) return;
        }).catch(function () {
          if (!latest(token)) return;
        });
      }
    } catch (_) {
      if (!latest(token)) return;
    }
  }

  function say(text) {
    const token = ++sequence;
    const phrase = String(text == null ? "" : text);
    let reusableAudio = null;
    if (preparedAudio && preparedText === phrase) {
      reusableAudio = preparedAudio;
      preparedAudio = null;
      preparedText = "";
    }
    const shouldDelaySpeech = stopCurrent();
    if (!phrase.trim()) {
      discardPrepared();
      unlockSpeech(token, shouldDelaySpeech);
      return;
    }

    voicesReady.then(function () {
      if (!latest(token)) return;
      if (engine === "speech" && selectedVoice) {
        if (reusableAudio) clearAudio(reusableAudio);
        discardPrepared();
        playSpeech(phrase, token, shouldDelaySpeech);
        return;
      }
      playYoudao(phrase, token, reusableAudio);
    });
  }

  function stop() {
    sequence += 1;
    stopCurrent();
    discardPrepared();
  }

  if (root.document && typeof root.document.addEventListener === "function") {
    root.document.addEventListener("sniper:question", function () {
      const token = sequence;
      voicesReady.then(function () {
        if (!latest(token) || engine !== "youdao") return;
        preloadNext("", token);
      });
    });
  }

  root.Speaker = { say: say, stop: stop };
})(window);
