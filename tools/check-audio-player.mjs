import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "audio.js"), "utf8");
const heard = [];
let activeUtterance = null;
let createdAudio = 0;
let playedAudio = 0;
let interruptedCount = 0;
const interruptedTexts = [];
let nextTimerId = 0;
const timers = new Map();

class MockUtterance {
  constructor(text) {
    this.text = text;
  }
}

class MockAudio {
  constructor() {
    createdAudio += 1;
  }
  pause() {}
  removeAttribute() {}
  load() {}
  play() {
    playedAudio += 1;
    return Promise.resolve();
  }
}

const synthesis = {
  speaking: false,
  pending: false,
  getVoices() { return [{ lang: "en-US", name: "Test English" }]; },
  addEventListener() {},
  removeEventListener() {},
  cancel() {
    const interrupted = activeUtterance;
    activeUtterance = null;
    this.speaking = false;
    this.pending = false;
    if (interrupted && interrupted.onerror) {
      interruptedCount += 1;
      interruptedTexts.push(interrupted.text);
      queueMicrotask(function () { interrupted.onerror({ error: "interrupted" }); });
    }
  },
  speak(utterance) { activeUtterance = utterance; this.speaking = true; }
};

const document = { addEventListener() {}, getElementById() { return null; } };
const window = {
  speechSynthesis: synthesis,
  SpeechSynthesisUtterance: MockUtterance,
  document,
  setTimeout(callback, delay) {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); }
};
const context = vm.createContext({ window, Audio: MockAudio, Promise, encodeURIComponent, queueMicrotask });
vm.runInContext(source, context, { filename: "audio.js" });

const flush = async function () {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise(function (resolve) { setImmediate(resolve); });
};
const fireNextTimer = function (delay) {
  const entry = Array.from(timers.entries()).find(([, timer]) => timer.delay === delay);
  assert.ok(entry, `expected a ${delay}ms timer`);
  timers.delete(entry[0]);
  entry[1].callback();
};

window.Speaker.say("apple");
await flush();
window.Speaker.say("banana");
await flush();
fireNextTimer(80);
await flush();
window.Speaker.say("cat");
await flush();
fireNextTimer(80);
await flush();

assert.equal(activeUtterance && activeUtterance.text, "cat", "only the newest utterance should remain active");
assert.equal(activeUtterance.rate, 0.9, "speech playback should use the requested rate");
activeUtterance.onend();
heard.push(activeUtterance.text);
activeUtterance = null;
synthesis.speaking = false;
assert.deepEqual(heard, ["cat"], "only cat should finish playing");
assert.equal(interruptedCount, 2, "apple and banana should each emit a simulated interrupted error");
assert.deepEqual(interruptedTexts, ["apple", "banana"], "the first two utterances should be interrupted");
assert.equal(createdAudio, 0, "speech errors must not create Youdao audio");
assert.equal(playedAudio, 0, "speech errors must not play Youdao audio");

synthesis.speaking = true;
window.Speaker.say("delayed");
await flush();
assert.equal(activeUtterance, null, "busy speech synthesis should wait before speaking");
const delayedTimer = Array.from(timers.entries()).find(([, timer]) => timer.delay === 80);
assert.ok(delayedTimer, "busy speech synthesis should schedule an 80ms delay");

window.Speaker.say("newest");
await flush();
assert.equal(activeUtterance && activeUtterance.text, "newest", "the newest request should play immediately when idle");
timers.delete(delayedTimer[0]);
delayedTimer[1].callback();
assert.equal(activeUtterance && activeUtterance.text, "newest", "stale delayed playback must be ignored");

window.Speaker.say(" ");
await flush();
const unlockTimer = Array.from(timers.entries()).find(([, timer]) => timer.delay === 80);
assert.ok(unlockTimer, "silent unlock should also wait after canceling active speech");
timers.delete(unlockTimer[0]);
unlockTimer[1].callback();
assert.equal(activeUtterance && activeUtterance.text, " ", "the unlock utterance should contain one space");
assert.equal(activeUtterance.volume, 0, "the unlock utterance should be silent");

console.log("模拟播放通过：只有 cat 完成播放；旧 interrupted 与过期延迟回调均忽略；80ms 延迟及空格静音解锁通过；未启动有道音频。");
