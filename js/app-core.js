/**
 * Core Application Namespace
 * Wraps the state and shared configuration in a single namespace.
 */
(function(global) {
    'use strict';

    // Prevent multiple initializations
    if (global.PersonallApp) return;

    var PersonallApp = {
        state: {
            rawData: {},
            structuredData: {},
            layers: [],
            stats: {
                layers: 0,
                entities: 0,
                transactions: 0,
                totalAmount: 0
            },
            searchIndex: [],
            mindMapReady: false,
            cy: null,
            primaryEntityPatterns: ["accountno", "walletid", "pgid", "paid", "customer", "entity", "sender"],
            layerPatterns: ["layer", "lyr"],
            sheetIFSC: {},
            forceFullGraph: false,
            exportSelections: {},
            isExportGenerating: false,
            lastSearchQuery: ""
        },
        config: window.APP_CONFIG || {},
        env: {},
        formatters: {
            amount: function(val) {
                var num = PersonallApp.Utils.parseAmount(val);
                if (num === null) return '—';
                var isNegative = num < 0;
                var abs = Math.abs(num);
                var formatted;
                if (abs === 0) formatted = '0.00';
                else if (abs >= 10000000) formatted = (abs / 10000000).toFixed(2) + ' Cr';
                else if (abs >= 100000) formatted = (abs / 100000).toFixed(2) + ' L';
                else if (abs >= 1000) formatted = (abs / 1000).toFixed(2) + ' K';
                else formatted = abs.toFixed(2);
                return (isNegative ? '-' : '') + formatted;
            }
        },
        UI: {},       // populated by other modules
        IFSC: {},     // populated by ifsc.js
        Graph: {},    // populated by mindmap.js
        Table: {},    // populated by table.js
        Export: {},   // populated by export.js
        Utils: {
            /**
             * Robust amount parser. Handles numbers, strings, Indian grouping
             * ("1,00,000"), currency symbols ("₹ 5,000"), parentheses for
             * negatives ("(500)") and unit suffixes ("1.5 Cr", "50 L", "2 K").
             * Returns a finite Number or null when the value is not a real amount.
             */
            parseAmount: function(value) {
                if (value === null || value === undefined) return null;
                if (typeof value === 'number') return (isFinite(value)) ? value : null;
                if (typeof value === 'boolean') return null;
                var str = String(value).trim();
                if (str === '') return null;
                var lower = str.toLowerCase().replace(/,/g, '');
                var negative = false;
                var parenMatch = lower.match(/^\(\s*(.+?)\s*\)$/);
                if (parenMatch) {
                    negative = true;
                    lower = parenMatch[1];
                }
                var mult = 1;
                if (/cr\s*$/.test(lower)) { mult = 10000000; lower = lower.replace(/cr\s*$/, ''); }
                else if (/l[k]?\s*$/.test(lower)) { mult = 100000; lower = lower.replace(/l[k]?\s*$/, ''); }
                else if (/k\s*$/.test(lower)) { mult = 1000; lower = lower.replace(/k\s*$/, ''); }
                lower = lower.replace(/[^0-9.\-]/g, '');
                if (lower === '' || lower === '-' || lower === '.') return null;
                var num = parseFloat(lower);
                if (isNaN(num)) return null;
                if (negative) num = -Math.abs(num);
                return num * mult;
            },

            /** Returns true when a column header should be treated as an amount. */
            isAmountHeader: function(header) {
                var h = String(header).toLowerCase();
                return h.indexOf('amount') !== -1 || h.indexOf('amt') !== -1;
            },

            /** Shared cell formatter used by the table view and Word export. */
            formatCell: function(header, value) {
                if (PersonallApp.Utils.isAmountHeader(header)) {
                    return PersonallApp.formatters.amount(value);
                }
                if (value === null || value === undefined || value === '') return '';
                return String(value);
            },

            /**
             * Normalize a header array: trim, give blank cells a deterministic
             * name, and rename duplicates so no column value is ever overwritten.
             * Self-contained (no closures) so it can be embedded in the Worker.
             */
            normalizeHeaders: function(headers) {
                var seen = {};
                var out = [];
                for (var i = 0; i < headers.length; i++) {
                    var h = (headers[i] === null || headers[i] === undefined) ? '' : String(headers[i]).trim();
                    if (h === '') h = 'Column_' + (i + 1);
                    var base = h;
                    var n = 2;
                    while (seen[h]) {
                        h = base + ' (' + n + ')';
                        n++;
                    }
                    seen[h] = true;
                    out.push(h);
                }
                return out;
            },

            /**
             * Build a row object keyed by the (already normalized) header list.
             * Cells past the end of a ragged row are filled with null so trailing
             * columns never render as blank/undefined values.
             * Self-contained (no closures) so it can be embedded in the Worker.
             */
            buildRowObject: function(headers, rowArr) {
                var ro = {};
                for (var k = 0; k < headers.length; k++) {
                    ro[headers[k]] = (rowArr[k] !== undefined) ? rowArr[k] : null;
                }
                return ro;
            },

            /** Layer-safe view container id helper. */
            viewId: function(layerKey) {
                return 'view-' + String(layerKey).replace(/\s+/g, '-');
            },

            /** True when a money-transfer style receiver column exists. */
            isReceiverHeader: function(header, entityCol) {
                if (header === entityCol) return false;
                var kl = String(header).toLowerCase();
                return kl.indexOf('to account') !== -1 ||
                       kl.indexOf('beneficiary') !== -1 ||
                       kl.indexOf('receiver') !== -1 ||
                       kl.indexOf('transferred to') !== -1 ||
                       kl.indexOf('destination') !== -1 ||
                       kl === 'account no' ||
                       kl === 'to_account' ||
                       kl === 'toacc';
            },

            /** True when a sheet name suggests money-transfer rows. */
            isMoneyTransferSheet: function(sheetName) {
                var lower = String(sheetName).toLowerCase();
                return lower.indexOf('money transfer') !== -1 ||
                       lower.indexOf('transfer') !== -1 ||
                       lower.indexOf('fund flow') !== -1;
            }
        }
    };

    global.PersonallApp = PersonallApp;
})(window);
