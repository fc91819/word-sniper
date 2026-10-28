import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [workerSource, versionSource, gameSource] = await Promise.all([
  readFile(join(projectRoot, "service-worker.js"), "utf8"),
  readFile(join(projectRoot, "version.js"), "utf8"),
  readFile(join(projectRoot, "game.js"), "utf8")
]);

const scope = "https://sniper.test/word-sniper/";
const appFilesMatch = workerSource.match(/const APP_FILES = (\[[\s\S]*?\]);/);
assert.ok(appFilesMatch, "service worker should declare its app file list");
const appFiles = vm.runInNewContext(appFilesMatch[1]);
const cacheData = new Map([
  ["sniper-v5", new Map([
    ["/word-sniper/index.html", "v5 index"],
    ["/word-sniper/game.js", "v5 game"]
  ])],
  ["sniper-v9", new Map([
    ["/word-sniper/index.html", "v9 index"],
    ["/word-sniper/game.js", "v9 game"],
    ["/word-sniper/style.css", "v9 style"]
  ])]
]);
for (const file of appFiles) {
  const path = new URL(file, scope).pathname;
  cacheData.get("sniper-v5").set(path, "v5 " + file);
  cacheData.get("sniper-v9").set(path, "v9 " + file);
}
const cacheMatchCalls = [];
let globalCacheMatchCalls = 0;
let networkCalls = 0;
let networkOffline = false;
let skipWaitingCalls = 0;
let claimCalls = 0;
let oldCacheDeletes = 0;
const handlers = {};

const cacheApi = {
  async open(name) {
    if (!cacheData.has(name)) cacheData.set(name, new Map());
    const data = cacheData.get(name);
    return {
      async addAll() {},
      async match(request, options) {
        cacheMatchCalls.push({ name, options });
        const url = new URL(typeof request === "string" ? request : request.url);
        return data.get(url.pathname + (options && options.ignoreSearch ? "" : url.search));
      },
      async put() { throw new Error("runtime cache.put must not be used"); }
    };
  },
  async keys() { return Array.from(cacheData.keys()); },
  async delete(name) {
    if (name === "sniper-v5") oldCacheDeletes += 1;
    return cacheData.delete(name);
  },
  async match() {
    globalCacheMatchCalls += 1;
    throw new Error("global caches.match must not be used");
  }
};

const self = {
  location: { origin: "https://sniper.test" },
  registration: { scope },
  clients: { async claim() { claimCalls += 1; } },
  addEventListener(name, callback) { handlers[name] = callback; },
  async skipWaiting() { skipWaitingCalls += 1; }
};
const context = vm.createContext({
  self,
  caches: cacheApi,
  URL,
  Response,
  fetch: async function (request) {
    if (networkOffline) throw new Error("simulated offline network");
    networkCalls += 1;
    if (typeof request === "string") return "network " + new URL(request).pathname;
    return "network " + new URL(request.url).pathname;
  },
  importScripts() {}
});
vm.runInContext(versionSource, context, { filename: "version.js" });
vm.runInContext(workerSource, context, { filename: "service-worker.js" });
assert.equal(context.APP_VERSION, "v9");

async function fetchThroughWorker(request) {
  let responsePromise;
  handlers.fetch({ request, respondWith(value) { responsePromise = value; } });
  return responsePromise;
}

for (const file of appFiles) {
  const url = new URL(file, scope).href + "?cachecheck=1";
  assert.equal(await fetchThroughWorker({
    url, method: "GET", mode: "cors"
  }), "v9 " + file, file + " must come from the v9 cache");
}
assert.equal(await fetchThroughWorker({
  url: scope + "?route=training", method: "GET", mode: "navigate"
}), "v9 index.html", "navigation must return the current cached index");
networkOffline = true;
assert.equal(await fetchThroughWorker({
  url: scope + "?offline=1", method: "GET", mode: "navigate"
}), "v9 index.html", "offline navigation must return the current cached index");
networkOffline = false;
assert.equal(await fetchThroughWorker({
  url: scope + "not-in-app-files.json", method: "GET", mode: "cors"
}), "network /word-sniper/not-in-app-files.json", "unlisted same-origin requests must go directly to network");
assert.equal(globalCacheMatchCalls, 0, "fetch must not search all caches");
assert.equal(networkCalls, 1, "navigation and listed assets must not reach the network");
assert.equal(cacheMatchCalls.every(function (call) {
  return call.name === "sniper-v9" && call.options && call.options.ignoreSearch === true;
}), true, "every cache lookup must use the current version and ignoreSearch");

let installPromise;
handlers.install({ waitUntil(value) { installPromise = value; } });
await installPromise;
assert.equal(skipWaitingCalls, 1, "install must activate the new worker without waiting");
let activatePromise;
handlers.activate({ waitUntil(value) { activatePromise = value; } });
await activatePromise;
assert.equal(oldCacheDeletes, 1, "activate must delete the old version cache");
assert.equal(claimCalls, 1, "activate must claim existing clients");
assert.equal(handlers.message, undefined, "manual SKIP_WAITING messages must be removed");

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "expected function not found: " + marker);
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail("function has unbalanced braces: " + marker);
}

const lifecycleSource = extractFunction(gameSource, "  function createWorkerLifecycle(");
const lifecycleContext = vm.createContext({});
const createWorkerLifecycle = vm.runInContext("(" + lifecycleSource + ")", lifecycleContext);

function makeLifecycle(isHomeInitially) {
  const serviceWorkerHandlers = {};
  const documentHandlers = {};
  const state = { isHome: isHomeInitially, reloads: 0, updates: 0 };
  const serviceWorkerContainer = {
    addEventListener(name, callback) { serviceWorkerHandlers[name] = callback; }
  };
  const doc = {
    visibilityState: "hidden",
    addEventListener(name, callback) { documentHandlers[name] = callback; }
  };
  const win = { location: { reload() { state.reloads += 1; } } };
  const lifecycle = createWorkerLifecycle(serviceWorkerContainer, doc, win, function () { return state.isHome; });
  lifecycle.setRegistration({ update() { state.updates += 1; return Promise.resolve(); } });
  return { lifecycle, serviceWorkerHandlers, documentHandlers, doc, state };
}

const homeLifecycle = makeLifecycle(true);
homeLifecycle.serviceWorkerHandlers.controllerchange();
homeLifecycle.serviceWorkerHandlers.controllerchange();
assert.equal(homeLifecycle.state.reloads, 1, "home must reload once for a controller change");

const gameLifecycle = makeLifecycle(false);
gameLifecycle.serviceWorkerHandlers.controllerchange();
assert.equal(gameLifecycle.state.reloads, 0, "an active game must not reload");
gameLifecycle.state.isHome = true;
gameLifecycle.lifecycle.onHome();
gameLifecycle.lifecycle.onHome();
assert.equal(gameLifecycle.state.reloads, 1, "returning home must reload once without looping");
gameLifecycle.doc.visibilityState = "visible";
gameLifecycle.documentHandlers.visibilitychange();
assert.equal(gameLifecycle.state.updates, 1, "returning to foreground must check for worker updates");

console.log("Service Worker 模拟通过：资源与导航只来自 sniper-v9；离线首页可用；安装自动接管并清理旧缓存；对局延迟刷新，回首页只刷新一次；前台恢复时检查更新。");
