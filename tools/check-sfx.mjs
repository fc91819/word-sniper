import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sfxSource = await readFile(join(projectRoot, "sfx.js"), "utf8");
const gameSource = await readFile(join(projectRoot, "game.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf("  function " + name + "(");
  assert.notEqual(start, -1, name + " should exist");
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(name + " should have balanced braces");
}

class AudioParamMock {
  constructor() { this.events = []; }
  setValueAtTime(value, time) { this.events.push({ kind: "set", value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ kind: "linear", value, time }); }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: "exponential", value, time }); }
  cancelScheduledValues(time) { this.events.push({ kind: "cancel", time }); }
}

class AudioNodeMock {
  constructor() { this.connections = []; this.startTimes = []; this.stopTimes = []; }
  connect(node) { this.connections.push(node); }
  disconnect() {}
  start(time) { this.startTimes.push(time); }
  stop(time) { this.stopTimes.push(time); }
}

class OscillatorMock extends AudioNodeMock {
  constructor() { super(); this.frequency = new AudioParamMock(); this.type = ""; }
}

class GainMock extends AudioNodeMock {
  constructor() { super(); this.gain = new AudioParamMock(); }
}

class FilterMock extends AudioNodeMock {
  constructor() {
    super();
    this.frequency = new AudioParamMock();
    this.Q = new AudioParamMock();
    this.type = "";
  }
}

class BufferSourceMock extends AudioNodeMock {
  constructor() { super(); this.buffer = null; }
}

class ConvolverMock extends AudioNodeMock {
  constructor() { super(); this.buffer = null; }
}

class CompressorMock extends AudioNodeMock {
  constructor() {
    super();
    this.threshold = new AudioParamMock();
    this.knee = new AudioParamMock();
    this.ratio = new AudioParamMock();
    this.attack = new AudioParamMock();
    this.release = new AudioParamMock();
  }
}

class EventMock {
  constructor(type) { this.type = type; }
}

class DocumentMock {
  constructor() { this.listeners = new Map(); this.labels = new Map(); }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return true;
  }
  getElementById(id) {
    if (!this.labels.has(id)) this.labels.set(id, { textContent: "" });
    return this.labels.get(id);
  }
}

class AudioContextMock {
  constructor(state = "running", resume = function () { return Promise.resolve(); }) {
    this.state = state;
    this.currentTime = 12;
    this.sampleRate = 48000;
    this.destination = {};
    this.nodes = [];
    this._resume = resume;
  }
  make(NodeType) { const node = new NodeType(); this.nodes.push(node); return node; }
  createOscillator() { return this.make(OscillatorMock); }
  createGain() { return this.make(GainMock); }
  createBiquadFilter() { return this.make(FilterMock); }
  createBufferSource() { return this.make(BufferSourceMock); }
  createConvolver() { return this.make(ConvolverMock); }
  createDynamicsCompressor() { return this.make(CompressorMock); }
  createBuffer(_channels, frames, sampleRate = this.sampleRate) {
    return {
      duration: frames / sampleRate,
      getChannelData() { return new Float32Array(frames); }
    };
  }
  decodeAudioData() { return Promise.resolve({ duration: 1.2 }); }
  resume() { return this._resume(); }
}

function loadSfx(AudioContextType, options = {}) {
  let source = sfxSource;
  if (options.sampleUrls) {
    source = source.replace("const SAMPLE_URLS = null;", "const SAMPLE_URLS = " + JSON.stringify(options.sampleUrls) + ";");
  }
  const document = options.document || new DocumentMock();
  const window = { document, Event: EventMock };
  if (AudioContextType) window.AudioContext = AudioContextType;
  if (options.fetch) window.fetch = options.fetch;
  vm.runInNewContext(source, { window, Math, Promise }, { filename: "sfx.js" });
  return { Sfx: window.Sfx, document };
}

