"use strict";

importScripts("version.js");

const CACHE_NAME = "sniper-" + APP_VERSION;
const APP_FILES = [
  "index.html",
  "style.css",
  "version.js",
  "error-capture.js",
  "game.js",
  "audio.js",
  "backup.js",
  "srs.js",
  "words.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    const scopeUrl = self.registration.scope;
    await cache.addAll(APP_FILES.map(function (path) { return new URL(path, scopeUrl).href; }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.filter(function (name) {
      return name.startsWith("sniper-") && name !== CACHE_NAME;
    }).map(function (name) { return caches.delete(name); }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async function () {
    const cache = await caches.open(CACHE_NAME);
    const indexUrl = new URL("index.html", self.registration.scope).href;
    if (request.mode === "navigate") {
      const index = await cache.match(indexUrl, { ignoreSearch: true });
      return index || Response.error();
    }

    const requestUrl = new URL(request.url);
    const isAppFile = APP_FILES.some(function (path) {
      return new URL(path, self.registration.scope).pathname === requestUrl.pathname;
    });
    if (!isAppFile) return fetch(request);

    const cached = await cache.match(request, { ignoreSearch: true });
    return cached || Response.error();
  })());
});
