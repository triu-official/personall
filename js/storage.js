/**
 * IndexedDB persistence layer (notebook-style).
 *
 * Stores the PARSED workbook (rawData / structuredData / layers / stats /
 * sheet metadata) plus the IFSC offline-retry queue. The search index is NOT
 * persisted — it is rebuilt after restore so it can never go stale.
 *
 * Structure:
 *   - store "workbooks": { id (auto), name, sourceNames, sizeBytes, timestamp,
 *                          metadata {sheets, rows, layers, entities, transactions,
 *                          totalAmount}, data {serialized state} }
 *   - store "ifscQueue": { code, ts }  — failed lookups awaiting retry
 */
(function(App) {
    'use strict';

    var Storage = App.Storage || {};

    var DB_NAME = 'personall_db';
    var DB_VERSION = 2;
    var WORKBOOKS = 'workbooks';
    var IFSC_QUEUE = 'ifscQueue';
    var CURRENT_KEY = 'personall_current_workbook_id';

    var _dbPromise = null;

    function openDB() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise(function(resolve, reject) {
            if (typeof indexedDB === 'undefined' || !indexedDB) {
                reject(new Error('IndexedDB is not available in this browser.'));
                return;
            }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(WORKBOOKS)) {
                    db.createObjectStore(WORKBOOKS, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(IFSC_QUEUE)) {
                    db.createObjectStore(IFSC_QUEUE, { keyPath: 'code' });
                }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(req.error || e.target.error || new Error('Failed to open IndexedDB')); };
        });
        return _dbPromise;
    }

    function transaction(storeName, mode, fn) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(storeName, mode);
                var store = tx.objectStore(storeName);
                var result;
                var request;
                try {
                    request = fn(store);
                } catch (err) {
                    reject(err);
                    return;
                }
                if (request) {
                    request.onsuccess = function(e) { result = e.target ? e.target.result : undefined; };
                    request.onerror = function(e) { reject(request.error || e.target.error); };
                }
                tx.oncomplete = function() { resolve(result); };
                tx.onerror = function(e) { reject(tx.error || e.target.error); };
                tx.onabort = function(e) { reject(tx.error || new Error('IndexedDB transaction aborted')); };
            });
        });
    }

    function serializeState(state) {
        var layerReceiverSets = {};
        var lrs = state.layerReceiverSets || {};
        Object.keys(lrs).forEach(function(k) {
            var v = lrs[k];
            layerReceiverSets[k] = (v instanceof Set) ? Array.from(v) : (v || []);
        });
        return {
            rawData: state.rawData || {},
            structuredData: state.structuredData || {},
            layers: state.layers || [],
            stats: state.stats || { layers: 0, entities: 0, transactions: 0, totalAmount: 0 },
            sheetColInfo: state.sheetColInfo || {},
            layerReceiverSets: layerReceiverSets,
            sheetIFSC: state.sheetIFSC || {}
        };
    }

    function deserializeState(stored) {
        var layerReceiverSets = {};
        var lrs = (stored && stored.layerReceiverSets) || {};
        Object.keys(lrs).forEach(function(k) {
            layerReceiverSets[k] = new Set(lrs[k] || []);
        });
        return {
            rawData: (stored && stored.rawData) || {},
            structuredData: (stored && stored.structuredData) || {},
            layers: (stored && stored.layers) || [],
            stats: (stored && stored.stats) || { layers: 0, entities: 0, transactions: 0, totalAmount: 0 },
            sheetColInfo: (stored && stored.sheetColInfo) || {},
            layerReceiverSets: layerReceiverSets,
            sheetIFSC: (stored && stored.sheetIFSC) || {}
        };
    }

    /**
     * Persist the current workbook. `sourceNames` and `sizeBytes` come from the
     * upload; they are merged with the freshly parsed state.
     */
    Storage.saveWorkbook = function(state, sourceNames, sizeBytes) {
        var names = sourceNames || [];
        var record = {
            name: names.length ? names.join(' + ') : 'Workbook',
            sourceNames: names,
            sizeBytes: sizeBytes || 0,
            timestamp: Date.now(),
            metadata: {
                sheets: Object.keys((state && state.rawData) || {}).length,
                rows: (state && state.stats) ? state.stats.transactions : 0,
                layers: (state && state.layers) ? state.layers.length : 0,
                entities: (state && state.stats) ? state.stats.entities : 0,
                transactions: (state && state.stats) ? state.stats.transactions : 0,
                totalAmount: (state && state.stats) ? state.stats.totalAmount : 0
            },
            data: serializeState(state || {})
        };

        return transaction(WORKBOOKS, 'readwrite', function(store) {
            return store.add(record);
        }).then(function(id) {
            if (id !== undefined && id !== null) {
                try { localStorage.setItem(CURRENT_KEY, String(id)); } catch (e) {}
            }
            return id;
        }).catch(function(err) {
            console.warn('[Storage] Could not persist workbook:', err);
            return null;
        });
    };

    Storage.loadWorkbook = function(id) {
        return transaction(WORKBOOKS, 'readonly', function(store) {
            return store.get(id);
        }).then(function(rec) {
            if (!rec) return null;
            try { localStorage.setItem(CURRENT_KEY, String(rec.id)); } catch (e) {}
            return {
                id: rec.id,
                name: rec.name,
                sourceNames: rec.sourceNames || [],
                timestamp: rec.timestamp,
                metadata: rec.metadata || {},
                state: deserializeState(rec.data)
            };
        }).catch(function(err) {
            console.warn('[Storage] Could not load workbook:', err);
            return null;
        });
    };

    Storage.listWorkbooks = function() {
        return transaction(WORKBOOKS, 'readonly', function(store) {
            return store.getAll();
        }).then(function(records) {
            return (records || []).map(function(r) {
                return {
                    id: r.id,
                    name: r.name,
                    sourceNames: r.sourceNames || [],
                    timestamp: r.timestamp,
                    metadata: r.metadata || {}
                };
            }).sort(function(a, b) { return b.timestamp - a.timestamp; });
        }).catch(function() { return []; });
    };

    Storage.deleteWorkbook = function(id) {
        return transaction(WORKBOOKS, 'readwrite', function(store) { store.delete(id); });
    };

    Storage.clearWorkbooks = function() {
        return transaction(WORKBOOKS, 'readwrite', function(store) { store.clear(); });
    };

    Storage.getCurrentWorkbookId = function() {
        try { return localStorage.getItem(CURRENT_KEY); } catch (e) { return null; }
    };

    // ---- IFSC offline retry queue ------------------------------------------

    Storage.queueIfscLookup = function(code) {
        return transaction(IFSC_QUEUE, 'readwrite', function(store) {
            return store.put({ code: code, ts: Date.now() });
        }).catch(function() {});
    };

    Storage.listIfscQueue = function() {
        return transaction(IFSC_QUEUE, 'readonly', function(store) {
            return store.getAll();
        }).catch(function() { return []; });
    };

    Storage.clearIfscQueueItem = function(code) {
        return transaction(IFSC_QUEUE, 'readwrite', function(store) { store.delete(code); });
    };

    Storage.clearIfscQueue = function() {
        return transaction(IFSC_QUEUE, 'readwrite', function(store) { store.clear(); });
    };

    App.Storage = Storage;
})(window.PersonallApp);
