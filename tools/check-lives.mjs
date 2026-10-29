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

function makeRuleHarness(lives = 5) {
  const lifeAlert = { hidden: true };
  const timers = new Map();
  let nextTimer = 1;
  const app = {
    lifeAlertTimeout: null,
    session: {
      combo: 0, maxCombo: 0, score: 0, lives,
      lostAnyLife: false, reachedZero: false
    }
  };
  const context = vm.createContext({
    app,
    $: function (id) { return id === "lifeAlert" ? lifeAlert : null; },
    multiplier() { return app.session.combo >= 6 ? 3 : app.session.combo >= 3 ? 2 : 1; },
    window: {
      clearTimeout(id) { timers.delete(id); },
      setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; }
    }
  });
  vm.runInContext(extractFunction("showLifeAlert"), context);
  vm.runInContext(extractFunction("applyAnswerRules"), context);
  return { app, lifeAlert, timers, context, applyAnswerRules: context.applyAnswerRules };
}

function makeSubmitContext({ lives = 5, mode = "spell", retry = false, correctionRequired = false, typed = "wrong", combo = 0 } = {}) {
  const harness = makeRuleHarness(lives);
  const nodes = {
    spellInput: { value: typed, disabled: false, focus() {} },
    correctionPanel: { hidden: true },
    correctWord: { textContent: "" },
    submitLabel: { textContent: "" },
    feedback: { textContent: "", className: "" }
  };
  const item = { mode, retry, word: { id: "word-1", word: "apple", cn: "苹果" } };
  Object.assign(harness.app, {
    answeredCurrent: correctionRequired,
    correctionRequired,
    current: item,
    progress: {},
    date: "2026-10-28",
    session: Object.assign(harness.app.session, {
      totalAnswers: 0, correctAnswers: 0, wrongWords: new Map(), seen: new Set(),
      newWords: new Set(), combo, maxCombo: combo
    })
  });
  const calls = { sfx: [], attempts: [], retries: 0, detail: 0, hud: 0, hudArgs: [] };
  harness.context.$ = function (id) { return nodes[id] || { hidden: false, textContent: "" }; };
  harness.context.markSeen = function () {};
  harness.context.markWrong = function () {};
  harness.context.scheduleRetry = function () { calls.retries += 1; };
  harness.context.SRS = { recordAttempt(_progress, _item, correct) { calls.attempts.push(correct); } };
  harness.context.updateHud = function (animate) { calls.hud += 1; calls.hudArgs.push(animate); };
  harness.context.playSfx = function (name) { calls.sfx.push(name); };
  harness.context.showWordDetail = function () { calls.detail += 1; };
  vm.runInContext(extractFunction("submitSpelling"), harness.context);
  return { ...harness, nodes, calls, item, submitSpelling: harness.context.submitSpelling };
}

function makeAimContext({ lives = 5, retry = false, selected = "wrong", combo = 0 } = {}) {
  const harness = makeRuleHarness(lives);
  const classes = new Set();
  const correctTarget = {
    disabled: false,
    dataset: { word: "apple" },
    classList: { add(name) { classes.add(name); } }
  };
  const wrongTarget = {
    disabled: false,
    dataset: { word: "banana" },
    classList: { add(name) { classes.add(name); } }
  };
  const nodes = {
    targetGrid: { querySelectorAll() { return [correctTarget, wrongTarget]; } },
    feedback: { textContent: "", className: "" }
  };
  const item = { mode: "aim", retry, kind: "review", word: { id: "word-1", word: "apple", cn: "苹果" } };
  Object.assign(harness.app, {
    answeredCurrent: false, current: item, progress: {}, date: "2026-10-28",
    session: Object.assign(harness.app.session, {
      totalAnswers: 0, correctAnswers: 0, combo, maxCombo: combo, wrongWords: new Map(), seen: new Set(), newWords: new Set()
    })
  });
  const calls = { attempts: [], retries: 0, sfx: [], detail: null, hud: 0 };
  harness.context.$ = function (id) { return nodes[id]; };
  harness.context.Array = Array;
  harness.context.markSeen = function () {};
  harness.context.markWrong = function () {};
  harness.context.scheduleRetry = function () { calls.retries += 1; };
  harness.context.SRS = { recordAttempt(_progress, _item, correct) { calls.attempts.push(correct); } };
  harness.context.playSfx = function (name) { calls.sfx.push(name); return 0; };
  harness.context.updateHud = function () { calls.hud += 1; };
  harness.context.scheduleWordDetail = function (_item, delay) { calls.detail = delay; };
  harness.context.multiplier = function () { return harness.app.session.combo >= 6 ? 3 : harness.app.session.combo >= 3 ? 2 : 1; };
  vm.runInContext(extractFunction("answerAim"), harness.context);
  harness.context.answerAim(selected, wrongTarget);
  return { ...harness, nodes, calls, classes, item };
}

