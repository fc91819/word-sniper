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

  function englishVoice(voices) {
    const english = voices.filter(function (voice) { return /^en([_-]|$)/i.test(voice.lang || ""); });
    return english.find(function (voice) { return /^en[-_]US$/i.test(voice.lang || ""); }) || english[0] || null;
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
    if (synthesis) {
      try { synthesis.cancel(); } catch (_) {}
    }
    clearAudio(currentAudio);
    currentAudio = null;
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

  function playSpeech(text, token) {
    const utterance = new Utterance(text);
    utterance.lang = "en-US";
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
    try {
      synthesis.speak(utterance);
    } catch (_) {
      // Keep the selected engine stable for the page instead of mixing voices.
    }
  }

  function unlockSpeech(token) {
    if (!synthesis || !Utterance) return;
    try {
      const utterance = new Utterance("");
      utterance.lang = "en-US";
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
      synthesis.speak(utterance);
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
    stopCurrent();
    if (!phrase) {
      discardPrepared();
      unlockSpeech(token);
      return;
    }

    voicesReady.then(function () {
      if (!latest(token)) return;
      if (engine === "speech" && selectedVoice) {
        if (reusableAudio) clearAudio(reusableAudio);
        discardPrepared();
        playSpeech(phrase, token);
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
