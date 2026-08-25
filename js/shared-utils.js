/**
 * Shared utilities — single source of truth for column-role detection and
 * amount parsing. Loaded AFTER app-core.js and BEFORE all consumers so every
 * module (app.js, table.js, mindmap.js, export.js) uses the same logic.
 */
(function(App) {
    'use strict';

    if (!App || !App.Utils) return;

    var U = App.Utils;

    /**
     * Find the primary entity column among normalized headers.
     * Headers are matched case-insensitively against the configured patterns.
     */
    U.findEntityCol = function(headers, patterns) {
        if (!headers) return null;
        var pats = patterns || (App.state && App.state.primaryEntityPatterns) || [];
        for (var h = 0; h < headers.length; h++) {
            var lower = String(headers[h]).toLowerCase();
            for (var p = 0; p < pats.length; p++) {
                if (lower.indexOf(String(pats[p]).toLowerCase()) !== -1) return headers[h];
            }
        }
        return null;
    };

    /** Find the first amount column among normalized headers. */
    U.findAmountCol = function(headers) {
        if (!headers) return null;
        for (var h = 0; h < headers.length; h++) {
            if (U.isAmountHeader(headers[h])) return headers[h];
        }
        return null;
    };

    /** Find the first money-transfer receiver column, if any. */
    U.findReceiverCol = function(headers, entityCol) {
        if (!headers) return null;
        for (var h = 0; h < headers.length; h++) {
            var header = headers[h];
            if (header === entityCol) continue;
            if (U.isReceiverHeader(header, entityCol)) return header;
        }
        return null;
    };

    /**
     * True when a sheet represents money transfers. Checks the sheet name and,
     * when headers are provided, the presence of a distinct receiver column.
     */
    U.isMoneyTransferSheet = function(sheetName, headers, entityCol) {
        var lower = String(sheetName).toLowerCase();
        if (lower.indexOf('money transfer') !== -1 ||
            lower.indexOf('transfer') !== -1 ||
            lower.indexOf('fund flow') !== -1) {
            return true;
        }
        if (headers && headers.length) {
            var recvCol = U.findReceiverCol(headers, entityCol);
            if (recvCol) return true;
        }
        return false;
    };

    /** Alias so callers that historically used parseAmountValue stay correct. */
    U.parseAmountValue = U.parseAmount;

    /**
     * Build a trigram inverted index over a flat search index.
     * Returns a plain object: { trigram: [rowIndex, ...] }.
     * Plain object keeps it serializable (postMessage + IndexedDB) and fast.
     * Trigrams are extracted per whitespace token (>= 3 chars) so the index
     * stays compact while supporting substring queries of length >= 3.
     */
    U.buildInvertedIndex = function(searchIndex) {
        var map = {};
        if (!searchIndex) return map;
        for (var i = 0; i < searchIndex.length; i++) {
            var entry = searchIndex[i];
            var text = (entry && entry.normalizedText) || '';
            var tokens = text.split(/\s+/);
            for (var t = 0; t < tokens.length; t++) {
                var tok = tokens[t];
                if (tok.length < 3) continue;
                var uniq = {};
                for (var c = 0; c < tok.length - 2; c++) {
                    var key = tok.substr(c, 3);
                    if (uniq[key]) continue;
                    uniq[key] = true;
                    if (!map[key]) map[key] = [];
                    map[key].push(i);
                }
            }
        }
        return map;
    };

    /**
     * Return an Array of search-index row indices that COULD match the query
     * (candidates), or null when a full scan should be used instead.
     * For queries of length >= 3 the rarest matching trigram is the candidate
     * set; the caller still applies the exact substring check.
     */
    U.searchCandidates = function(invertedIndex, query) {
        if (!invertedIndex || !query) return null;
        var q = String(query).toLowerCase();
        var tokens = q.split(/\s+/);
        var triSet = {};
        var hasTri = false;
        for (var t = 0; t < tokens.length; t++) {
            var tok = tokens[t];
            for (var c = 0; c < tok.length - 2; c++) {
                triSet[tok.substr(c, 3)] = true;
                hasTri = true;
            }
        }
        if (!hasTri) return null;

        // Pick the rarest trigram as the candidate pool.
        var bestKey = null;
        var bestLen = Infinity;
        for (var key in triSet) {
            if (!Object.prototype.hasOwnProperty.call(triSet, key)) continue;
            var list = invertedIndex[key];
            if (!list) return []; // impossible trigram -> no matches
            if (list.length < bestLen) {
                bestLen = list.length;
                bestKey = key;
            }
        }
        return bestKey ? invertedIndex[bestKey] : null;
    };

    /**
     * Extract a merchant/payee name from a bank transaction Remarks string.
     * Handles common Indian bank remark formats:
     *   IB:Name, MB:Name, UPI-Name-..., UPI/Name/..., UPI:DR:P2M:N:Name,
     *   Name,AXISP..., NEFT/Name, RTGS/Name, IMPS/Name, Name,VPA...
     * Returns the extracted name or null if no recognizable pattern found.
     */
    U.extractMerchantName = function(remark) {
        if (!remark) return null;
        var s = String(remark).trim();
        if (!s) return null;

        // IB:Name / MB:Name / IB: Name / MB: Name
        var m = s.match(/^(?:IB|MB)[:\s]+([^,]+)/i);
        if (m) return m[1].trim();

        // UPI-Name-...  (UPI-MADAN LAL-Q443...)
        m = s.match(/^UPI[-\/]([^-\/]+)/i);
        if (m) return m[1].trim();

        // UPI/Name/...  (UPI/Manish Kumar/PUNB/...)
        m = s.match(/^UPI[:\/]([^\/]+)/i);
        if (m) return m[1].trim();

        // UPI:DR:P2M:N:Name  (UPI:DR:P2M:N:Amazon)
        m = s.match(/^UPI:DR:P2M:N:([^,]+)/i);
        if (m) return m[1].trim();

        // Name,AXISP... / Name,VPA... (Landera,AXISP0080879)
        m = s.match(/^([^,]+),AXISP/i);
        if (m) return m[1].trim();

        m = s.match(/^([^,]+),VPA/i);
        if (m) return m[1].trim();

        // NEFT/Name / RTGS/Name / IMPS/Name (NEFT/Amazon Traders)
        m = s.match(/^(?:NEFT|RTGS|IMPS)[\/\:]\s*([^,]+)/i);
        if (m) return m[1].trim();

        // Fallback: first segment before common separators if it looks like a name
        // (contains letters, not just numbers/codes)
        var firstSeg = s.split(/[,\/|:]/)[0].trim();
        if (/[A-Za-z]{3,}/.test(firstSeg) && !/^\d+$/.test(firstSeg)) {
            return firstSeg;
        }
        return null;
    };

    /**
     * Extract amount from Remarks string (for sheets lacking amount column).
     * Matches patterns like: INR 35.67, Rs. 1,000, ₹ 500, Rupees 100.
     * Returns the numeric amount or null.
     */
    U.extractAmountFromRemarks = function(remark) {
        if (!remark) return null;
        var s = String(remark).trim();
        if (!s) return null;
        var m = s.match(/(?:INR|Rs\.?|₹|Rupees)\.?\s*([\d,]+(?:\.\d+)?)/i);
        if (m) {
            var num = parseFloat(m[1].replace(/,/g, ''));
            return isNaN(num) ? null : num;
        }
        return null;
    };

})(window.PersonallApp);