// a) All first-answer modes lose one life; retries and the spelling correction do not.
{
  const aim = makeAimContext();
  assert.equal(aim.app.session.lives, 4, "an aim miss costs one life");
  for (const mode of ["spell", "recall"]) {
    const spelling = makeSubmitContext({ mode });
    spelling.submitSpelling();
    assert.equal(spelling.app.session.lives, 4, mode + " first miss costs one life");
    assert.equal(spelling.app.session.combo, 0, mode + " first miss clears the streak");
    assert.equal(spelling.app.correctionRequired, true);
    spelling.nodes.spellInput.value = "apple";
    spelling.submitSpelling();
    assert.equal(spelling.app.session.lives, 4, "correction entry neither costs nor restores life");
  }
  const retryAim = makeAimContext({ lives: 2, retry: true, combo: 2 });
  assert.equal(retryAim.app.session.lives, 2, "retry miss does not cost life");
  assert.equal(retryAim.app.session.combo, 2, "retry miss does not alter the first-answer streak");
  assert.equal(retryAim.app.session.lostAnyLife, false, "retry miss does not mark a life loss");
  const retryHit = makeAimContext({ lives: 2, retry: true, selected: "apple", combo: 2 });
  assert.equal(retryHit.app.session.lives, 2, "retry hit does not restore life");
  assert.equal(retryHit.app.session.combo, 2, "retry hit does not count toward the first-answer streak");
  const retrySpell = makeSubmitContext({ lives: 2, mode: "recall", retry: true, combo: 2 });
  retrySpell.submitSpelling();
  assert.equal(retrySpell.app.session.lives, 2, "spelling retry miss does not cost life");
  assert.equal(retrySpell.app.session.combo, 2, "spelling retry miss does not reset the first-answer streak");
}

// b) Three consecutive first-answer hits restore one life; full health caps at five.
{
  const h = makeRuleHarness(2);
  for (let index = 0; index < 3; index += 1) h.applyAnswerRules({ retry: false }, true);
  assert.equal(h.app.session.lives, 3);
  assert.equal(h.app.session.combo, 3);
  for (let index = 0; index < 9; index += 1) h.applyAnswerRules({ retry: false }, true);
  assert.equal(h.app.session.lives, 5, "healing must cap at five lives");
  const full = makeRuleHarness(5);
  for (let index = 0; index < 12; index += 1) full.applyAnswerRules({ retry: false }, true);
  assert.equal(full.app.session.lives, 5, "a full-health streak cannot exceed five lives");
  const healedSpell = makeSubmitContext({ lives: 2, mode: "spell", typed: "apple", combo: 2 });
  healedSpell.submitSpelling();
  assert.equal(healedSpell.app.session.lives, 3);
  assert.equal(healedSpell.nodes.feedback.textContent, "连对 3 题，回血 +1");
  assert.equal(healedSpell.calls.hudArgs.at(-1), true, "the restored heart is marked for animation");
}

