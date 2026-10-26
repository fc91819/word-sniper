/* Portable, checksummed progress backup codes. */
(function (root) {
  "use strict";

  const PREFIX = "WS1.";
  const FORMAT = "word-sniper-progress";
  const VERSION = 1;

  function fail(message) {
    throw new Error(message);
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function checksum(text) {
    const bytes = new TextEncoder().encode(text);
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function validateProgress(value, words) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("进度数据格式错误。");
    if (value.version !== VERSION) fail("进度数据版本不受支持。");
    if (!value.words || typeof value.words !== "object" || Array.isArray(value.words)) fail("进度数据缺少单词记录。");
    if (value.lastCompletedDate !== null && !validDate(value.lastCompletedDate)) fail("最后学习日期格式错误。");
    if (!Number.isInteger(value.streak) || value.streak < 0) fail("连续打卡天数格式错误。");

    const knownIds = new Set(words.map(function (word) { return String(word.id); }));
    const cleanWords = {};
    Object.keys(value.words).forEach(function (id) {
      const record = value.words[id];
      if (!knownIds.has(id)) fail("记录中包含词库没有的单词编号：" + id + "。");
      if (!record || typeof record !== "object" || Array.isArray(record)) fail("单词 " + id + " 的记录格式错误。");
      if (!Number.isInteger(record.box) || record.box < 1 || record.box > 5) fail("单词 " + id + " 的复习等级错误。");
      if (!validDate(record.due)) fail("单词 " + id + " 的下次复习日期错误。");
      if (!Number.isInteger(record.wrongCount) || record.wrongCount < 0) fail("单词 " + id + " 的错题次数错误。");
      if (!validDate(record.lastSeen)) fail("单词 " + id + " 的最后学习日期错误。");
      cleanWords[id] = {
        box: record.box,
        due: record.due,
        wrongCount: record.wrongCount,
        lastSeen: record.lastSeen
      };
    });

    return {
      version: VERSION,
      words: cleanWords,
      lastCompletedDate: value.lastCompletedDate,
      streak: value.streak
    };
  }

  function encode(progress) {
    const progressJson = JSON.stringify(progress);
    const envelope = {
      format: FORMAT,
      version: VERSION,
      checksum: checksum(progressJson),
      progressJson: progressJson
    };
    return PREFIX + toBase64(JSON.stringify(envelope));
  }

  function decode(code, words) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode.startsWith(PREFIX)) fail("格式错误：备份码应以 WS1. 开头。");
    const encoded = cleanCode.slice(PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("备份码含有无效字符或不完整。");

    let envelope;
    try {
      envelope = JSON.parse(fromBase64(encoded));
    } catch (_) {
      fail("备份码无法解码，请确认复制完整且没有乱码。");
    }
    if (!envelope || typeof envelope !== "object") fail("备份码内容格式错误。");
    if (envelope.format !== FORMAT) fail("这不是单词狙击手的进度备份码。");
    if (envelope.version !== VERSION) fail("备份码版本不受支持，请使用相同版本的游戏恢复。");
    if (typeof envelope.progressJson !== "string") fail("备份码缺少进度内容。");
    if (envelope.checksum !== checksum(envelope.progressJson)) fail("校验位不匹配，备份码可能被改动或复制不完整。");

    let progress;
    try {
      progress = JSON.parse(envelope.progressJson);
    } catch (_) {
      fail("进度内容不是有效 JSON。");
    }
    return validateProgress(progress, words);
  }

  root.ProgressBackup = { encode: encode, decode: decode, checksum: checksum };
})(typeof window !== "undefined" ? window : globalThis);
