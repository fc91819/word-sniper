import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gameSource = await readFile(join(projectRoot, "game.js"), "utf8");
const htmlSource = await readFile(join(projectRoot, "index.html"), "utf8");

function extractFunction(name) {
  const start = gameSource.indexOf("  function " + name + "(");
  assert.notEqual(start, -1, name + " should exist");
  const openBrace = gameSource.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < gameSource.length; index += 1) {
    if (gameSource[index] === "{") depth += 1;
    if (gameSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return gameSource.slice(start, index + 1);
    }
  }
  assert.fail(name + " should have balanced braces");
}

function wordRecord(id, word, mode, box) {
  return { word: { id, word, cn: id, distractors: ["bread", "train", "water"], phonetic: "/test/", pos: "n.", topic: "测试", example: "Test example.", exampleCn: "测试例句。" }, mode, box };
}

function makeNodes() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, textContent: "", innerHTML: "", className: "", value: "", disabled: false,
      placeholder: "", onclick: null, onkeydown: null, style: {}, dataset: {}, children: [],
      setAttribute() {}, focus() {}, appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); }, select() {},
      querySelectorAll() { return this.children; }
    });
    return nodes.get(id);
  }
  return { nodes, node };
}

function makeContext(session, options = {}) {
  const { nodes, node } = makeNodes();
  const timers = new Map();
  let timerId = 0;
  const progress = options.progress || { version: 1, words: {}, lastCompletedDate: null, streak: 0 };
  const calls = { sfx: [], details: [], scheduledDetails: [], records: 0, completed: 0, saved: 0, screens: [] };
  const app = Object.assign({
    session, progress, date: "2026-11-07", queue: session.bossQueue || [], index: 0,
    current: null, answeredCurrent: false, correctionRequired: false,
    detailRevealTimeout: null, detailGateTimeout: null, detailSpeechTimeout: null,
    lifeAlertTimeout: null, bossTransitionTimeout: null, bossSfxTimeout: null
  }, options.app || {});
  const context = vm.createContext({
    app,
    $: node,
    window: {
      clearTimeout(id) { timers.delete(id); },
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }
    },
    Speaker: { stop() {} },
    Sfx: {
      hit() { calls.sfx.push("hit"); return 100; },
      combo() { calls.sfx.push("combo"); return 160; },
      miss() { calls.sfx.push("miss"); return 100; }
    },
    SRS: {
      completeSession() { calls.completed += 1; },
      saveProgress(value) { calls.saved += 1; options.storage && (options.storage.value = JSON.stringify(value)); },
      recordAttempt() { calls.records += 1; throw new Error("Boss answers must not record SRS attempts"); }
    },
    document: {
      createElement(tag) {
        return { tagName: tag, textContent: "", className: "", dataset: {}, children: [],
          addEventListener() {}, querySelector() { return { textContent: "" }; },
          append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); } };
      },
      dispatchEvent() { return true; }
    },
    Event: function Event(type) { this.type = type; },
    Array,
    Number,
    Math,
    setScreen(name) { calls.screens.push(name); },
    updateHome() {},
    updateHud() {},
    renderBossHud() {
      node("bossHealthLabel").textContent = app.session.bossQueue.length + " / " + app.session.bossTotal;
      node("bossHud").hidden = false;
    },
    playSfx(name) { calls.sfx.push(name); return name === "hit" ? 100 : name === "combo" ? 160 : 100; },
    showWordDetail(item, delay) { calls.details.push({ id: item.word.id, delay }); },
    shuffle(list) { return list.slice(); },
    renderKeyboard() {},
    sayLearningAudio() {},
    renderQuestion() {},
    markSeen() {},
    markWrong() {},
    scheduleWordDetail(item, delay) { calls.scheduledDetails.push({ id: item.word.id, delay }); },
    multiplier() { return app.session.combo >= 6 ? 3 : app.session.combo >= 3 ? 2 : 1; },
    calls,
    timers,
    nodes,
    node
  });
  for (const name of [
    "createBossQueue", "bossQuestionProfile", "rotateBossQueue", "renderBossHud",
    "beginBossBattle", "showBossVictory", "resolveBossAnswer", "abortBossBattle",
    "finishSession", "configureMode", "renderTargets", "renderSpelling", "submitSpelling"
  ]) vm.runInContext(extractFunction(name), context);
  return { context, app, nodes, node, timers, calls, progress, storage: options.storage };
}

