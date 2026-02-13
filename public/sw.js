// Service Worker for offline support
// キャッシュバージョン: デプロイ時に自動的に古いキャッシュがクリアされる
const CACHE_NAME = 'inaho-minutes-v3';
const OFFLINE_URL = '/offline.html';

// オフライン時に必要な最小限のアセットのみプリキャッシュ
const PRECACHE_ASSETS = [
    '/offline.html',
    '/manifest.json',
    '/inaho-logo.png',
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip non-http(s) requests (chrome-extension://, etc.)
    if (!event.request.url.startsWith('http')) return;

    // Skip API requests
    if (event.request.url.includes('/api/')) return;

    // ナビゲーション（HTMLページ）と JS/CSS → Network First
    // 画像・フォントなどの静的アセット → Cache First
    const isNavigationOrAsset =
        event.request.mode === 'navigate' ||
        event.request.destination === 'script' ||
        event.request.destination === 'style';

    if (isNavigationOrAsset) {
        // Network First: 常に最新を取得し、失敗時のみキャッシュ
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request).then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;
                        if (event.request.mode === 'navigate') {
                            return caches.match(OFFLINE_URL);
                        }
                    });
                })
        );
    } else {
        // Cache First: 画像・フォントなどは効率優先
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;

                return fetch(event.request)
                    .then((response) => {
                        if (response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(event.request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(() => {
                        // オフライン時: 何も返せない場合は無視
                    });
            })
        );
    }
});
