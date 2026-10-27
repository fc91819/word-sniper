import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "audio.js"), "utf8");

function createPlayer() {
  let now = 1000;
  let nextTimerId = 0;
  const timers = new Map();
  const utterances = [];
  const audioInstances = [];
  const startedTexts = [];
  const voiceStatus = { textContent: "", dataset: {} };
  const audioTapHint = { hidden: true };
  let activeUtterance = null;
  let speakBehavior = function (utterance) {
    synthesis.speaking = true;
    utterance.onstart();
    startedTexts.push(utterance.text);
  };
  let audioPlayBehavior = function () { return Promise.resolve(); };

  class MockUtterance {
    constructor(text) { this.text = text; }
  }

  class MockAudio {
    constructor() {
      this.error = null;
      this.src = "";
      audioInstances.push(this);
    }
    pause() {}
    removeAttribute() { this.src = ""; }
    load() {}
    play() { return audioPlayBehavior(this); }
  }

  const synthesis = {
    speaking: false,
    pending: false,
    getVoices() { return [{ name: "Samantha", lang: "en-US", localService: true }]; },
    addEventListener() {},
    removeEventListener() {},
    cancel() {
      const interrupted = activeUtterance;
      activeUtterance = null;
      this.speaking = false;
      this.pending = false;
      if (interrupted && interrupted.onerror) {
        queueMicrotask(function () { interrupted.onerror({ error: "interrupted" }); });
      }
    },
    speak(utterance) {
      utterances.push(utterance);
      activeUtterance = utterance;
      speakBehavior(utterance, utterances.length - 1);
    }
  };
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (id === "voiceStatus") return voiceStatus;
      if (id === "audioTapHint") return audioTapHint;
      if (id === "nextAudioWord") return { value: "" };
      return null;
    }
  };
  const window = {
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: MockUtterance,
    document,
    console: { info() {} },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = vm.createContext({
    window, Audio: MockAudio, Promise, Date: { now() { return now; } },
    encodeURIComponent, queueMicrotask
  });
  vm.runInContext(source, context, { filename: "audio.js" });

  async function flush() {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await new Promise(function (resolve) { setImmediate(resolve); });
  }

  async function fireTimer(delay, index = 0) {
    const matches = Array.from(timers.entries()).filter(([, timer]) => timer.delay === delay);
    assert.ok(matches[index], `expected timer ${index} with delay ${delay}ms`);
    timers.delete(matches[index][0]);
    now += delay;
    matches[index][1].callback();
    await flush();
  }

  return {
    window, synthesis, timers, utterances, audioInstances, startedTexts,
    voiceStatus, audioTapHint, flush, fireTimer,
    setSpeakBehavior(value) { speakBehavior = value; },
    setAudioPlayBehavior(value) { audioPlayBehavior = value; },
    advance(milliseconds) { now += milliseconds; },
    setNow(value) { now = value; },
    get activeUtterance() { return activeUtterance; }
  };
}

// a) A missing onstart at level 1 falls to the default voice; later speech starts there.
{
  const player = createPlayer();
  player.setSpeakBehavior(function (utterance, index) {
    player.synthesis.speaking = true;
    if (index > 0) {
      utterance.onstart();
      player.startedTexts.push(utterance.text);
    }
  });
  player.window.Speaker.say("first phrase");
  await player.flush();
  assert.equal(player.utterances[0].voice.name, "Samantha");
  await player.fireTimer(1500);
  await player.fireTimer(80);
  assert.equal(player.utterances[1].voice, undefined, "fallback must leave voice unset");
  assert.equal(player.utterances[1].lang, "en-US");
  assert.equal(player.voiceStatus.textContent, "当前发音：系统默认声音（本机）");
  player.window.Speaker.say("next phrase");
  await player.flush();
  await player.fireTimer(80);
  assert.equal(player.utterances[2].voice, undefined, "later requests should start directly at level 2");
}

// b) An utterance that ends in 0.1 seconds falls to the system default.
{
  const player = createPlayer();
  player.setSpeakBehavior(function (utterance, index) {
    player.synthesis.speaking = true;
    if (index === 0) {
      player.advance(100);
      player.synthesis.speaking = false;
      utterance.onend();
      return;
    }
    utterance.onstart();
    player.startedTexts.push(utterance.text);
  });
  player.window.Speaker.say("quick end");
  await player.flush();
  assert.equal(player.utterances.length, 2);
  assert.equal(player.utterances[1].voice, undefined);
  assert.equal(player.voiceStatus.textContent, "当前发音：系统默认声音（本机）");
}

