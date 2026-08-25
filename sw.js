/* Service Worker — offline app-shell cache (assets only, never user data). */
'use strict';

var CACHE_NAME = 'personall-shell-v1';
var ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './config.sample.js',
    './libs/xlsx.full.min.js',
    './libs/cytoscape.min.js',
    './libs/docx.js',
    './js/app-core.js',
    './js/shared-utils.js',
    './js/storage.js',
    './js/perf-monitor.js',
    './js/ifsc.js',
    './js/app.js',
    './js/table.js',
    './js/mindmap.js',
    './js/export.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return Promise.allSettled(ASSETS.map(function(url) { return cache.add(url); }));
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE_NAME; })
                    .map(function(k) { return caches.delete(k); })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Stale-while-revalidate for app-shell assets; never intercept API/data calls.
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.match(event.request).then(function(cached) {
                var network = fetch(event.request).then(function(response) {
                    if (response && response.ok && response.type === 'basic') {
                        cache.put(event.request, response.clone());
                    }
                    return response;
                }).catch(function() {
                    return cached;
                });
                return cached || network;
            });
        })
    );
});
