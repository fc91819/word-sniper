import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "game.js"), "utf8");
const marker = "  function nextQuestion() {";
const start = source.indexOf(marker);
assert.notEqual(start, -1, "nextQuestion function should exist");
const openBrace = source.indexOf("{", start);
let depth = 0;
let end = -1;
for (let index = openBrace; index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  if (source[index] === "}") {
    depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
}
assert.notEqual(end, -1, "nextQuestion function should have balanced braces");

const app = {
  index: 2,
  detailReadyAt: 0,
  detailGateTimeout: 17,
  answeredCurrent: true,
  correctionRequired: true
};
const nodes = {
  wordDetail: { hidden: true },
  skipDetail: { disabled: true }
};
let renderedIndex = null;
const context = vm.createContext({
  app,
  Date: { now() { return 1000; } },
  window: { clearTimeout() {} },
  $: function (id) { return nodes[id]; },
  Speaker: { stop() { throw new Error("simulated Speaker.stop failure"); } },
  renderQuestion() { renderedIndex = app.index; }
});
const nextQuestion = vm.runInContext("(" + source.slice(start, end) + ")", context);

assert.doesNotThrow(function () { nextQuestion(); }, "nextQuestion must survive Speaker.stop throwing");
assert.equal(app.index, 3, "question index should advance");
assert.equal(renderedIndex, 3, "the next question should render");
assert.equal(app.answeredCurrent, false);
assert.equal(app.correctionRequired, false);

console.log("切题异常模拟通过：Speaker.stop 抛错后，题号仍前进且下一题仍渲染。");