// c) Failure at both speech levels routes the original sentence through Baidu.
{
  const player = createPlayer();
  player.setSpeakBehavior(function () { player.synthesis.speaking = true; });
  player.window.Speaker.say("hello original sentence");
  await player.flush();
  await player.fireTimer(1500);
  await player.fireTimer(80);
  await player.fireTimer(1500);
  await player.flush();
  assert.equal(player.audioInstances.length, 1);
  assert.equal(player.audioInstances[0].src, "https://fanyi.baidu.com/gettts?lan=en&text=hello%20original%20sentence&spd=3&source=web");
  assert.equal(player.voiceStatus.textContent, "当前发音：百度翻译朗读（需联网）");
}

// c2) Level 3 uses Youdao for a single word and Baidu for a sentence, encoding punctuation.
{
  const player = createPlayer();
  player.window.Speaker.say("hello", { testLevel: 2, onTestResult() {} });
  await player.flush();
  assert.equal(player.audioInstances[0].src, "https://dict.youdao.com/dictvoice?audio=hello&type=2");

  player.window.Speaker.say("Hello, let's learn English.", { testLevel: 3, onTestResult() {} });
  await player.flush();
  assert.equal(player.audioInstances[1].src, "https://fanyi.baidu.com/gettts?lan=en&text=Hello%2C%20let%27s%20learn%20English.&spd=3&source=web");
}

// d) A working selected voice remains in use and never starts Youdao.
{
  const player = createPlayer();
  player.window.Speaker.say("normal phrase");
  await player.flush();
  player.activeUtterance.onstart();
  player.startedTexts.push(player.activeUtterance.text);
  assert.equal(player.utterances.length, 1);
  assert.equal(player.audioInstances.length, 0);
  assert.equal(player.voiceStatus.textContent, "当前发音：Samantha（本机）");
}

// e) A newer request supersedes an in-flight fallback; only banana starts speaking.
{
  const player = createPlayer();
  player.setSpeakBehavior(function (utterance, index) {
    player.synthesis.speaking = true;
    if (index === 1) {
      utterance.onstart();
      player.startedTexts.push(utterance.text);
    }
  });
  player.window.Speaker.say("apple");
  await player.flush();
  await player.fireTimer(1500);
  player.window.Speaker.say("banana");
  await player.flush();
  assert.equal(player.activeUtterance.text, "banana", "the newer request should start immediately at the saved fallback level");
  await player.fireTimer(80, 0); // Stale apple fallback.
  assert.deepEqual(player.startedTexts, ["banana"]);
  assert.equal(player.audioInstances.length, 0);
}

// Diagnostic direct-route checks return their result, and rejected Youdao playback prompts a tap.
{
  const player = createPlayer();
  let successfulResult = null;
  player.window.Speaker.say("Hello, let's learn English.", {
    testLevel: 1,
    onTestResult(value) { successfulResult = value; }
  });
  await player.flush();
  assert.equal(successfulResult, null, "diagnostic success should wait until the phrase finishes");
  player.advance(900);
  player.synthesis.speaking = false;
  player.activeUtterance.onend();
  await player.flush();
  assert.equal(successfulResult.type, "started");

  let result = null;
  player.window.Speaker.say("Hello, let's learn English.", {
    testLevel: 0,
    onTestResult(value) { result = value; }
  });
  await player.flush();
  player.activeUtterance.onerror({ error: "voice-unavailable" });
  await player.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { type: "error", error: "voice-unavailable" });

  player.setAudioPlayBehavior(function () { return Promise.reject(new Error("autoplay denied")); });
  result = null;
  player.window.Speaker.say("Hello, let's learn English.", {
    testLevel: 2,
    onTestResult(value) { result = value; }
  });
  await player.flush();
  assert.equal(result.type, "rejected");
  assert.equal(player.audioTapHint.hidden, false);
}

console.log("发音回退模拟通过：无 onstart、0.1 秒结束、两级失败回在线服务；单词用有道、句子用百度且标点编码正确；正常声音不换路、快速新请求淘汰旧回退；检测结果与拒绝提示通过。");
