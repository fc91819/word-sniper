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
  getVoices() { return [{ lang: "en-US", name: "Test English" }]; },
  addEventListener() {},
  removeEventListener() {},
  cancel() {
    const interrupted = activeUtterance;
    activeUtterance = null;
    if (interrupted && interrupted.onerror) {
      interruptedCount += 1;
      queueMicrotask(function () { interrupted.onerror({ error: "interrupted" }); });
    }
  },
  speak(utterance) { activeUtterance = utterance; }
};

const document = { addEventListener() {}, getElementById() { return null; } };
const window = {
  speechSynthesis: synthesis,
  SpeechSynthesisUtterance: MockUtterance,
  document,
  setTimeout() { return 1; },
  clearTimeout() {}
};
const context = vm.createContext({ window, Audio: MockAudio, Promise, encodeURIComponent, queueMicrotask });
vm.runInContext(source, context, { filename: "audio.js" });

const flush = async function () {
  await Promise.resolve();
  await Promise.resolve();
};

window.Speaker.say("apple");
await flush();
window.Speaker.say("banana");
await flush();
window.Speaker.say("cat");
await flush();

assert.equal(activeUtterance && activeUtterance.text, "cat", "only the newest utterance should remain active");
assert.equal(activeUtterance.rate, 0.9, "speech playback should use the requested rate");
activeUtterance.onend();
heard.push(activeUtterance.text);
assert.deepEqual(heard, ["cat"], "only cat should finish playing");
assert.equal(interruptedCount, 2, "apple and banana should each emit a simulated interrupted error");
assert.equal(createdAudio, 0, "speech errors must not create Youdao audio");
assert.equal(playedAudio, 0, "speech errors must not play Youdao audio");

console.log("模拟播放通过：只有 cat 完成播放；apple/banana 的 interrupted 回调已忽略；未创建或播放有道音频。");