function bossSession(queue, overrides = {}) {
  return Object.assign({
    totalAnswers: 10, correctAnswers: 8, combo: 4, maxCombo: 6, score: 120,
    lives: 3, lostAnyLife: true, reachedZero: false,
    phase: "boss", bossQueue: queue, bossTotal: queue.length,
    bossDefeated: false, bossAborted: false, noBoss: false, completed: false,
    wrongWords: new Map(queue.map(function (item) { return [item.word.id, { word: item.word, mode: item.mode, box: item.box }]; })),
    newWords: new Set(["new1"])
  }, overrides);
}

function runTimer(harness, delay) {
  const found = Array.from(harness.timers.entries()).find(function (entry) { return entry[1].delay === delay; });
  assert.ok(found, "expected a scheduled timer with delay " + delay);
  harness.timers.delete(found[0]);
  found[1].callback();
}

// a) Three first-round errors create three Boss cells; clearing them completes the Boss.
{
  const sourceMap = new Map([
    ["aim", wordRecord("aim", "apple", "aim", 1)],
    ["spell", wordRecord("spell", "school", "spell", 3)],
    ["recall", wordRecord("recall", "weather", "recall", 5)]
  ]);
  const session = { bossQueue: [], phase: "round", wrongWords: sourceMap };
  const harness = makeContext(session);
  harness.context.beginBossBattle();
  assert.equal(session.phase, "boss-intro");
  assert.equal(session.bossQueue.length, 3);
  assert.equal(harness.nodes.get("bossTransition").textContent, "⚠ BOSS 出现！击败 3 个错词");
  runTimer(harness, 1500);
  assert.equal(session.phase, "boss");
  const queue = session.bossQueue;
  assert.equal(queue.length, 3);
  assert.deepEqual(Array.from(queue, function (item) { return item.mode; }), ["aim", "spell", "recall"]);
  assert.ok(queue.every(function (item) { return item.boss && item.bossWrongCount === 0; }));
  session.totalAnswers = 10;
  session.correctAnswers = 8;
  session.combo = 4;
  session.maxCombo = 6;
  session.score = 120;
  session.lives = 3;
  session.lostAnyLife = true;
  session.reachedZero = false;
  session.completed = false;
  session.bossDefeated = false;
  session.bossAborted = false;
  session.wrongWords = sourceMap;
  session.newWords = new Set(["new1"]);
  for (const item of queue.slice()) harness.context.resolveBossAnswer(item, true);
  assert.equal(session.bossQueue.length, 0);
  assert.equal(session.bossDefeated, true);
  assert.equal(session.completed, true);
  assert.deepEqual(harness.calls.sfx, ["hit", "hit", "hit"]);
  assert.deepEqual(harness.calls.scheduledDetails, [{ id: "aim", delay: 500 }, { id: "spell", delay: 500 }], "non-final Boss hits wait for hit audio before details");
  runTimer(harness, 100);
  runTimer(harness, 1500);
  assert.equal(harness.nodes.get("sessionOutcome").textContent, "通关 · BOSS 已击败");
  assert.deepEqual(harness.calls.sfx, ["hit", "hit", "hit", "combo"]);
  assert.equal(harness.nodes.get("accuracyResult").textContent, "80%", "Boss answers do not change first-round accuracy");
  assert.equal(harness.calls.completed, 1, "defeating the Boss completes the daily session");
}

