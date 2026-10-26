import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "words.js"), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "words.js" });
const words = sandbox.WORDS;
const issues = [];
const requiredFields = ["id", "word", "phonetic", "pos", "cn", "topic", "example", "exampleCn", "distractors"];
const meaningParts = (text) => String(text).split(/[；;，、,]|或|和|及|与/g).map((part) => part.trim()).filter(Boolean);
const blockedMeaningPairs = new Set([
  "actor|actress", "celebrate|celebration", "cloud|cloudy", "health|healthy",
  "doctor|dentist", "cold|flu", "cold|sick", "free|holiday", "important|special",
  "road|street", "rest|holiday", "work|job", "boat|ship", "lesson|class",
  "sick|ill", "meat|beef", "parent|mother", "exam|test", "mom|mother",
  "dad|father", "big|important", "do|make", "holiday|festival", "match|race"
]);
const inflectedDistractors = new Set(["won", "does", "goes"]);
const pairKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");

if (!Array.isArray(words)) {
  issues.push("WORDS must be an array.");
} else {
  const byWord = new Map(words.map((item) => [String(item.word || "").toLowerCase(), item]));
  if (words.length !== 200) issues.push("expected 200 words; found " + words.length);
  for (const item of words) {
    for (const field of requiredFields) {
      if (item[field] == null || item[field] === "" || (field === "distractors" && !Array.isArray(item[field]))) {
        issues.push((item.word || "(unknown)") + ": missing or invalid field " + field);
      }
    }
    if (typeof item.word !== "string" || !item.word) continue;
    if (!Array.isArray(item.distractors)) continue;
    if (item.distractors.length !== 3) issues.push(item.word + ": expected 3 distractors; found " + item.distractors.length);
    const seen = new Set();
    for (const distractor of item.distractors) {
      if (typeof distractor !== "string" || !distractor) {
        issues.push(item.word + ": distractor must be a non-empty string");
        continue;
      }
      const normalized = distractor.toLowerCase();
      if (seen.has(normalized)) issues.push(item.word + ": duplicate distractor " + distractor);
      seen.add(normalized);
      if (/\s/.test(distractor)) issues.push(item.word + ": distractor contains whitespace: " + distractor);
      if (distractor !== normalized || !/^[a-z]+$/.test(distractor)) issues.push(item.word + ": distractor must be lowercase English letters: " + distractor);

      const match = byWord.get(normalized);
      if (!match) {
        issues.push(item.word + ": distractor is outside the 200-word bank: " + distractor);
      } else {
        if (match.word !== distractor) issues.push(item.word + ": distractor is a proper name: " + distractor);
        if (inflectedDistractors.has(normalized)) issues.push(item.word + ": distractor is an inflected form: " + distractor);
        const overlap = meaningParts(item.cn).some((left) => meaningParts(match.cn).some((right) => left.includes(right) || right.includes(left)));
        if (overlap) issues.push(item.word + " (" + item.cn + ") / " + match.word + " (" + match.cn + "): Chinese meanings overlap");
        if (blockedMeaningPairs.has(pairKey(item.word, match.word))) issues.push(item.word + " / " + match.word + ": known synonym or overlapping pair");
      }
    }
    if (typeof item.example === "string" && !item.example.toLowerCase().includes(item.word.toLowerCase())) {
      issues.push(item.word + ": example does not contain the target word");
    }
  }
}

if (issues.length) {
  console.error("词库校验失败：" + issues.length + " 个问题。");
  for (const issue of issues) console.error("- " + issue);
  process.exitCode = 1;
} else {
  const distractorCount = words.reduce((count, item) => count + item.distractors.length, 0);
  console.log("词库校验通过：" + words.length + " 个词，" + distractorCount + " 个干扰词，0 个问题。");
}
