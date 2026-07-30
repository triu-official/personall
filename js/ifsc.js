// IFSC code lookup and address resolution utility
window.ifscCache = JSON.parse(localStorage.getItem('personall_ifsc_cache') || '{}');

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

window.lookupIFSC = function(ifscCode, callback) {
    if (!ifscCode) {
        callback({ address: "-", bank: "-", branch: "-" });
        return;
    }
    var clean = String(ifscCode).trim().toUpperCase();

    // Check Cache
    if (window.ifscCache[clean]) {
        callback(window.ifscCache[clean]);
        return;
    }

    // Attempt Fetch from Razorpay IFSC API
    var fallbackBank = window.getBankNameFromIFSC(clean);
    var fallbackData = {
        address: fallbackBank + " (Address Lookup Offline/Failed)",
        bank: fallbackBank,
        branch: ""
    };

    fetch("https://ifsc.razorpay.com/" + clean)
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

            var result = {
                address: resolvedAddr,
                bank: data.BANK || fallbackBank,
                branch: branch
            };

            window.ifscCache[clean] = result;
            try {
                localStorage.setItem('personall_ifsc_cache', JSON.stringify(window.ifscCache));
            } catch(e) {
                console.error("Localstorage cache write failed:", e);
            }
            callback(result);
        })
        .catch(function(err) {
            // Save fallback to cache temporarily to prevent repeat calls during this session
            window.ifscCache[clean] = fallbackData;
            callback(fallbackData);
        });
};

window.getIFSCCachedSync = function(ifscCode) {
    if (!ifscCode) return { address: "-", bank: "-", branch: "-" };
    var clean = String(ifscCode).trim().toUpperCase();
    if (window.ifscCache[clean]) {
        return window.ifscCache[clean];
    }
    var fallbackBank = window.getBankNameFromIFSC(clean);
    return {
        address: fallbackBank + " (Address Lookup Pending)",
        bank: fallbackBank,
        branch: ""
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
        if (match) return match[1].toUpperCase();
    }

    // Scan all other columns in this row
    for (var h of headers) {
        var val = String(rowObj[h] || "").trim();
        var match = val.match(ifscRegex);
        if (match) return match[1].toUpperCase();
    }

    // 2. Check sheet-level metadata as fallback
    if (window.appState && window.appState.sheetIFSC && window.appState.sheetIFSC[sheetName]) {
        return window.appState.sheetIFSC[sheetName];
    }

    return null;
};