// b/d/f) A Boss miss rotates to the tail without changing its health, SRS progress, player life, combo, or first-round accuracy.
{
  const queue = [
    Object.assign(wordRecord("a", "apple", "aim", 1), { boss: true, bossWrongCount: 0 }),
    Object.assign(wordRecord("b", "bread", "spell", 3), { boss: true, bossWrongCount: 0 }),
    Object.assign(wordRecord("c", "cloud", "recall", 5), { boss: true, bossWrongCount: 0 })
  ];
  const progress = { version: 1, words: { a: { box: 1, due: "2026-11-08", wrongCount: 1, lastSeen: "2026-11-07" } }, streak: 4, lastCompletedDate: "2026-11-06" };
  const beforeProgress = JSON.stringify(progress);
  const storage = { value: beforeProgress };
  const session = bossSession(queue);
  const before = { lives: session.lives, combo: session.combo, total: session.totalAnswers, correct: session.correctAnswers };
  const harness = makeContext(session, { progress, storage });
  harness.context.resolveBossAnswer(queue[0], false);
  assert.deepEqual(Array.from(session.bossQueue, function (item) { return item.word.id; }), ["b", "c", "a"]);
  assert.equal(queue[0].bossWrongCount, 0);
  assert.equal(queue[2].bossWrongCount, 1);
  assert.equal(harness.nodes.get("bossHealthLabel").textContent, "3 / 3");
  assert.deepEqual({ lives: session.lives, combo: session.combo, total: session.totalAnswers, correct: session.correctAnswers }, before);
  assert.equal(JSON.stringify(progress), beforeProgress);
  assert.equal(storage.value, beforeProgress, "Boss answers do not write localStorage progress");
  assert.equal(harness.calls.records, 0);
  assert.deepEqual(harness.calls.details, []);
  assert.deepEqual(harness.calls.scheduledDetails, [{ id: "a", delay: 1500 }], "an aim miss keeps its answer highlight before the detail card");

  harness.context.resolveBossAnswer(session.bossQueue[0], true);
  assert.equal(session.bossQueue.length, 2);
  assert.deepEqual(harness.calls.scheduledDetails.slice(-1), [{ id: "b", delay: 500 }]);
  assert.deepEqual({ lives: session.lives, combo: session.combo, total: session.totalAnswers, correct: session.correctAnswers }, before);
  assert.equal(JSON.stringify(progress), beforeProgress);
  assert.equal(storage.value, beforeProgress, "Boss answers do not write localStorage progress");
}

// c) Two misses lower difficulty; the third miss reveals the answer for the next turn.
{
  const profile = (mode, bossWrongCount) => {
    const item = Object.assign(wordRecord("w", "apple", mode, 3), { boss: true, bossWrongCount });
    return { item, value: makeContext({}).context.bossQuestionProfile(item) };
  };
  assert.equal(profile("aim", 1).value.targetCount, 4);
  assert.equal(profile("aim", 2).value.targetCount, 2);
  assert.equal(profile("aim", 3).value.targetCount, 1);
  assert.equal(profile("spell", 2).value.spellHint, "A _ _ _ _");
  assert.equal(profile("spell", 3).value.direct, true);
  assert.equal(profile("recall", 2).value.mode, "spell");
  assert.equal(profile("recall", 2).value.spellHint, "首字母：A　·　字母数：5");

  const persistent = Object.assign(wordRecord("persistent", "apple", "aim", 1), { boss: true, bossWrongCount: 0 });
  const persistentSession = bossSession([persistent]);
  const persistentHarness = makeContext(persistentSession);
  persistentHarness.context.resolveBossAnswer(persistent, false);
  assert.equal(persistent.bossWrongCount, 1);
  persistentHarness.context.resolveBossAnswer(persistent, false);
  assert.equal(persistent.bossWrongCount, 2);
  assert.equal(persistentHarness.context.bossQuestionProfile(persistent).targetCount, 2);
  persistentHarness.context.resolveBossAnswer(persistent, false);
  assert.equal(persistent.bossWrongCount, 3);
  assert.equal(persistentHarness.context.bossQuestionProfile(persistent).direct, true);

  const targetItem = Object.assign(wordRecord("aim", "apple", "aim", 1), { boss: true, bossWrongCount: 2 });
  const targetHarness = makeContext(bossSession([targetItem]));
  targetHarness.context.renderTargets(targetItem);
  assert.equal(targetHarness.nodes.get("targetGrid").children.length, 2, "after two Boss misses an aim prompt has two targets");
  const directTarget = Object.assign(wordRecord("aim", "apple", "aim", 1), { boss: true, bossWrongCount: 3 });
  const directTargetHarness = makeContext(bossSession([directTarget]));
  directTargetHarness.context.renderTargets(directTarget);
  assert.equal(directTargetHarness.nodes.get("targetGrid").children.length, 1, "after three Boss misses an aim prompt reveals only the answer target");

  const configureHarness = makeContext(bossSession([Object.assign(wordRecord("recall", "apple", "recall", 5), { boss: true, bossWrongCount: 2 })]));
  let renderedRecall = null;
  configureHarness.context.renderSpelling = function (_item, recall) { renderedRecall = recall; };
  configureHarness.context.configureMode(configureHarness.app.session.bossQueue[0]);
  assert.equal(renderedRecall, false, "a weakened recall Boss item uses spelling mode");
  assert.equal(configureHarness.nodes.get("modeTitle").textContent, "默写 · 提示拼写");

  const spellNodes = makeNodes();
  const spellContext = vm.createContext({
    app: { correctionRequired: false },
    $: spellNodes.node,
    bossQuestionProfile: makeContext(bossSession([])).context.bossQuestionProfile,
    renderKeyboard() {}, sayLearningAudio() {}, submitSpelling() {}
  });
  vm.runInContext(extractFunction("renderSpelling"), spellContext);
  const weakenedSpell = Object.assign(wordRecord("spell", "apple", "spell", 3), { boss: true, bossWrongCount: 2 });
  spellContext.renderSpelling(weakenedSpell, false);
  assert.equal(spellNodes.node("spellHint").textContent, "A _ _ _ _");
  assert.equal(spellNodes.node("spellHint").hidden, false);
  const directSpell = Object.assign(wordRecord("spell", "apple", "spell", 3), { boss: true, bossWrongCount: 3 });
  spellContext.renderSpelling(directSpell, false);
  assert.equal(spellNodes.node("correctionPanel").hidden, false);
  assert.equal(spellNodes.node("correctWord").textContent, "apple");
}

