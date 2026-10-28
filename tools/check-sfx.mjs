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
  createBuffer(channels, frames) {
    return { getChannelData() { return new Float32Array(frames); } };
  }
  resume() { return this._resume(); }
}

function loadSfx(AudioContextType) {
  const window = {};
  if (AudioContextType) window.AudioContext = AudioContextType;
  vm.runInNewContext(sfxSource, { window, Math }, { filename: "sfx.js" });
  return window.Sfx;
}

// a) Missing Web Audio and a rejected resume must never escape Sfx.
{
  const noAudio = loadSfx(null);
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
  const rejected = loadSfx(RejectedResumeContext);
  assert.doesNotThrow(function () { rejected.unlock(); });
  for (const name of ["hit", "combo", "miss", "reload"]) assert.doesNotThrow(function () { rejected[name](); });
  await Promise.resolve();
  assert.ok(rejectedContext);
}

// b) Disabled Sfx methods do not create any nodes or even need an AudioContext.
{
  let contextCount = 0;
  class CountedContext extends AudioContextMock {
    constructor() { super(); contextCount += 1; }
  }
  const sfx = loadSfx(CountedContext);
  assert.deepEqual(Object.keys(sfx).sort(), ["combo", "hit", "miss", "reload", "setEnabled", "unlock"]);
  sfx.setEnabled(false);
  assert.equal(sfx.hit(), 0);
  assert.equal(sfx.combo(), 0);
  assert.equal(sfx.miss(), 0);
  assert.equal(sfx.reload(), 0);
  sfx.unlock();
  assert.equal(contextCount, 0);
}

// c) Aim hit detail delay includes sound duration + 200 ms, with a 420 ms floor.
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
    updateCombo(correct) {
      if (!correct) app.session.combo = 0;
      else { app.session.combo += 1; app.session.maxCombo = Math.max(app.session.maxCombo, app.session.combo); }
    },
    playSfx(name) { calls.push(name); return name === "hit" ? 120 : name === "combo" ? 160 : 0; },
    updateHud() {},
    scheduleWordDetail(_item, delay) { detailDelay = delay; }
  });
  const answerAim = vm.runInContext("(" + extractFunction(gameSource, "answerAim") + ")", context);
  answerAim("apple", button);
  return { calls, detailDelay };
}
const ordinaryHit = makeAimContext(0);
assert.deepEqual(ordinaryHit.calls, ["hit"]);
assert.equal(ordinaryHit.detailDelay, 420);
const comboHit = makeAimContext(2);
assert.deepEqual(comboHit.calls, ["hit", "combo"]);
assert.equal(comboHit.detailDelay, 480);

// d) A first spelling error is a correction exercise and does not call miss Sfx.
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
    updateCombo(correct) { if (!correct) app.session.combo = 0; },
    SRS: { recordAttempt() {} },
    updateHud() {},
    playSfx(name) { calls.push(name); },
    showWordDetail(_item, delay) { speechDelay = delay; }
  });
  const submitSpelling = vm.runInContext("(" + extractFunction(gameSource, "submitSpelling") + ")", context);
  submitSpelling();
  assert.equal(app.correctionRequired, true);
  assert.deepEqual(calls, []);
  nodes.spellInput.value = "apple";
  submitSpelling();
  assert.deepEqual(calls, ["reload"]);
  assert.equal(speechDelay, 200);
}

// e) Miss creates two filtered noise clicks whose starts are separated by 70 ms.
{
  let audioContext;
  class TrackingContext extends AudioContextMock {
    constructor() { super(); audioContext = this; }
  }
  const sfx = loadSfx(TrackingContext);
  assert.equal(sfx.miss(), 110);
  const filters = audioContext.nodes.filter(function (node) { return node instanceof FilterMock; });
  const noiseSources = audioContext.nodes.filter(function (node) { return node instanceof BufferSourceMock; });
  assert.equal(filters.length, 2);
  assert.equal(noiseSources.length, 2);
  const starts = noiseSources.map(function (node) { return node.startTimes[0]; }).sort(function (a, b) { return a - b; });
  assert.ok(Math.abs((starts[1] - starts[0]) - 0.07) < 0.001);
  assert.deepEqual(filters.map(function (filter) { return filter.frequency.events[0].value; }), [3500, 2200]);
  assert.deepEqual(filters.map(function (filter) { return filter.Q.events[0].value; }), [8, 6]);
}

console.log("音效模拟通过：缺少 AudioContext/恢复被拒绝安全处理；关闭时不创建节点；命中讲解延迟 420/480ms；拼写错误无 miss；卡壳声为两段相隔 70ms 的带通噪声。");
