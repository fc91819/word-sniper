/* Web Audio game sounds. Recorded samples can be enabled by adding processed assets. */
(function (root) {
  "use strict";

  let enabled = true;
  let context = null;
  let masterGain = null;
  let compressor = null;
  let nextAvailableTime = 0;
  let activeShot = null;
  let sampleLoadPromise = null;
  const samples = { sniper: null, dryfire: null };
  // Kept null until CC0 samples have been processed and shipped in sounds/.
  const SAMPLE_URLS = null;
  const HIT_RESERVE_MS = 300;
  const COMBO_MS = 160;
  const MISS_MS = 140;
  const RELOAD_MS = 80;

  function getContext() {
    if (context) return context;
    const AudioContextType = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextType) return null;
    context = new AudioContextType();
    compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, context.currentTime);
    compressor.knee.setValueAtTime(18, context.currentTime);
    compressor.ratio.setValueAtTime(4, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.16, context.currentTime);
    masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.7, context.currentTime);
    masterGain.connect(compressor);
    compressor.connect(context.destination);
    return context;
  }

  function setSourceLabel(id, value) {
    try {
      const node = root.document && root.document.getElementById(id);
      if (node) node.textContent = value;
    } catch (_) {}
  }

  function updateSourceLabels() {
    setSourceLabel("sfxHitSource", samples.sniper ? "录音" : "合成");
    setSourceLabel("sfxMissSource", samples.dryfire ? "录音" : "合成");
  }

  async function decodeSample(audioContext, name, url) {
    try {
      if (typeof root.fetch !== "function") return;
      const response = await root.fetch(url);
      if (!response || !response.ok) throw new Error("sample fetch failed");
      const bytes = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(bytes.slice(0));
      samples[name] = decoded;
    } catch (_) {
      samples[name] = null;
    }
    updateSourceLabels();
  }

  function preloadSamples(audioContext) {
    if (!SAMPLE_URLS || sampleLoadPromise) return sampleLoadPromise;
    sampleLoadPromise = Promise.all([
      decodeSample(audioContext, "sniper", SAMPLE_URLS.sniper),
      decodeSample(audioContext, "dryfire", SAMPLE_URLS.dryfire)
    ]).catch(function () {}).then(function () {
      updateSourceLabels();
    });
    return sampleLoadPromise;
  }

  function unlock() {
    if (!enabled) return;
    try {
      const audioContext = getContext();
      if (!audioContext) return;
      if (audioContext.state === "suspended" && typeof audioContext.resume === "function") {
        const resumed = audioContext.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
      }
      preloadSamples(audioContext);
    } catch (_) {}
  }

  function output(audioContext) {
    getContext();
    if (audioContext !== context || !masterGain) return audioContext.destination;
    return masterGain;
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

  function tone(audioContext, startAt, durationMs, startFrequency, endFrequency, peak, destination, reverbDestination) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const durationSeconds = durationMs / 1000;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    if (endFrequency !== startFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + durationSeconds);
    envelope(gainNode, startAt, durationSeconds, peak, Math.min(0.004, durationSeconds / 5));
    oscillator.connect(gainNode);
    gainNode.connect(destination || output(audioContext));
    if (reverbDestination) gainNode.connect(reverbDestination);
    disconnectOnEnd(oscillator, [oscillator, gainNode]);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationSeconds + 0.004);
  }

  function makeNoiseBuffer(audioContext, durationSeconds) {
    const frameCount = Math.max(1, Math.ceil(audioContext.sampleRate * durationSeconds));
    const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
    const samplesData = buffer.getChannelData(0);
    for (let i = 0; i < samplesData.length; i += 1) samplesData[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function filteredNoise(audioContext, startAt, durationMs, filterType, frequency, q, peak, destination, attackSeconds, reverbDestination) {
    const durationSeconds = durationMs / 1000;
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gainNode = audioContext.createGain();
    source.buffer = makeNoiseBuffer(audioContext, durationSeconds);
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, startAt);
    if (q != null) filter.Q.setValueAtTime(q, startAt);
    envelope(gainNode, startAt, durationSeconds, peak, attackSeconds == null ? Math.min(0.0015, durationSeconds / 4) : attackSeconds);
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(destination || output(audioContext));
    if (reverbDestination) gainNode.connect(reverbDestination);
    disconnectOnEnd(source, [source, filter, gainNode]);
    source.start(startAt);
    source.stop(startAt + durationSeconds + 0.004);
    return source;
  }

  function createImpulse(audioContext, durationSeconds) {
    const frameCount = Math.ceil(audioContext.sampleRate * durationSeconds);
    const impulse = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
    const channel = impulse.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      const decay = Math.exp(-7 * i / frameCount);
      channel[i] = (Math.random() * 2 - 1) * decay;
    }
    return impulse;
  }

  function createShotGain(audioContext, startAt, endAt) {
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(1, startAt);
    gainNode.gain.setValueAtTime(1, startAt + 0.35);
    gainNode.gain.linearRampToValueAtTime(0.3, startAt + 0.5);
    gainNode.connect(output(audioContext));
    activeShot = { context: audioContext, gain: gainNode, startedAt: startAt, endAt: endAt };
    return gainNode;
  }

  function syntheticSniper(audioContext, startAt) {
    const shotDuration = 1.5;
    const shotGain = createShotGain(audioContext, startAt, startAt + shotDuration);
    const dryBus = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    const wetGain = audioContext.createGain();
    dryBus.gain.setValueAtTime(0.75, startAt);
    wetGain.gain.setValueAtTime(0.25, startAt);
    convolver.buffer = createImpulse(audioContext, 1.2);
    dryBus.connect(shotGain);
    convolver.connect(wetGain);
    wetGain.connect(shotGain);

    filteredNoise(audioContext, startAt, 8, "highpass", 2000, null, 0.28, dryBus, 0.0005, convolver);
    filteredNoise(audioContext, startAt, 150, "lowpass", 400, null, 0.2, dryBus, 0.001, convolver);
    tone(audioContext, startAt, 120, 60, 60, 0.18, dryBus, convolver);
    return shotDuration * 1000;
  }

  function playSample(audioContext, startAt, buffer, initialGain, maximumDurationMs) {
    const durationSeconds = Math.min(buffer.duration || 0, maximumDurationMs / 1000);
    const shotGain = createShotGain(audioContext, startAt, startAt + durationSeconds);
    shotGain.gain.setValueAtTime(initialGain, startAt);
    shotGain.gain.setValueAtTime(initialGain, startAt + Math.min(0.35, durationSeconds));
    shotGain.gain.linearRampToValueAtTime(initialGain * 0.3, startAt + Math.min(0.5, durationSeconds));
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(shotGain);
    source.start(startAt);
    if (durationSeconds < (buffer.duration || 0)) source.stop(startAt + durationSeconds);
    disconnectOnEnd(source, [source, shotGain]);
    return durationSeconds * 1000;
  }

  function duckShotForSpeech() {
    try {
      if (!activeShot || !activeShot.context || !activeShot.gain) return;
      const audioContext = activeShot.context;
      const now = audioContext.currentTime;
      if (now >= activeShot.endAt) { activeShot = null; return; }
      const gain = activeShot.gain.gain;
      if (typeof gain.cancelScheduledValues === "function") gain.cancelScheduledValues(now);
      gain.setValueAtTime(0.14, now);
      gain.linearRampToValueAtTime(0.14, now + 0.01);
    } catch (_) {}
  }

  try {
    if (root.document && typeof root.document.addEventListener === "function") {
      root.document.addEventListener("sniper-word-speech", duckShotForSpeech);
    }
  } catch (_) {}

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
      const result = makeSound(audioContext, startAt);
      nextAvailableTime = startAt + durationMs / 1000;
      return result == null ? durationMs : result;
    } catch (_) {
      return 0;
    }
  }

  function hit() {
    return schedule(HIT_RESERVE_MS, function (audioContext, startAt) {
      if (samples.sniper) return playSample(audioContext, startAt, samples.sniper, 0.35, 1500);
      return syntheticSniper(audioContext, startAt);
    });
  }

  function combo() {
    return schedule(COMBO_MS, function (audioContext, startAt) {
      tone(audioContext, startAt, 80, 660, 820, 0.15);
      tone(audioContext, startAt + 0.08, 80, 990, 1240, 0.15);
      return COMBO_MS;
    });
  }

  function miss() {
    return schedule(MISS_MS, function (audioContext, startAt) {
      if (samples.dryfire) return playSample(audioContext, startAt, samples.dryfire, 0.35, 500);
      const outputNode = output(audioContext);
      filteredNoise(audioContext, startAt, 25, "bandpass", 3500, 8, 0.32, outputNode, 0.001);
      filteredNoise(audioContext, startAt + 0.07, 25, "bandpass", 2200, 6, 0.4, outputNode, 0.001);
      tone(audioContext, startAt + 0.07, 15, 180, 180, 0.08, outputNode);
      filteredNoise(audioContext, startAt + 0.095, 40, "bandpass", 1200, 1.5, 0.09, outputNode, 0.003);
      return MISS_MS;
    });
  }

  function reload() {
    return schedule(RELOAD_MS, function (audioContext, startAt) {
      filteredNoise(audioContext, startAt, 20, "bandpass", 1500, 1.2, 0.16, output(audioContext));
      tone(audioContext, startAt + 0.02, 60, 600, 600, 0.12);
      return RELOAD_MS;
    });
  }

  function setEnabled(value) {
    try { enabled = Boolean(value); } catch (_) { enabled = false; }
  }

  updateSourceLabels();
  root.Sfx = {
    hit: hit,
    combo: combo,
    miss: miss,
    reload: reload,
    setEnabled: setEnabled,
    unlock: unlock
  };
})(window);