// c) A first-answer miss resets the streak; another three hits are required to heal.
{
  const h = makeRuleHarness(3);
  h.applyAnswerRules({ retry: false }, true);
  h.applyAnswerRules({ retry: false }, true);
  h.applyAnswerRules({ retry: false }, false);
  assert.equal(h.app.session.combo, 0);
  assert.equal(h.app.session.lives, 2);
  h.applyAnswerRules({ retry: false }, true);
  h.applyAnswerRules({ retry: false }, true);
  assert.equal(h.app.session.lives, 2);
  h.applyAnswerRules({ retry: false }, true);
  assert.equal(h.app.session.lives, 3);
}

// d) Zero lives is non-terminal, remains clamped at zero, and the alert appears only once.
{
  const h = makeRuleHarness(1);
  h.applyAnswerRules({ retry: false }, false);
  assert.equal(h.app.session.lives, 0);
  assert.equal(h.app.session.reachedZero, true);
  assert.equal(h.lifeAlert.hidden, false);
  assert.equal([...h.timers.values()][0].delay, 2500);
  assert.doesNotThrow(function () { h.applyAnswerRules({ retry: false }, false); });
  assert.equal(h.app.session.lives, 0, "lives stay at zero after more misses");
  assert.equal(h.timers.size, 1, "the zero-life alert does not restart for every miss");
  h.applyAnswerRules({ retry: false }, true);
  h.applyAnswerRules({ retry: false }, true);
  h.applyAnswerRules({ retry: false }, true);
  assert.equal(h.app.session.lives, 1, "the player can continue and heal after reaching zero");
}

function runFinishSession({ accuracy, lives, lostAnyLife, reachedZero }) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, textContent: "", innerHTML: "", children: [],
      appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); }
    });
    return nodes.get(id);
  }
  const app = {
    detailRevealTimeout: null, detailGateTimeout: null, detailSpeechTimeout: null, lifeAlertTimeout: null,
    progress: {}, date: "2026-10-28",
    session: {
      totalAnswers: 10, correctAnswers: accuracy, maxCombo: 4, newWords: new Set(["w1"]), lives,
      lostAnyLife, reachedZero, wrongWords: new Map()
    }
  };
  const context = vm.createContext({
    app,
    Speaker: { stop() {} },
    window: { clearTimeout() {} },
    SRS: { completeSession() {}, saveProgress() {} },
    $: node,
    document: { createElement() { return { textContent: "", children: [], append(...children) { this.children.push(...children); } }; } },
    Array,
    updateHome() {},
    setScreen() {}
  });
  vm.runInContext(extractFunction("finishSession"), context);
  context.finishSession();
  return nodes;
}

// d/e/f) Results show zero-life status and full-health badges; rating uses accuracy only.
{
  const zeroLifeResult = runFinishSession({ accuracy: 8, lives: 0, lostAnyLife: true, reachedZero: true });
  assert.equal(zeroLifeResult.get("resultSubhead").textContent, "本局评价 B · 按命中率计分");
  assert.equal(zeroLifeResult.get("deathNotice").hidden, false);
  assert.match(htmlSource, /本局曾经阵亡，明天争取满血！/);

  const fullHealthResult = runFinishSession({ accuracy: 10, lives: 5, lostAnyLife: false, reachedZero: false });
  assert.equal(fullHealthResult.get("fullHealthBadge").hidden, false);
  assert.equal(fullHealthResult.get("deathNotice").hidden, true);

  const healedButLostResult = runFinishSession({ accuracy: 8, lives: 5, lostAnyLife: true, reachedZero: false });
  assert.equal(healedButLostResult.get("fullHealthBadge").hidden, true, "healing does not erase an earlier life loss");
  assert.equal(healedButLostResult.get("resultSubhead").textContent, "本局评价 B · 按命中率计分", "80% is B regardless of remaining lives");
}

console.log("血量规则模拟通过：打靶/拼写/默写首答错误扣血，retry 与纠错不扣血，连对回血封顶，归零可继续，结算徽章和命中率评价正确。");