// e) A clean first round skips the Boss and finishes as a perfect clear.
{
  const session = bossSession([] , { phase: "round", wrongWords: new Map(), bossQueue: [], bossTotal: 0, lives: 5, lostAnyLife: false, completed: false });
  const harness = makeContext(session);
  harness.context.beginBossBattle();
  assert.equal(session.noBoss, true);
  assert.equal(session.completed, true);
  assert.equal(harness.nodes.get("sessionOutcome").textContent, "无 Boss，完美通关");
  assert.equal(harness.calls.completed, 1);
}

// g) Ending mid-Boss shows incomplete and preserves first-round progress without completing the day.
{
  const queue = [Object.assign(wordRecord("a", "apple", "aim", 1), { boss: true, bossWrongCount: 1 })];
  const progress = { version: 1, words: { a: { box: 1, due: "2026-11-08", wrongCount: 1, lastSeen: "2026-11-07" } }, streak: 4, lastCompletedDate: "2026-11-06" };
  const storage = { value: JSON.stringify(progress) };
  const session = bossSession(queue, { bossAborted: false, completed: false });
  const harness = makeContext(session, { progress, storage });
  harness.context.abortBossBattle();
  assert.equal(harness.nodes.get("sessionOutcome").textContent, "未通关");
  assert.match(harness.nodes.get("resultEyebrow").textContent, /MISSION INCOMPLETE/);
  assert.equal(harness.calls.completed, 0, "an interrupted Boss does not complete the daily session");
  assert.equal(harness.calls.saved, 1);
  assert.equal(storage.value, JSON.stringify(progress), "the interrupted Boss leaves first-round progress unchanged");
}

// UI copy for the transition, victory, and remaining game rules stays present in the page.
assert.match(htmlSource, /BOSS/);
assert.match(gameSource, /BOSS 出现！击败 /);
assert.match(gameSource, /BOSS 已击败！/);
assert.match(gameSource, /通关 · BOSS 已击败/);
assert.match(gameSource, /无 Boss，完美通关/);
assert.match(gameSource, /未通关/);

console.log("Boss 战模拟通过：错词队列循环与血条、原题型保留和三档降难、Boss 不改进度/玩家生命/首轮命中率、无 Boss 完美通关及中途退出状态正确。");