// a) Missing Web Audio, a rejected resume, and failed sample loads never escape.
{
  const noAudio = loadSfx(null).Sfx;
  for (const name of ["hit", "combo", "miss", "reload", "unlock", "setEnabled"]) {
    assert.doesNotThrow(function () {
      if (name === "setEnabled") noAudio[name](true);
      else noAudio[name]();
    });
  }

  let rejectedContext;
  class RejectedResumeContext extends AudioContextMock {
    constructor() {
      super("suspended", function () { return Promise.reject(new Error("resume denied")); });
      rejectedContext = this;
    }
  }
  const rejected = loadSfx(RejectedResumeContext).Sfx;
  assert.doesNotThrow(function () { rejected.unlock(); });
  for (const name of ["hit", "combo", "miss", "reload"]) assert.doesNotThrow(function () { rejected[name](); });
  await Promise.resolve();
  assert.ok(rejectedContext);

  let failedFetches = 0;
  let fallbackContext;
  class FallbackContext extends AudioContextMock {
    constructor() { super(); fallbackContext = this; }
  }
  const fallback = loadSfx(FallbackContext, {
    sampleUrls: { sniper: "sounds/sniper.mp3", dryfire: "sounds/dryfire.mp3" },
    fetch: async function () { failedFetches += 1; throw new Error("offline"); }
  });
  fallback.Sfx.unlock();
  assert.doesNotThrow(function () { fallback.Sfx.hit(); });
  assert.doesNotThrow(function () { fallback.Sfx.miss(); });
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assert.equal(failedFetches, 2);
  assert.equal(fallback.document.getElementById("sfxHitSource").textContent, "合成");
  assert.equal(fallback.document.getElementById("sfxMissSource").textContent, "合成");
  assert.ok(fallbackContext.nodes.some(function (node) { return node instanceof ConvolverMock; }));
  assert.ok(fallbackContext.nodes.filter(function (node) { return node instanceof FilterMock; }).length >= 5);

  let decodedContext;
  class DecodedContext extends AudioContextMock {
    constructor() { super(); decodedContext = this; }
  }
  const decoded = loadSfx(DecodedContext, {
    sampleUrls: { sniper: "sounds/sniper.mp3", dryfire: "sounds/dryfire.mp3" },
    fetch: async function () { return { ok: true, arrayBuffer: async function () { return new ArrayBuffer(8); } }; }
  });
  decoded.Sfx.unlock();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(decoded.document.getElementById("sfxHitSource").textContent, "录音");
  assert.equal(decoded.document.getElementById("sfxMissSource").textContent, "录音");
  decoded.Sfx.hit();
  decoded.Sfx.miss();
  const recordedSources = decodedContext.nodes.filter(function (node) { return node instanceof BufferSourceMock; });
  assert.equal(recordedSources.length, 2, "decoded samples should play through AudioBufferSourceNode");
  assert.ok(recordedSources.every(function (source) { return source.buffer && source.startTimes.length === 1; }));
}

// b) Disabled effects do not create any nodes or even need an AudioContext.
{
  let contextCount = 0;
  class CountedContext extends AudioContextMock {
    constructor() { super(); contextCount += 1; }
  }
  const sfx = loadSfx(CountedContext).Sfx;
  assert.deepEqual(Object.keys(sfx).sort(), ["combo", "hit", "miss", "reload", "setEnabled", "unlock"]);
  sfx.setEnabled(false);
  assert.equal(sfx.hit(), 0);
  assert.equal(sfx.combo(), 0);
  assert.equal(sfx.miss(), 0);
  assert.equal(sfx.reload(), 0);
  sfx.unlock();
  assert.equal(contextCount, 0);
}

// c) A successful aim hit reveals the detail card 500 ms later, with or without a combo upgrade.
function makeAimContext(comboCount) {
  const calls = [];
  const button = {
    disabled: false,
    dataset: { word: "apple" },
    classList: { add() {} }
  };
  const nodes = {
    targetGrid: { querySelectorAll() { return [button]; } },
    feedback: { textContent: "", className: "" }
  };
  const app = {
    answeredCurrent: false,
    current: { word: { word: "apple", distractors: [] }, kind: "new", retry: false },
    session: { seen: new Set(), totalAnswers: 0, correctAnswers: 0, combo: comboCount, maxCombo: comboCount, score: 0 }
  };
  let detailDelay = null;
  const context = vm.createContext({
    app,
    SRS: { recordAttempt() {} },
    $: function (id) { return nodes[id]; },
    Array,
    markSeen() {},
    markWrong() {},
    scheduleRetry() {},
    multiplier() { return app.session.combo >= 6 ? 3 : app.session.combo >= 3 ? 2 : 1; },
    applyAnswerRules(_item, correct) {
      if (!correct) app.session.combo = 0;
      else { app.session.combo += 1; app.session.maxCombo = Math.max(app.session.maxCombo, app.session.combo); }
      return false;
    },
    playSfx(name) { calls.push(name); return 0; },
    updateHud() {},
    scheduleWordDetail(_item, delay) { detailDelay = delay; }
  });
  const answerAim = vm.runInContext("(" + extractFunction(gameSource, "answerAim") + ")", context);
  answerAim("apple", button);
  return { calls, detailDelay };
}
const ordinaryHit = makeAimContext(0);
assert.deepEqual(ordinaryHit.calls, ["hit"]);
assert.equal(ordinaryHit.detailDelay, 500);
const comboHit = makeAimContext(2);
assert.deepEqual(comboHit.calls, ["hit", "combo"]);
assert.equal(comboHit.detailDelay, 500);

