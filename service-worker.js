"use strict";

const CACHE_NAME = "sniper-v2";
const APP_FILES = [
  "index.html",
  "style.css",
  "game.js",
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
  })());
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && new URL(request.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        const indexUrl = new URL("index.html", self.registration.scope).href;
        const offlinePage = await caches.match(indexUrl);
        if (offlinePage) return offlinePage;
      }
      throw error;
    }
  })());
});
