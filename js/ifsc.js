window.ifscCache = JSON.parse(localStorage.getItem('personall_ifsc_cache') || '{}');

window.ifscApiBlocked = false;
window.ifscBulkQueue = [];
window.ifscBulkInProgress = false;

window.getBankNameFromIFSC = function(ifsc) {
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
        localStorage.setItem('personall_ifsc_cache', JSON.stringify(window.ifscCache));
    } catch(e) {
        console.warn("LocalStorage cache write failed. Cache might be full.", e);
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            // Very naive eviction: clear half the cache if it gets too big
            var keys = Object.keys(window.ifscCache);
            if (keys.length > 500) {
                var newCache = {};
                for (var i = Math.floor(keys.length / 2); i < keys.length; i++) {
                    newCache[keys[i]] = window.ifscCache[keys[i]];
                }
                window.ifscCache = newCache;
                try {
                    localStorage.setItem('personall_ifsc_cache', JSON.stringify(window.ifscCache));
                } catch(e2) {
                    console.error("Cache still full after eviction", e2);
                }
            }
        }
    }
}

window.testIfscApi = function() {
    // Only test once
    if (window.ifscApiTested) return Promise.resolve(!window.ifscApiBlocked);
    window.ifscApiTested = true;

    var apiUrl = (window.APP_CONFIG && window.APP_CONFIG.RAZORPAY_IFSC_API_URL) ? window.APP_CONFIG.RAZORPAY_IFSC_API_URL : "https://ifsc.razorpay.com/";

    // Use HDFC0000001 as the known-valid code for the CORS/Network test
    return fetch(apiUrl + "HDFC0000001")
        .then(function(res) {
            if (res.ok) {
                window.ifscApiBlocked = false;
                return true;
            } else {
                throw new Error("API returned non-ok");
            }
        })
        .catch(function(err) {
            console.warn("IFSC API Blocked (likely CORS/file:// protocol)", err);
            window.ifscApiBlocked = true;
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


window.lookupIFSC = function(ifscCode, callback) {
    if (!ifscCode) {
        callback({ address: "-", bank: "-", branch: "-", status: "error" });
        return;
    }
    var clean = String(ifscCode).trim().toUpperCase();

    // Check Cache
    if (window.ifscCache[clean] && window.ifscCache[clean].status !== "pending") {
        callback(window.ifscCache[clean]);
        return;
    }

    var fallbackBank = window.getBankNameFromIFSC(clean);
    var fallbackData = {
        address: fallbackBank + " (Address Lookup Offline/Failed)",
        bank: fallbackBank,
        branch: "",
        status: "fallback"
    };

    if (window.ifscApiBlocked) {
        window.ifscCache[clean] = fallbackData;
        saveCacheSafe();
        callback(fallbackData);
        return;
    }

    // Check if there's already a pending request for this IFSC
    if (window.ifscCache[clean] && window.ifscCache[clean].status === "pending") {
         // It's pending, but we are a direct caller.
         // In a robust system, we would add the callback to a queue for this specific IFSC.
         // For simplicity and avoiding memory leaks with many closures, if it's pending,
         // we just return a temporary fallback and let the UI refresh or rely on the caller to retry.
         callback({ address: "Looking up...", bank: fallbackBank, branch: "", status: "pending" });
         return;
    }

    window.ifscCache[clean] = { status: "pending" };

    var apiUrl = (window.APP_CONFIG && window.APP_CONFIG.RAZORPAY_IFSC_API_URL) ? window.APP_CONFIG.RAZORPAY_IFSC_API_URL : "https://ifsc.razorpay.com/";

    fetch(apiUrl + clean)
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

            // Preserve all available returned fields
            var result = {
                address: resolvedAddr,
                bank: data.BANK || fallbackBank,
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

            window.ifscCache[clean] = result;
            saveCacheSafe();
            callback(result);
        })
        .catch(function(err) {
            // Save fallback to cache temporarily to prevent repeat calls during this session
            window.ifscCache[clean] = fallbackData;
            callback(fallbackData);
        });
};


window.getIFSCCachedSync = function(ifscCode) {
    if (!ifscCode) return { address: "-", bank: "-", branch: "-", status: "error" };
    var clean = String(ifscCode).trim().toUpperCase();
    if (window.ifscCache[clean]) {
        return window.ifscCache[clean];
    }
    var fallbackBank = window.getBankNameFromIFSC(clean);
    return {
        address: fallbackBank + " (Address Lookup Pending)",
        bank: fallbackBank,
        branch: "",
        status: "pending"
    };
};

window.hasIFSCData = function(sheetName) {
    if (!window.appState || !window.appState.rawData || !window.appState.rawData[sheetName]) return false;
    
    // 1. Check sheet-level metadata
    if (window.appState.sheetIFSC && window.appState.sheetIFSC[sheetName]) return true;

    // 2. Check headers
    var headers = window.appState.rawData[sheetName].headers;
    var hasHeader = headers.some(h => {
        var hl = h.toLowerCase().replace(/[\s_\-\/]/g, "");
        return hl.includes("ifsc") || hl.includes("ifs") || hl.includes("branchcode") || hl.includes("solid");
    });
    if (hasHeader) return true;

    // 3. Check sample values (scan first 100 rows)
    var rows = window.appState.rawData[sheetName].rows || [];
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

window.getRowIFSC = function(sheetName, rowObj) {
    if (!rowObj) return null;
    var ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i;

    // 1. Check direct cells in this row matching the regex
    var headers = (window.appState && window.appState.rawData && window.appState.rawData[sheetName])
        ? window.appState.rawData[sheetName].headers
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
    if (window.appState && window.appState.sheetIFSC && window.appState.sheetIFSC[sheetName]) {
        return { code: window.appState.sheetIFSC[sheetName], source: 'sheet_metadata' };
    }

    return null;
};

window.safeExtractIFSC = function(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val.code) return val.code;
    if (!window.safeExtractIFSC._loggedWarning) {
        console.warn("safeExtractIFSC: ignored invalid IFSC format", val);
        window.safeExtractIFSC._loggedWarning = true;
    }
    return null;
};

// Bulk resolution system
window.startBulkIFSCResolution = function(ifscSet, onComplete, onProgress) {
    ifscSet = Array.from(ifscSet).filter(function(code) {
        var clean = String(code).trim().toUpperCase();
        return !window.ifscCache[clean] || (window.ifscCache[clean].status !== 'resolved' && window.ifscCache[clean].status !== 'fallback');
    });

    if (ifscSet.length === 0) {
        if (onComplete) onComplete();
        return;
    }

    window.testIfscApi().then(function(isOk) {
        if (!isOk) {
            // API blocked, quickly mark all as fallback
            ifscSet.forEach(function(code) {
                var clean = String(code).trim().toUpperCase();
                var fb = window.getBankNameFromIFSC(clean);
                window.ifscCache[clean] = {
                    address: fb + " (Address Lookup Offline/Failed)",
                    bank: fb,
                    branch: "",
                    status: "fallback"
                };
            });
            saveCacheSafe();
            if (onComplete) onComplete();
            return;
        }

        // Process queue with concurrency
        // We use a Set in app.js, so ifscSet is already deduplicated, but we ensure it here implicitly by treating array
        var queue = ifscSet.slice();
        var total = queue.length;
        var completed = 0;
        var concurrency = 3; // Limit to 3 concurrent requests
        var active = 0;

        function processNext() {
            if (queue.length === 0 && active === 0) {
                if (onComplete) onComplete();
                return;
            }

            while (active < concurrency && queue.length > 0) {
                var code = queue.shift();
                active++;

                // Add a small delay between requests to avoid rate limits (150-250ms)
                setTimeout((function(c) {
                    return function() {
                        window.lookupIFSC(c, function(res) {
                            completed++;
                            active--;
                            if (onProgress) onProgress(completed, total);
                            processNext();

                            // Emit a custom event so UI elements can update themselves
                            var event = new CustomEvent('ifsc-resolved', { detail: { code: c, result: res } });
                            document.dispatchEvent(event);
                        });
                    };
                })(code), 200); // 200ms delay between firings in this active slot
            }
        }

        processNext();
    });
};
