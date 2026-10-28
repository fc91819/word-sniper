/* Short synthesized game sounds. Kept separate from the speech player. */
(function (root) {
  "use strict";

  let enabled = true;
  let context = null;
  let nextAvailableTime = 0;
  const HIT_MS = 120;
  const COMBO_MS = 160;
  const MISS_MS = 110;
  const RELOAD_MS = 80;

  function getContext() {
    if (context) return context;
    const AudioContextType = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextType) return null;
    context = new AudioContextType();
    return context;
  }

  function unlock() {
    if (!enabled) return;
    try {
      const audioContext = getContext();
      if (!audioContext || audioContext.state !== "suspended" || typeof audioContext.resume !== "function") return;
      const resumed = audioContext.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
    } catch (_) {}
  }

  function envelope(gainNode, startAt, durationSeconds, peak, attackSeconds) {
    const gain = gainNode.gain;
    const endAt = startAt + durationSeconds;
    const attackAt = Math.min(endAt, startAt + attackSeconds);
    gain.setValueAtTime(0, startAt);
    gain.linearRampToValueAtTime(peak, attackAt);
    gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.001), endAt);
    gain.setValueAtTime(0, endAt);
  }

  function disconnectOnEnd(source, nodes) {
    source.onended = function () {
      nodes.forEach(function (node) {
        try { node.disconnect(); } catch (_) {}
      });
    };
  }

  function tone(audioContext, startAt, durationMs, startFrequency, endFrequency, peak) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const durationSeconds = durationMs / 1000;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    if (endFrequency !== startFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + durationSeconds);
    envelope(gainNode, startAt, durationSeconds, peak, Math.min(0.004, durationSeconds / 5));
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    disconnectOnEnd(oscillator, [oscillator, gainNode]);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationSeconds + 0.004);
  }

  function noise(audioContext, startAt, durationMs, centerFrequency, q, peak) {
    const durationSeconds = durationMs / 1000;
    const frameCount = Math.max(1, Math.ceil(audioContext.sampleRate * durationSeconds));
    const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gainNode = audioContext.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(centerFrequency, startAt);
    filter.Q.setValueAtTime(q, startAt);
    envelope(gainNode, startAt, durationSeconds, peak, Math.min(0.0015, durationSeconds / 4));
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioContext.destination);
    disconnectOnEnd(source, [source, filter, gainNode]);
    source.start(startAt);
    source.stop(startAt + durationSeconds + 0.003);
  }

  function schedule(durationMs, makeSound) {
    if (!enabled) return 0;
    try {
      const audioContext = getContext();
      if (!audioContext || audioContext.state === "closed") return 0;
      if (audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        try {
          const resumed = audioContext.resume();
          if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
        } catch (_) {}
      }
      const startAt = Math.max(audioContext.currentTime, nextAvailableTime);
      makeSound(audioContext, startAt);
      nextAvailableTime = startAt + durationMs / 1000;
      return durationMs;
    } catch (_) {
      return 0;
    }
  }

  function hit() {
    return schedule(HIT_MS, function (audioContext, startAt) {
      tone(audioContext, startAt, HIT_MS, 880, 1320, 0.18);
    });
  }

  function combo() {
    return schedule(COMBO_MS, function (audioContext, startAt) {
      tone(audioContext, startAt, 80, 660, 820, 0.15);
      tone(audioContext, startAt + 0.08, 80, 990, 1240, 0.15);
    });
  }

  function miss() {
    return schedule(MISS_MS, function (audioContext, startAt) {
      noise(audioContext, startAt, 12, 3500, 8, 0.2);
      noise(audioContext, startAt + 0.07, 18, 2200, 6, 0.25);
      tone(audioContext, startAt + 0.07, 15, 180, 180, 0.08);
    });
  }

  function reload() {
    return schedule(RELOAD_MS, function (audioContext, startAt) {
      noise(audioContext, startAt, 20, 1500, 1.2, 0.16);
      tone(audioContext, startAt + 0.02, 60, 600, 600, 0.12);
    });
  }

  function setEnabled(value) {
    try { enabled = Boolean(value); } catch (_) { enabled = false; }
  }

  root.Sfx = {
    hit: hit,
    combo: combo,
    miss: miss,
    reload: reload,
    setEnabled: setEnabled,
    unlock: unlock
  };
})(window);