// d) A spelling error is corrective practice and does not call miss Sfx.
{
  const calls = [];
  let speechDelay = null;
  const nodes = {
    spellInput: { value: "appl", disabled: false, focus() {} },
    correctionPanel: { hidden: true },
    correctWord: { textContent: "" },
    submitLabel: { textContent: "" },
    feedback: { textContent: "", className: "" }
  };
  const app = {
    answeredCurrent: false,
    correctionRequired: false,
    current: { word: { word: "apple", id: "w1" } },
    session: { totalAnswers: 0, correctAnswers: 0, combo: 1, maxCombo: 1, score: 0, wrongWords: new Map() }
  };
  const context = vm.createContext({
    app,
    $: function (id) { return nodes[id]; },
    markSeen() {},
    markWrong() {},
    scheduleRetry() {},
    multiplier() { return 1; },
    applyAnswerRules(_item, correct) { if (!correct) app.session.combo = 0; return false; },
    SRS: { recordAttempt() {} },
    updateHud() {},
    playSfx(name) { calls.push(name); },
    showWordDetail(_item, delay) { speechDelay = delay; }
  });
  const submitSpelling = vm.runInNewContext("(" + extractFunction(gameSource, "submitSpelling") + ")", context);
  submitSpelling();
  assert.equal(app.correctionRequired, true);
  assert.deepEqual(calls, []);
  nodes.spellInput.value = "apple";
  submitSpelling();
  assert.deepEqual(calls, ["reload"]);
  assert.equal(speechDelay, 200);
}

// e) Speech beginning during a shot tail ducks the shot below 15% of its original gain.
{
  let audioContext;
  class ShotContext extends AudioContextMock {
    constructor() { super(); audioContext = this; }
  }
  const { Sfx, document } = loadSfx(ShotContext);
  Sfx.hit();
  const shotGain = audioContext.nodes.find(function (node) {
    return node instanceof GainMock && node.gain.events.some(function (event) { return event.value === 1; });
  });
  assert.ok(shotGain);
  const context = vm.createContext({
    window: { Event: EventMock },
    document,
    Speaker: { say(text) { return text; } }
  });
  const sayLearningAudio = vm.runInNewContext("(" + extractFunction(gameSource, "sayLearningAudio") + ")", context);
  sayLearningAudio("apple");
  const duckEvents = shotGain.gain.events.filter(function (event) { return event.kind === "set" || event.kind === "linear"; });
  assert.equal(duckEvents.at(-1).value, 0.14);
  assert.ok(duckEvents.at(-1).value < 0.15);
}

// f) A miss uses two 25 ms click transients plus the short metallic tail.
{
  let audioContext;
  class TrackingContext extends AudioContextMock {
    constructor() { super(); audioContext = this; }
  }
  const sfx = loadSfx(TrackingContext).Sfx;
  assert.equal(sfx.miss(), 140);
  const filters = audioContext.nodes.filter(function (node) { return node instanceof FilterMock; });
  const noiseSources = audioContext.nodes.filter(function (node) { return node instanceof BufferSourceMock; });
  assert.equal(filters.length, 3);
  assert.equal(noiseSources.length, 3);
  const sorted = noiseSources.slice().sort(function (a, b) { return a.startTimes[0] - b.startTimes[0]; });
  assert.ok(Math.abs((sorted[1].startTimes[0] - sorted[0].startTimes[0]) - 0.07) < 0.001);
  assert.ok(Math.abs((sorted[0].stopTimes[0] - sorted[0].startTimes[0]) - 0.029) < 0.001);
  assert.ok(Math.abs((sorted[1].stopTimes[0] - sorted[1].startTimes[0]) - 0.029) < 0.001);
  assert.deepEqual(filters.map(function (filter) { return filter.frequency.events[0].value; }), [3500, 2200, 1200]);
  assert.deepEqual(filters.map(function (filter) { return filter.Q.events[0].value; }), [8, 6, 1.5]);
}

console.log("音效模拟通过：无 Web Audio/恢复失败安全处理；素材加载失败退回合成；关闭时不建节点；命中后 500ms 讲解；单词发音时枪声压至 14%；拼写错误无卡壳声；卡壳声含两段相隔 70ms 的 25ms 带通噪声和金属尾音。");
