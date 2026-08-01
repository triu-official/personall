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
        env: {},
        formatters: {
            amount: function(val) {
                if (val === null || val === undefined || isNaN(val)) return val;
                var num = Number(val);
                if (isNaN(num)) return val;
                return num.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
            }
        },
        UI: {},       // populated by other modules
        IFSC: {},     // populated by ifsc.js
        Graph: {},    // populated by mindmap.js
        Table: {},    // populated by table.js
        Export: {},   // populated by export.js
        Utils: {}     // optional shared utils
    };

    global.PersonallApp = PersonallApp;
})(window);
