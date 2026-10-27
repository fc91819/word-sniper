import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "audio.js"), "utf8");

async function selectVoice(voices) {
  const utterances = [];
  const audioSources = [];
  const logLines = [];
  const timers = new Map();
  let nextTimerId = 0;
  const voiceStatus = { textContent: "" };

  class MockUtterance {
    constructor(text) { this.text = text; }
  }

  class MockAudio {
    set src(value) { audioSources.push(value); }
    pause() {}
    removeAttribute() {}
    load() {}
    play() { return Promise.resolve(); }
  }

  const synthesis = {
    speaking: false,
    pending: false,
    getVoices() { return voices; },
    addEventListener() {},
    removeEventListener() {},
    cancel() { this.speaking = false; this.pending = false; },
    speak(utterance) { utterances.push(utterance); }
  };
  const document = {
    addEventListener() {},
    getElementById(id) { return id === "voiceStatus" ? voiceStatus : null; }
  };
  const window = {
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: MockUtterance,
    document,
    console: { info(message) { logLines.push(message); } },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = vm.createContext({ window, Audio: MockAudio, Promise, encodeURIComponent });
  vm.runInContext(source, context, { filename: "audio.js" });

  window.Speaker.say("sample");
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  const voiceWait = Array.from(timers.entries()).find(([, timer]) => timer.delay === 1500);
  if (voiceWait) {
    timers.delete(voiceWait[0]);
    voiceWait[1].callback();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  return {
    voice: utterances.at(-1)?.voice || null,
    audioCount: audioSources.length,
    status: voiceStatus.textContent,
    logLines
  };
}

const voice = function (name, lang = "en-US", isDefault = false) {
  return { name, lang, default: isDefault };
};

const cases = [
  {
    label: "a",
    voices: [voice("Albert"), voice("Bad News"), voice("Bells"), voice("Samantha"), voice("Aaron")],
    expected: "Samantha"
  },
  {
    label: "b",
    voices: [voice("Albert"), voice("Bubbles"), voice("Aaron"), voice("Fred")],
    expected: "Aaron"
  },
  {
    label: "c",
    voices: [voice("Bells"), voice("Boing"), voice("Zarvox"), voice("Daniel", "en-GB")],
    expected: "Daniel"
  },
  {
    label: "d",
    voices: [voice("Samantha"), voice("Samantha (Enhanced)")],
    expected: "Samantha (Enhanced)"
  }
];

const selected = [];
for (const testCase of cases) {
  const result = await selectVoice(testCase.voices);
  assert.equal(result.voice && result.voice.name, testCase.expected, `case ${testCase.label} voice`);
  assert.equal(result.audioCount, 0, `case ${testCase.label} should use speech synthesis`);
  assert.ok(result.logLines.includes(`单词狙击手发音：${testCase.expected} ${result.voice.lang}`));
  selected.push(testCase.expected);
}

const blacklistOnly = await selectVoice([voice("Albert"), voice("Bad News"), voice("Pipe Organ")]);
assert.equal(blacklistOnly.voice, null, "blacklisted voices must not be selected");
assert.equal(blacklistOnly.audioCount, 1, "blacklist-only list must use Youdao");
assert.equal(blacklistOnly.status, "当前发音：有道词典");
selected.push("有道");

console.log("语音选择通过：" + selected.map(function (name, index) { return String.fromCharCode(97 + index) + ") " + name; }).join("；"));
