(function(App) {
    'use strict';

    var IFSC = App.IFSC || {};
    // Load the persisted cache defensively. A single corrupt/oversized entry
    // must never kill the whole IFSC module (which would break table rendering).
    var ifscCache = {};
    try {
        var _rawCache = JSON.parse(localStorage.getItem('personall_ifsc_cache') || '{}');
        if (_rawCache && typeof _rawCache === 'object' && !Array.isArray(_rawCache)) {
            var _cacheKeys = Object.keys(_rawCache);
            for (var _ci = 0; _ci < _cacheKeys.length; _ci++) {
                var _entry = _rawCache[_cacheKeys[_ci]];
                if (_entry && typeof _entry === 'object' && typeof _entry.status === 'string') {
                    ifscCache[_cacheKeys[_ci]] = _entry;
                }
            }
        }
    } catch (e) {
        console.warn("Corrupt IFSC cache detected in localStorage — starting fresh.", e);
        try { localStorage.removeItem('personall_ifsc_cache'); } catch (e2) {}
    }
    var ifscApiBlocked = false;
    var ifscApiTested = false;
    var ifscCallbackQueue = {}; // { IFSC: [callback, ...] } for pending lookups

    // Cache freshness policy (config overridable via App.config).
    //  - CACHE_TTL_MS: resolved entries older than this are re-fetched in the
    //    background (stale-while-revalidate) instead of being served forever.
    //  - FALLBACK_RETRY_MS: fallback entries are re-attempted after this delay,
    //    so an offline/pending lookup can never permanently poison the cache.
    var CACHE_TTL_MS = ((App.config && App.config.IFSC_CACHE_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;
    var FALLBACK_RETRY_MS = ((App.config && App.config.IFSC_FALLBACK_RETRY_HOURS) || 24) * 60 * 60 * 1000;

    // fetch() wrapper with an abort timeout so a hanging network request can
    // never leave cells stuck on "Looking up..." or deadlock the bulk queue.
    function fetchWithTimeout(url, options, timeoutMs) {
        var ms = timeoutMs || 15000;
        if (typeof AbortController === 'undefined') return fetch(url, options);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, ms);
        var opts = options || {};
        opts.signal = controller.signal;
        return fetch(url, opts).finally(function () {
            clearTimeout(timer);
        });
    }



function getBankNameFromIFSC(ifsc) {
    if (!ifsc || ifsc.length < 4) return "Unknown Bank";
    var prefix = ifsc.substring(0, 4).toUpperCase();
    var banks = {
        "SBIN": "State Bank of India",
        "HDFC": "HDFC Bank",
        "ICIC": "ICICI Bank",
        "UTIB": "Axis Bank",
        "BARB": "Bank of Baroda",
        "PUNB": "Punjab National Bank",
        "CNRB": "Canara Bank",
        "BOID": "Bank of India",
        "UBIN": "Union Bank of India",
        "IBKL": "IDBI Bank",
        "BARC": "Barclays Bank",
        "CIUB": "City Union Bank",
        "CSBK": "CSB Bank",
        "DBSS": "DBS Bank",
        "DCBL": "DCB Bank",
        "DLXB": "Dhanlaxmi Bank",
        "FDRL": "Federal Bank",
        "IDFB": "IDFC First Bank",
        "INDB": "IndusInd Bank",
        "JAKA": "Jammu & Kashmir Bank",
        "KVBL": "Karur Vysya Bank",
        "KKBK": "Kotak Mahindra Bank",
        "NESF": "North East Small Finance Bank",
        "PSIB": "Punjab & Sind Bank",
        "RATN": "RBL Bank",
        "SIBL": "South Indian Bank",
        "SGBY": "Saurashtra Gramin Bank",
        "SCBL": "Standard Chartered Bank",
        "TMBL": "Tamilnad Mercantile Bank",
        "UCOB": "UCO Bank",
        "YESB": "Yes Bank",
        "IPOS": "India Post Payments Bank",
        "PYTM": "Paytm Payments Bank",
        "AIRP": "Airtel Payments Bank",
        "FINO": "Fino Payments Bank",
        "JSFB": "Jana Small Finance Bank",
        "ESAF": "ESAF Small Finance Bank",
        "AUBL": "AU Small Finance Bank",
        "UJVN": "Ujjivan Small Finance Bank",
        "EQUT": "Equitas Small Finance Bank",
        "SURY": "Suryoday Small Finance Bank"
    };
    return banks[prefix] || (prefix + " Bank");
};

// Ensure cache is not blown by catching quota exceeded errors
function saveCacheSafe() {
    try {
        localStorage.setItem('personall_ifsc_cache', JSON.stringify(ifscCache));
    } catch(e) {
        console.warn("LocalStorage cache write failed. Cache might be full.", e);
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            // Very naive eviction: clear half the cache if it gets too big
            var keys = Object.keys(ifscCache);
            if (keys.length > 500) {
                var newCache = {};
                for (var i = Math.floor(keys.length / 2); i < keys.length; i++) {
                    newCache[keys[i]] = ifscCache[keys[i]];
                }
                ifscCache = newCache;
                try {
                    localStorage.setItem('personall_ifsc_cache', JSON.stringify(ifscCache));
                } catch(e2) {
                    console.error("Cache still full after eviction", e2);
                }
            }
        }
    }
}

function testIfscApi() {
    // Only test once
    if (ifscApiTested) return Promise.resolve(!ifscApiBlocked);
    ifscApiTested = true;

        var apiUrl = (App.config && App.config.RAZORPAY_IFSC_API_URL) ? App.config.RAZORPAY_IFSC_API_URL : "https://ifsc.razorpay.com/";

    var fetchOptions = {};
        var apiKey = (App.config && (App.config.IFSC_API_KEY || App.config.RAZORPAY_IFSC_API_KEY));
    if (apiKey) {
        fetchOptions.headers = {
            "Authorization": "Bearer " + apiKey,
            "X-API-Key": apiKey
        };
    }

    // Use HDFC0000001 as the known-valid code for the CORS/Network test
    return fetchWithTimeout(apiUrl + "HDFC0000001", fetchOptions, 12000)

        .then(function(res) {
            if (res.ok) {
                                return true;
            } else {
                throw new Error("API returned non-ok");
            }
        })
        .catch(function(err) {
            console.warn("IFSC API Blocked (likely CORS/file:// protocol)", err);
            ifscApiBlocked = true;
            showLocalServerBanner();
            return false;
        });
};

function showLocalServerBanner() {
    if (document.getElementById("cors-banner")) return;

    var banner = document.createElement("div");
    banner.id = "cors-banner";
    banner.style.cssText = "position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: var(--danger-color, #e74c3c); color: white; padding: 10px 20px; border-radius: 5px; z-index: 10000; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 14px;";

    var msg = document.createElement("span");
    msg.innerHTML = "<strong>Local Server Recommended:</strong> Browser security (CORS) is blocking online address lookups. Fallback dictionary is active. <br><small>To fix: Run <code>python -m http.server</code> or <code>npx serve</code> in the app folder.</small>";

    var closeBtn = document.createElement("button");
    closeBtn.innerText = "Dismiss";
    closeBtn.style.cssText = "background: white; color: var(--danger-color, #e74c3c); border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-weight: bold;";
    closeBtn.onclick = function() { banner.remove(); };

    banner.appendChild(msg);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
}


function lookupIFSC(ifscCode, callback) {
    if (!ifscCode) {
        callback({ address: "-", bank: "-", branch: "-", status: "error" });
        return;
    }
    var clean = String(ifscCode).trim().toUpperCase();

    // Stale-while-revalidate: a cached entry is served instantly even when
    // stale; stale entries are refreshed in the background so the cache never
    // stays permanently wrong (and fallbacks never permanently poison it).
    var cached = ifscCache[clean];
    if (cached && cached.status !== "pending") {
        var age = Date.now() - (cached.ts || 0);
        var isStaleResolved = cached.status === "resolved" && age > CACHE_TTL_MS;
        var isStaleFallback = cached.status === "fallback" && age > FALLBACK_RETRY_MS;
        callback(cached);
        if (isStaleResolved || isStaleFallback) {
            revalidateInBackground(clean);
        }
        return;
    }

    var fallbackData = makeFallbackData(clean);

    // Check if there's already a pending request for this IFSC
    if (ifscCache[clean] && ifscCache[clean].status === "pending") {
        // Queue the callback — it will be called when the fetch completes
        if (!ifscCallbackQueue[clean]) {
            ifscCallbackQueue[clean] = [];
        }
        ifscCallbackQueue[clean].push(callback);
        return;
    }

    if (ifscApiBlocked) {
        var fbBlocked = withTs(fallbackData);
        ifscCache[clean] = fbBlocked;
        saveCacheSafe();
        callback(fbBlocked);
        return;
    }

    ifscCache[clean] = { status: "pending" };

    fetchIfsc(clean)
        .then(function(result) {
            ifscCache[clean] = withTs(result);
            saveCacheSafe();
            if (App.Storage && App.Storage.clearIfscQueueItem) App.Storage.clearIfscQueueItem(clean);
            callback(result);
            firePendingCallbacks(clean, result);
        })
        .catch(function(err) {
            // Save fallback to cache temporarily so repeated lookups during this
            // session are cheap; it will be re-attempted after the retry TTL.
            var fb = withTs(fallbackData);
            ifscCache[clean] = fb;
            saveCacheSafe();
            callback(fallbackData);
            firePendingCallbacks(clean, fallbackData);
            // Queue the failed lookup for automatic retry when back online.
            if (App.Storage && App.Storage.queueIfscLookup) App.Storage.queueIfscLookup(clean);
        });

    function firePendingCallbacks(code, result) {
        var q = ifscCallbackQueue[code];
        if (q) {
            delete ifscCallbackQueue[code];
            for (var i = 0; i < q.length; i++) {
                q[i](result);
            }
        }
    }
};

function withTs(entry) {
    var e = {};
    for (var k in entry) {
        if (Object.prototype.hasOwnProperty.call(entry, k)) e[k] = entry[k];
    }
    e.ts = Date.now();
    return e;
}

function makeFallbackData(clean) {
    var fb = getBankNameFromIFSC(clean);
    return {
        address: fb + " (Address Lookup Offline/Failed)",
        bank: fb,
        branch: "",
        status: "fallback"
    };
}

// Network fetch for a single IFSC — returns a Promise of the resolved record.
function fetchIfsc(clean) {
    var apiUrl = (App.config && App.config.RAZORPAY_IFSC_API_URL) ? App.config.RAZORPAY_IFSC_API_URL : "https://ifsc.razorpay.com/";
    var fetchOptions = {};
    var apiKey = (App.config && (App.config.IFSC_API_KEY || App.config.RAZORPAY_IFSC_API_KEY));
    if (apiKey) {
        fetchOptions.headers = {
            "Authorization": "Bearer " + apiKey,
            "X-API-Key": apiKey
        };
    }

    return fetchWithTimeout(apiUrl + clean, fetchOptions, 15000)
        .then(function(response) {
            if (!response.ok) {
                throw new Error("IFSC Lookup Failed");
            }
            return response.json();
        })
        .then(function(data) {
            var branch = data.BRANCH || "";
            var address = data.ADDRESS || "";
            var city = data.CITY || "";
            var state = data.STATE || "";
            var resolvedAddr = branch + " Branch, " + address;
            if (city) resolvedAddr += ", " + city;
            if (state) resolvedAddr += ", " + state;

            return {
                address: resolvedAddr,
                bank: data.BANK || getBankNameFromIFSC(clean),
                branch: branch,
                city: city,
                state: state,
                district: data.DISTRICT || "",
                contact: data.CONTACT || "",
                micr: data.MICR || "",
                rtgs: data.RTGS || false,
                neft: data.NEFT || false,
                imps: data.IMPS || false,
                upi: data.UPI || false,
                status: "resolved"
            };
        });
}

// Background refresh of a stale cache entry (never blocks the UI).
var REVALIDATING = {};
function revalidateInBackground(clean) {
    if (REVALIDATING[clean]) return;
    REVALIDATING[clean] = true;
    if (ifscApiBlocked) { delete REVALIDATING[clean]; return; }

    testIfscApi().then(function(isOk) {
        if (!isOk) { delete REVALIDATING[clean]; return; }
        fetchIfsc(clean)
            .then(function(result) {
                ifscCache[clean] = withTs(result);
                saveCacheSafe();
                if (App.Storage && App.Storage.clearIfscQueueItem) App.Storage.clearIfscQueueItem(clean);
                var ev = new CustomEvent('ifsc-resolved', { detail: { code: clean, result: result } });
                document.dispatchEvent(ev);
            })
            .catch(function() {
                // Keep the old value; retry when connectivity returns.
                if (App.Storage && App.Storage.queueIfscLookup) App.Storage.queueIfscLookup(clean);
            })
            .then(function() {
                delete REVALIDATING[clean];
            });
    });
}

// Auto-retry queued failures when the browser comes back online.
function processIfscQueue() {
    if (!(App.Storage && App.Storage.listIfscQueue)) return;
    App.Storage.listIfscQueue().then(function(items) {
        if (!items || items.length === 0) return;
        resetApiBlocked();
        testIfscApi().then(function(isOk) {
            if (!isOk) return;
            items.forEach(function(item) {
                var clean = String(item.code).trim().toUpperCase();
                delete ifscCache[clean];
                lookupIFSC(clean, function(result) {
                    if (result.status === 'resolved' && App.Storage.clearIfscQueueItem) {
                        App.Storage.clearIfscQueueItem(clean);
                    }
                });
            });
        });
    });
}

function resetApiBlocked() {
    ifscApiBlocked = false;
    ifscApiTested = false;
}

document.addEventListener('online', function() {
    processIfscQueue();
});


function getIFSCCachedSync(ifscCode) {
    if (!ifscCode) return { address: "-", bank: "-", branch: "-", status: "error" };
    var clean = String(ifscCode).trim().toUpperCase();
    if (ifscCache[clean]) {
        return ifscCache[clean];
    }
    var fallbackBank = getBankNameFromIFSC(clean);
    return {
        address: fallbackBank + " (Address Lookup Pending)",
        bank: fallbackBank,
        branch: "",
        status: "pending"
    };
};

function hasIFSCData(sheetName) {
    if (!App.state || !App.state.rawData || !App.state.rawData[sheetName]) return false;
    
    // 1. Check sheet-level metadata
    if (App.state.sheetIFSC && App.state.sheetIFSC[sheetName]) return true;

    // 2. Check headers
    var headers = App.state.rawData[sheetName].headers;
    var hasHeader = headers.some(h => {
        var hl = h.toLowerCase().replace(/[\s_\-\/]/g, "");
        return hl.includes("ifsc") || hl.includes("ifs") || hl.includes("branchcode") || hl.includes("solid");
    });
    if (hasHeader) return true;

    // 3. Check sample values (scan first 100 rows)
    var rows = App.state.rawData[sheetName].rows || [];
    var ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i;
    for (var i = 0; i < Math.min(rows.length, 100); i++) {
        var row = rows[i];
        for (var h of headers) {
            var val = String(row[h] || "");
            if (ifscRegex.test(val)) return true;
        }
    }

    return false;
};

function getRowIFSC(sheetName, rowObj) {
    if (!rowObj) return null;
    var ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i;

    // 1. Check direct cells in this row matching the regex
    var headers = (App.state && App.state.rawData && App.state.rawData[sheetName])
        ? App.state.rawData[sheetName].headers
        : Object.keys(rowObj);

    // Look for column names that match first
    var ifscHeaders = headers.filter(h => {
        var hl = h.toLowerCase().replace(/[\s_\-\/]/g, "");
        return hl.includes("ifsc") || hl.includes("ifs") || hl.includes("branchcode") || hl.includes("solid");
    });

    for (var h of ifscHeaders) {
        var val = String(rowObj[h] || "").trim();
        var match = val.match(ifscRegex);
        if (match) return { code: match[1].toUpperCase(), source: 'header_col' };
    }

    // Scan all other columns in this row
    for (var h of headers) {
        var val = String(rowObj[h] || "").trim();
        var match = val.match(ifscRegex);
        if (match) return { code: match[1].toUpperCase(), source: 'row_cell' };
    }

    // 2. Check sheet-level metadata as fallback
    if (App.state && App.state.sheetIFSC && App.state.sheetIFSC[sheetName]) {
        return { code: App.state.sheetIFSC[sheetName], source: 'sheet_metadata' };
    }

    return null;
};

function safeExtractIFSC(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val.code) return val.code;
    if (!safeExtractIFSC._loggedWarning) {
        console.warn("safeExtractIFSC: ignored invalid IFSC format", val);
        safeExtractIFSC._loggedWarning = true;
    }
    return null;
};

// Bulk resolution system — accepts either a Set or an ordered Array
// When an Array is passed, the order is preserved (layer priority).
function startBulkIFSCResolution(ifscInput, onComplete, onProgress) {
    var ifscList = (ifscInput instanceof Array) ? ifscInput.slice() : Array.from(ifscInput);
    ifscList = ifscList.filter(function(code) {
        var clean = String(code).trim().toUpperCase();
        var c = ifscCache[clean];
        if (!c || c.status === 'pending') return true;
        if (c.status === 'resolved' || c.status === 'fallback') {
            // Fresh entries are skipped; stale ones are re-attempted so the
            // cache self-heals even if it was populated during an outage.
            var age = Date.now() - (c.ts || 0);
            var stale = c.status === 'resolved' ? age > CACHE_TTL_MS : age > FALLBACK_RETRY_MS;
            return stale;
        }
        return true;
    });

    if (ifscList.length === 0) {
        if (onComplete) onComplete();
        return;
    }

    testIfscApi().then(function(isOk) {
        if (!isOk) {
            // API blocked, quickly mark all as fallback
            ifscList.forEach(function(code) {
                var clean = String(code).trim().toUpperCase();
                var fb = getBankNameFromIFSC(clean);
                ifscCache[clean] = withTs({
                    address: fb + " (Address Lookup Offline/Failed)",
                    bank: fb,
                    branch: "",
                    status: "fallback"
                });
            });
            saveCacheSafe();
            if (onProgress) onProgress(ifscList.length, ifscList.length);
            if (onComplete) onComplete();
            return;
        }

        // Process queue in order — earlier items in the array get resolved first
        var queue = ifscList.slice();
        var total = queue.length;
        var completed = 0;
        var concurrency = 2; // Reduced to 2 so earlier layers finish before later ones start
        var active = 0;

        function processNext() {
            if (queue.length === 0 && active === 0) {
                if (onComplete) onComplete();
                return;
            }

            while (active < concurrency && queue.length > 0) {
                var code = queue.shift();
                active++;

                setTimeout((function(c) {
                    return function() {
                        lookupIFSC(c, function(res) {
                            completed++;
                            active--;
                            if (onProgress) onProgress(completed, total);
                            processNext();

                            var event = new CustomEvent('ifsc-resolved', { detail: { code: c, result: res } });
                            document.dispatchEvent(event);
                        });
                    };
                })(code), 200);
            }
        }

        processNext();
    });
};

    // Expose methods
    IFSC.getBankNameFromIFSC = getBankNameFromIFSC;
    IFSC.testIfscApi = testIfscApi;
    IFSC.lookupIFSC = lookupIFSC;
    IFSC.getIFSCCachedSync = getIFSCCachedSync;
    IFSC.hasIFSCData = hasIFSCData;
    IFSC.getRowIFSC = getRowIFSC;
    IFSC.safeExtractIFSC = safeExtractIFSC;
    IFSC.startBulkIFSCResolution = startBulkIFSCResolution;
    IFSC.getCache = function() { return ifscCache; };
    IFSC.revalidateInBackground = revalidateInBackground;
    IFSC.processIfscQueue = processIfscQueue;
    IFSC.resetApiBlocked = resetApiBlocked;

    App.IFSC = IFSC;
})(window.PersonallApp);
