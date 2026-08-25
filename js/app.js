(function(App) {
    'use strict';
// Global State
Object.assign(App.state, {
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
    searchIndexMap: null,
    mindMapReady: false,
    sheetIFSC: {},
    currentSourceNames: [],
    currentSizeBytes: 0
});

// ---------------------------------------------------------------
// Global error boundary → user-friendly toast (never a silent failure)
// ---------------------------------------------------------------
App.UI = App.UI || {};
App.UI.toast = function(message, type) {
    if (App.Perf && App.Perf.toast) App.Perf.toast(message, type);
};
window.addEventListener('error', function(e) {
    console.error('Uncaught error:', e.error || e.message);
    if (App.UI && App.UI.toast) {
        App.UI.toast('Something went wrong: ' + ((e.error && e.error.message) || e.message || 'unknown error'), 'error');
    }
});
window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    if (App.UI && App.UI.toast) {
        App.UI.toast('An operation could not be completed: ' + ((e.reason && e.reason.message) || 'unknown error'), 'error');
    }
});


function loadEnv(callback) {
    fetch('.env')
        .then(function (res) {
            if (!res.ok) throw new Error("Could not fetch .env (status " + res.status + ")");
            return res.text();
        })
        .then(function (text) {
            var env = {};
            var lines = text.split('\n');
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line || line.indexOf('#') === 0) continue;
                var eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    var key = line.substring(0, eqIdx).trim();
                    var val = line.substring(eqIdx + 1).trim();
                    if ((val.indexOf('"') === 0 && val.lastIndexOf('"') === val.length - 1) ||
                        (val.indexOf("'") === 0 && val.lastIndexOf("'") === val.length - 1)) {
                        val = val.substring(1, val.length - 1);
                    }
                    env[key] = val;
                }
            }
            App.env = env;
            // Merge into APP_CONFIG
            App.config = App.config || {};
            for (var k in env) {
                if (env.hasOwnProperty(k)) {
                    App.config[k] = env[k];
                }
            }
            console.log("Environment variables loaded successfully from .env file:", Object.keys(env));
            if (callback) callback();
        })
        .catch(function (err) {
            console.log("Notice: .env file loading skipped or failed (normal in file:// mode or if .env is not present):", err.message);
            if (callback) callback();
        });
}

document.addEventListener("DOMContentLoaded", function () {
    loadEnv(function () {
        setupDragAndDrop();
        setupTabs();
        setupNewWorkbookButton();
        if (App.Perf && App.Perf.init) App.Perf.init();
        renderRecentWorkbooks();
        restoreLastWorkbook();
    });
});


function setupDragAndDrop() {
    var dropZone = document.getElementById("drop-zone");
    var fileInput = document.getElementById("file-input");

    dropZone.addEventListener("dragover", function (e) {
        e.preventDefault();
        dropZone.style.borderColor = "var(--success-color)";
    });

    dropZone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        dropZone.style.borderColor = "var(--accent-color)";
    });

    dropZone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropZone.style.borderColor = "var(--accent-color)";
        if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener("change", function (e) {
        if (e.target.files.length) {
            handleFiles(e.target.files);
        }
    });
}

// ---------------------------------------------------------------
// Persistence (notebook-style) — save after each load, restore on start,
// and expose the "Recent Workbooks" panel in the upload overlay.
// ---------------------------------------------------------------
function setupNewWorkbookButton() {
    var btn = document.getElementById("new-workbook-btn");
    if (btn) {
        btn.addEventListener("click", function () {
            var overlay = document.getElementById("upload-overlay");
            var dashboard = document.getElementById("dashboard");
            if (overlay) {
                overlay.classList.remove("hidden");
                overlay.style.display = "flex";
            }
            if (dashboard) dashboard.style.display = "none";
            renderRecentWorkbooks();
        });
    }

    var clearBtn = document.getElementById("clear-history-btn");
    if (clearBtn) {
        clearBtn.addEventListener("click", function () {
            if (!confirm("Clear all saved workbooks from this browser?")) return;
            if (App.Storage && App.Storage.clearWorkbooks) {
                App.Storage.clearWorkbooks().then(renderRecentWorkbooks);
            }
        });
    }
}

function formatBytes(bytes) {
    if (!bytes) return "";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
}

function renderRecentWorkbooks() {
    var list = document.getElementById("recent-workbooks-list");
    var panel = document.getElementById("recent-workbooks-panel");
    if (!list) return;
    if (!(App.Storage && App.Storage.listWorkbooks)) {
        if (panel) panel.style.display = "none";
        return;
    }
    App.Storage.listWorkbooks().then(function (workbooks) {
        if (!workbooks || workbooks.length === 0) {
            list.innerHTML = '<p class="recent-empty">No saved workbooks yet.</p>';
            if (panel) panel.style.display = "block";
            return;
        }
        list.innerHTML = "";
        workbooks.forEach(function (wb) {
            var item = document.createElement("div");
            item.className = "recent-item";
            var date = new Date(wb.timestamp || Date.now());
            var meta = wb.metadata || {};
            var sizeLabel = wb.sizeBytes ? formatBytes(wb.sizeBytes) : "";
            item.innerHTML =
                '<div class="recent-info">' +
                    '<strong class="recent-name"></strong>' +
                    '<span class="recent-meta"></span>' +
                '</div>' +
                '<div class="recent-actions">' +
                    '<button type="button" class="recent-load">Load</button>' +
                    '<button type="button" class="recent-del" aria-label="Delete">Delete</button>' +
                '</div>';
            item.querySelector('.recent-name').textContent = wb.name;
            item.querySelector('.recent-meta').textContent =
                date.toLocaleString() + ' · ' +
                (meta.sheets || 0) + ' sheets · ' +
                (meta.rows || 0) + ' rows' +
                (sizeLabel ? ' · ' + sizeLabel : '');
            item.querySelector('.recent-load').addEventListener("click", function () {
                loadSavedWorkbook(wb.id);
            });
            item.querySelector('.recent-del').addEventListener("click", function () {
                if (!confirm('Delete saved workbook "' + wb.name + '"?')) return;
                App.Storage.deleteWorkbook(wb.id).then(renderRecentWorkbooks);
            });
            list.appendChild(item);
        });
        if (panel) panel.style.display = "block";
    });
}

function loadSavedWorkbook(id) {
    if (!(App.Storage && App.Storage.loadWorkbook)) return;
    App.Storage.loadWorkbook(id).then(function (rec) {
        if (!rec || !rec.state || !rec.state.layers || rec.state.layers.length === 0) {
            if (App.UI && App.UI.toast) App.UI.toast('Could not load that workbook.', 'error');
            return;
        }
        applyWorkbookState(rec.state, rec.sourceNames, rec.sizeBytes);
        if (App.UI && App.UI.toast) App.UI.toast('Loaded workbook: ' + rec.name, 'success');
    });
}

function restoreLastWorkbook() {
    if (!(App.Storage && App.Storage.getCurrentWorkbookId && App.Storage.loadWorkbook)) return;
    var id = App.Storage.getCurrentWorkbookId();
    if (!id) return;
    App.Storage.loadWorkbook(id).then(function (rec) {
        if (!rec || !rec.state || !rec.state.layers || rec.state.layers.length === 0) return;
        applyWorkbookState(rec.state, rec.sourceNames, rec.sizeBytes);
        if (App.UI && App.UI.toast) App.UI.toast('Restored saved workbook: ' + rec.name, 'info');
    });
}

// Apply a persisted or freshly-parsed state to the app and render everything.
function applyWorkbookState(state, sourceNames, sizeBytes) {
    App.state.rawData = state.rawData || {};
    App.state.structuredData = state.structuredData || {};
    App.state.layers = state.layers || [];
    App.state.stats = state.stats || { layers: 0, entities: 0, transactions: 0, totalAmount: 0 };
    App.state.sheetIFSC = state.sheetIFSC || {};
    App.state.forceFullGraph = false;
    App.state.lastSearchQuery = "";
    App.state.mindMapReady = false;

    // Rebuild the search index (flat + inverted) after restore so it is never stale.
    App.state.searchIndex = buildSearchIndex(App.state.structuredData, App.state.layers);
    App.state.searchIndexMap = (App.Utils && App.Utils.buildInvertedIndex)
        ? App.Utils.buildInvertedIndex(App.state.searchIndex) : null;

    buildSheetColumnIndex(App.state.rawData, App.state.structuredData, App.state.layers);
    updateDashboardUI();

    App.state.currentSourceNames = sourceNames || [];
    App.state.currentSizeBytes = sizeBytes || 0;
}

// Called by every parse-completion path once state has been populated.
function finalizeWorkbookLoad(sourceNames, sizeBytes) {
    App.state.searchIndexMap = (App.Utils && App.Utils.buildInvertedIndex)
        ? App.Utils.buildInvertedIndex(App.state.searchIndex) : null;
    buildSheetColumnIndex(App.state.rawData, App.state.structuredData, App.state.layers);
    updateDashboardUI();
    App.state.currentSourceNames = sourceNames || [];
    App.state.currentSizeBytes = sizeBytes || 0;
    if (App.Storage && App.Storage.saveWorkbook) {
        App.Storage.saveWorkbook(App.state, App.state.currentSourceNames, App.state.currentSizeBytes);
    }
}

// ---------------------------------------------------------------
// Data helpers — used both by the main thread fallback AND
// serialized into the Web Worker via .toString() when possible.
// Keep them self-contained (no closures over window.*).
// ---------------------------------------------------------------
function getColumnNameByPattern(headers, patterns) {
    for (var h = 0; h < headers.length; h++) {
        var lower = headers[h].toLowerCase();
        for (var p = 0; p < patterns.length; p++) {
            if (lower.indexOf(patterns[p]) !== -1) return headers[h];
        }
    }
    return null;
}

function deduplicateSheetColumns(rawData) {
    var sheetNames = Object.keys(rawData);
    for (var s = 0; s < sheetNames.length; s++) {
        var sheetName = sheetNames[s];
        var sheetData = rawData[sheetName];
        var headers = sheetData.headers || [];
        var rows = sheetData.rows || [];
        if (headers.length === 0 || rows.length === 0) continue;

        var seenClean = {};
        var toRemove = [];
        var newHeaders = [];

        for (var i = 0; i < headers.length; i++) {
            var h = headers[i];
            var clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (seenClean[clean] !== undefined) {
                toRemove.push(h);
                continue;
            } else {
                seenClean[clean] = h;
            }
            newHeaders.push(h);
        }

        if (toRemove.length > 0) {
            sheetData.headers = newHeaders;
            for (var rIdx = 0; rIdx < rows.length; rIdx++) {
                var row = rows[rIdx];
                for (var rm = 0; rm < toRemove.length; rm++) {
                    delete row[toRemove[rm]];
                }
            }
        }
    }
}

function structureData(rawData, layerPatterns, primaryEntityPatterns) {
    var structured = {};
    var entitiesSet = {};
    var totalTxns = 0;
    var totalAmt = 0;
    var amountPatterns = ["amount", "amt"];
    var sheetNames = Object.keys(rawData);

    for (var si = 0; si < sheetNames.length; si++) {
        var sheetName = sheetNames[si];
        var headers = rawData[sheetName].headers;
        var rows = rawData[sheetName].rows;
        var layerCol = getColumnNameByPattern(headers, layerPatterns);
        var entityCol = getColumnNameByPattern(headers, primaryEntityPatterns);
        var amountCol = getColumnNameByPattern(headers, amountPatterns);

        if (!amountCol) {
            amountCol = 'Transaction Amount';
            if (headers.indexOf(amountCol) === -1) {
                headers.push(amountCol);
            }
        }

        for (var ri = 0; ri < rows.length; ri++) {
            var row = rows[ri];
            var isUnclassified = false;
            var layerVal = layerCol ? row[layerCol] : null;
            var entityVal = entityCol ? row[entityCol] : null;

            if (!layerVal || !entityVal) {
                isUnclassified = true;
                layerVal = "Unclassified Data";
                entityVal = "Unclassified Entity";
            }

            var layerKey = layerVal;
            if (!isUnclassified) {
                var layerMatch = String(layerVal).match(/\-?\d+/);
                var layerNum = layerMatch ? parseInt(layerMatch[0]) : 999;
                if (layerNum < 0) layerNum = Math.max(1, Math.abs(layerNum));
                layerKey = "Layer " + layerNum;
            }

            if (!structured[layerKey]) structured[layerKey] = {};
            if (!structured[layerKey][entityVal]) structured[layerKey][entityVal] = {};
            if (!structured[layerKey][entityVal][sheetName]) structured[layerKey][entityVal][sheetName] = [];

            structured[layerKey][entityVal][sheetName].push(row);
            entitiesSet[entityVal] = 1;
            totalTxns++;

            var amt = null;
            if (row[amountCol] !== null && row[amountCol] !== undefined && row[amountCol] !== "") {
                amt = parseAmountValue(row[amountCol]);
            }
            if ((amt === null || amt === 0) && row['Remarks']) {
                var remarkStr = String(row['Remarks']);
                var match = remarkStr.match(/(?:Rs|INR|Rupees)\.?\s*([\d,]+(?:\.\d+)?)/i);
                if (match) {
                    amt = parseFloat(match[1].replace(/,/g, ''));
                }
            }
            row[amountCol] = amt;

            if (amt !== null) totalAmt += amt;
        }
    }

    var layerKeys = Object.keys(structured).sort(function (a, b) {
        if (a === "Unclassified Data") return 1;
        if (b === "Unclassified Data") return -1;
        var numA = parseInt((a.match(/\-?\d+/) || [999])[0]);
        var numB = parseInt((b.match(/\-?\d+/) || [999])[0]);
        if (numA < 0 && numB >= 0) return 1;
        if (numB < 0 && numA >= 0) return -1;
        return numA - numB;
    });

    return {
        structuredData: structured,
        layers: layerKeys,
        stats: {
            layers: layerKeys.length,
            entities: Object.keys(entitiesSet).length,
            transactions: totalTxns,
            totalAmount: totalAmt
        }
    };
}

// Self-contained amount parser (no closures) — safe to embed in the Worker.
function parseAmountValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return (isFinite(value)) ? value : null;
    if (typeof value === 'boolean') return null;
    var str = String(value).trim();
    if (str === '') return null;
    var lower = str.toLowerCase().replace(/,/g, '');
    var negative = false;
    var m = lower.match(/^\(\s*(.+?)\s*\)$/);
    if (m) { negative = true; lower = m[1]; }
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
}

// Precompute, once per workbook, which sheet contains which column roles and
// which entities appear as receivers in money-transfer sheets of each layer.
// This removes repeated per-row header scanning from table rendering and makes
// the cross-layer "Linked from" check an O(1) Set lookup instead of an O(n) scan.
function buildSheetColumnIndex(rawData, structuredData, layers) {
    var colInfo = {};
    var receiverSets = {};

    Object.keys(rawData).forEach(function(sheetName) {
        var headers = rawData[sheetName].headers;
        var entityCol = App.Utils.findEntityCol(headers);
        var amountCol = App.Utils.findAmountCol(headers);
        var receiverCol = App.Utils.findReceiverCol(headers, entityCol);
        var isMoneyTransfer = App.Utils.isMoneyTransferSheet(sheetName, headers, entityCol);
        colInfo[sheetName] = {
            entityCol: entityCol,
            amountCol: amountCol,
            receiverCol: receiverCol,
            isMoneyTransfer: isMoneyTransfer
        };
    });

    for (var li = 0; li < layers.length; li++) {
        var layerKey = layers[li];
        var receiverSet = new Set();
        var entities = structuredData[layerKey] || {};
        var entityNames = Object.keys(entities);
        for (var ei = 0; ei < entityNames.length; ei++) {
            var sheets = entities[entityNames[ei]];
            var sheetNames = Object.keys(sheets);
            for (var si = 0; si < sheetNames.length; si++) {
                var sheetName = sheetNames[si];
                var info = colInfo[sheetName];
                if (!info || !info.isMoneyTransfer || !info.receiverCol) continue;
                var rows = sheets[sheetName];
                for (var ri = 0; ri < rows.length; ri++) {
                    var rcVal = rows[ri][info.receiverCol];
                    if (rcVal !== null && rcVal !== undefined && rcVal !== '') {
                        receiverSet.add(String(rcVal).trim());
                    }
                }
            }
        }
        receiverSets[layerKey] = receiverSet;
    }

    App.state.sheetColInfo = colInfo;
    App.state.layerReceiverSets = receiverSets;
}

function buildSearchIndex(structuredData, layers) {
    var index = [];
    for (var li = 0; li < layers.length; li++) {
        var layerKey = layers[li];
        var entities = structuredData[layerKey];
        var entityNames = Object.keys(entities);
        for (var ei = 0; ei < entityNames.length; ei++) {
            var entityName = entityNames[ei];
            var sheets = entities[entityName];
            var sheetNames = Object.keys(sheets);
            for (var si = 0; si < sheetNames.length; si++) {
                var sheetName = sheetNames[si];
                var rows = sheets[sheetName];
                for (var ri = 0; ri < rows.length; ri++) {
                    var row = rows[ri];
                    var vals = Object.values(row);
                    var parts = [];
                    for (var vi = 0; vi < vals.length; vi++) {
                        if (vals[vi] !== null && vals[vi] !== undefined) {
                            parts.push(String(vals[vi]).toLowerCase());
                        }
                    }
                    index.push({
                        normalizedText: parts.join(" "),
                        row: row,
                        layer: layerKey,
                        sheet: sheetName,
                        entity: entityName
                    });
                }
            }
        }
    }
    return index;
}

// ---------------------------------------------------------------
// File upload handler — supports multiple .xlsx files
// ---------------------------------------------------------------
function handleFiles(fileList) {
    // Reset per-upload state so a second upload never inherits stale data
    // from the previous workbook (sheet IFSC metadata, full-graph toggle).
    App.state.sheetIFSC = {};
    App.state.forceFullGraph = false;

    var files = [];
    for (var fi = 0; fi < fileList.length; fi++) {
        if (fileList[fi].name.endsWith(".xlsx")) files.push(fileList[fi]);
    }
    if (files.length === 0) {
        alert("Please upload at least one valid .xlsx file.");
        return;
    }

    var localLoading = document.getElementById("local-loading");
    var globalLoading = document.getElementById("global-loading-overlay");
    if (localLoading) {
        localLoading.style.display = "block";
        localLoading.querySelector("span").innerText = "Reading " + files.length + " Excel file(s)...";
    }
    if (globalLoading) {
        globalLoading.style.display = "flex";
        globalLoading.querySelector("p").innerText = "Reading " + files.length + " Excel file(s)...";
    }

    var isLocal = (window.location.protocol === "file:");
    console.log("Protocol:", window.location.protocol, "| Running", isLocal ? "LOCAL (file://)" : "SERVER", "mode");

    var sourceNames = files.map(function (f) { return f.name; });
    var totalBytes = 0;
    for (var bi = 0; bi < files.length; bi++) totalBytes += (files[bi].size || 0);

    // Read all files into ArrayBuffers first, then process sequentially
    var arrays = [];
    var readCount = 0;

    for (var fi = 0; fi < files.length; fi++) {
        (function (file, idx) {
            var reader = new FileReader();
            reader.onload = function (e) {
                arrays[idx] = { name: file.name, buffer: e.target.result };
                readCount++;
                if (readCount === files.length) {
                    // All files read — start processing
                    if (files.length === 1) {
                        // Single file: use existing optimized path (Worker if available)
                        var ab = arrays[0].buffer;
                        if (!isLocal) {
                            tryWorkerParsing(ab, localLoading, globalLoading, sourceNames, totalBytes);
                        } else {
                            parseMainThreadAsync(ab, localLoading, globalLoading, sourceNames, totalBytes);
                        }
                    } else {
                        // Multiple files: process sequentially on main thread, merge rawData
                        processMultipleFilesAsync(arrays, localLoading, globalLoading, sourceNames, totalBytes);
                    }
                }
            };
            reader.readAsArrayBuffer(file);
        })(files[fi], fi);
    }
}

// ---------------------------------------------------------------
// Web Worker path (HTTP/HTTPS only)
// ---------------------------------------------------------------
function tryWorkerParsing(arrayBuffer, localLoading, globalLoading, sourceNames, totalBytes) {
    if (localLoading) localLoading.querySelector("span").innerText = "Loading parser library...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Loading parser library...";

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "libs/xlsx.full.min.js", true);
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            runWorker(arrayBuffer, xhr.responseText, localLoading, globalLoading, sourceNames, totalBytes);
        } else {
            console.warn("XLSX library fetch returned status " + xhr.status + ", falling back to main-thread.");
            parseMainThreadAsync(arrayBuffer, localLoading, globalLoading, sourceNames, totalBytes);
        }
    };
    xhr.onerror = function () {
        console.warn("XLSX library fetch failed (network error), falling back to main-thread.");
        parseMainThreadAsync(arrayBuffer, localLoading, globalLoading, sourceNames, totalBytes);
    };
    xhr.send();
}

function runWorker(arrayBuffer, xlsxCode, localLoading, globalLoading, sourceNames, totalBytes) {
    if (localLoading) localLoading.querySelector("span").innerText = "Parsing workbook in background thread...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing & structuring data...";

    // Build worker source: XLSX library + helper functions + message handler.
    // The helpers are embedded via .toString() which is safe because they
    // have no closures over window.* — they only use their own arguments.
    var workerCode =
        xlsxCode + "\n" +
        getColumnNameByPattern.toString() + "\n" +
        App.Utils.normalizeHeaders.toString() + "\n" +
        App.Utils.buildRowObject.toString() + "\n" +
        parseAmountValue.toString() + "\n" +
        deduplicateSheetColumns.toString() + "\n" +
        structureData.toString() + "\n" +
        buildSearchIndex.toString() + "\n" +
        "self.onmessage = function(e) {\n" +
        "  var d = e.data;\n" +
        "  try {\n" +
        "    var wb = XLSX.read(d.arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });\n" +
        "    var raw = {};\n" +
        "    wb.SheetNames.forEach(function(sn) {\n" +
        "      var sh = wb.Sheets[sn];\n" +
        "      var rr = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });\n" +
        "      if (rr.length === 0) return;\n" +
        "      var hi = 0;\n" +
        "      for (var i = 0; i < Math.min(rr.length, 10); i++) {\n" +
        "        if (rr[i] && rr[i].filter(function(c){return c!==null&&c!=='';}).length > 2) { hi = i; break; }\n" +
        "      }\n" +
        "      var hd = normalizeHeaders(rr[hi]);\n" +
        "      var dr = [];\n" +
        "      for (var j = hi+1; j < rr.length; j++) {\n" +
        "        var r = rr[j];\n" +
        "        if (!r || r.length===0 || r.every(function(c){return c===null||c==='';})) continue;\n" +
        "        dr.push(buildRowObject(hd, r));\n" +
        "      }\n" +
        "      if (dr.length>0) raw[sn]={headers:hd,rows:dr};\n" +
        "    });\n" +
        "    deduplicateSheetColumns(raw);\n" +
        "    var res = structureData(raw, d.layerPatterns, d.primaryEntityPatterns);\n" +
        "    var idx = buildSearchIndex(res.structuredData, res.layers);\n" +
        "    self.postMessage({status:'success',rawData:raw,structuredData:res.structuredData,layers:res.layers,stats:res.stats,searchIndex:idx});\n" +
        "  } catch(err) {\n" +
        "    self.postMessage({status:'error',error:err.message||String(err)});\n" +
        "  }\n" +
        "};\n";

    var blob = new Blob([workerCode], { type: "application/javascript" });
    var workerUrl = URL.createObjectURL(blob);
    var worker = new Worker(workerUrl);

    worker.onmessage = function (evt) {
        var response = evt.data;
        if (response.status === "success") {
            App.state.rawData = response.rawData;
            App.state.structuredData = response.structuredData;
            App.state.layers = response.layers;
            App.state.stats = response.stats;
            App.state.searchIndex = response.searchIndex;
            App.state.mindMapReady = false;
            finalizeWorkbookLoad(sourceNames, totalBytes);
        } else {
            console.error("Worker parsing error:", response.error);
            alert("Error parsing workbook: " + response.error);
        }
        finishLoading(localLoading, globalLoading);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
    };

    worker.onerror = function (err) {
        console.warn("Worker error, falling back to main-thread:", err);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
    };

    worker.postMessage({
        arrayBuffer: arrayBuffer,
        primaryEntityPatterns: App.state.primaryEntityPatterns,
        layerPatterns: App.state.layerPatterns
    });
}

// ---------------------------------------------------------------
// Main-thread fallback (always works — XLSX is loaded via <script>)
// ---------------------------------------------------------------
function parseMainThreadAsync(arrayBuffer, localLoading, globalLoading, sourceNames, totalBytes) {
    if (localLoading) localLoading.querySelector("span").innerText = "Parsing workbook...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing workbook...";

    // Yield so the spinner paints before we block
    setTimeout(function () {
        try {
            var data = new Uint8Array(arrayBuffer);
            var workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, cellStyles: false });
            processWorkbookAsync(workbook, localLoading, globalLoading, sourceNames, totalBytes);
        } catch (error) {
            console.error("Error parsing workbook on main thread:", error);
            alert("Error parsing Excel file: " + (error.message || String(error)));
            finishLoading(localLoading, globalLoading);
        }
    }, 50);
}

// Sheet-by-sheet async processing to avoid blocking main thread
function processWorkbookAsync(workbook, localLoading, globalLoading, sourceNames, totalBytes) {
    var rawData = {};
    var sheetNames = workbook.SheetNames;
    var idx = 0;

    function parseNext() {
        if (idx >= sheetNames.length) {
            // All sheets parsed — structure and index
            deduplicateSheetColumns(rawData);
            if (localLoading) localLoading.querySelector("span").innerText = "Structuring data...";
            if (globalLoading) globalLoading.querySelector("p").innerText = "Structuring data...";

            setTimeout(function () {
                try {
                    var result = structureData(rawData, App.state.layerPatterns, App.state.primaryEntityPatterns);
                    var searchIndex = buildSearchIndex(result.structuredData, result.layers);

                    App.state.rawData = rawData;
                    App.state.structuredData = result.structuredData;
                    App.state.layers = result.layers;
                    App.state.stats = result.stats;
                    App.state.searchIndex = searchIndex;
                    App.state.mindMapReady = false;

                    finalizeWorkbookLoad(sourceNames, totalBytes);
                } catch (error) {
                    console.error("Error structuring data:", error);
                    alert("Error structuring data: " + error.message);
                } finally {
                    finishLoading(localLoading, globalLoading);
                }
            }, 50);
            return;
        }

        var sn = sheetNames[idx];
        if (localLoading) localLoading.querySelector("span").innerText = "Parsing sheet: " + sn + " (" + (idx + 1) + "/" + sheetNames.length + ")...";
        if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing sheet: " + sn + " (" + (idx + 1) + "/" + sheetNames.length + ")...";

        setTimeout(function () {
            try {
                var sheet = workbook.Sheets[sn];
                var rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

                if (rawRows.length > 0) {
                    var headerRowIndex = 0;
                    var detectedIFSC = null;
                    var ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i;

                    for (var i = 0; i < Math.min(rawRows.length, 10); i++) {
                        var row = rawRows[i];
                        if (row) {
                            for (var c = 0; c < row.length; c++) {
                                var val = String(row[c] || "");
                                var match = val.match(ifscRegex);
                                if (match) {
                                    detectedIFSC = match[1].toUpperCase();
                                }
                            }
                            if (row.filter(function (c) { return c !== null && c !== ""; }).length > 2) {
                                headerRowIndex = i;
                                break;
                            }
                        }
                    }

                    if (detectedIFSC) {
                        App.state.sheetIFSC[sn] = detectedIFSC;
                    }

                    var headers = App.Utils.normalizeHeaders(rawRows[headerRowIndex]);
                    var dataRows = [];

                    for (var j = headerRowIndex + 1; j < rawRows.length; j++) {
                        var rowArr = rawRows[j];
                        if (!rowArr || rowArr.length === 0 || rowArr.every(function (c) { return c === null || c === ""; })) continue;
                        dataRows.push(App.Utils.buildRowObject(headers, rowArr));
                    }

                    if (dataRows.length > 0) {
                        rawData[sn] = { headers: headers, rows: dataRows };
                    }
                }
            } catch (err) {
                console.error("Error parsing sheet " + sn + ":", err);
            }
            idx++;
            parseNext();
        }, 30);
    }

    parseNext();
}

// ---------------------------------------------------------------
// Multi-file async processor — parses each file and merges rawData
// ---------------------------------------------------------------
function processMultipleFilesAsync(arrays, localLoading, globalLoading, sourceNames, totalBytes) {
    var mergedRawData = {};
    var idx = 0;

    function parseNextFile() {
        if (idx >= arrays.length) {
            // All files parsed — structure and render
            deduplicateSheetColumns(mergedRawData);
            if (localLoading) localLoading.querySelector("span").innerText = "Structuring merged data...";
            if (globalLoading) globalLoading.querySelector("p").innerText = "Structuring merged data from " + arrays.length + " files...";

            setTimeout(function () {
                try {
                    var result = structureData(mergedRawData, App.state.layerPatterns, App.state.primaryEntityPatterns);
                    var searchIndex = buildSearchIndex(result.structuredData, result.layers);

                    App.state.rawData = mergedRawData;
                    App.state.structuredData = result.structuredData;
                    App.state.layers = result.layers;
                    App.state.stats = result.stats;
                    App.state.searchIndex = searchIndex;
                    App.state.mindMapReady = false;

                    finalizeWorkbookLoad(sourceNames, totalBytes);
                } catch (error) {
                    console.error("Error structuring merged data:", error);
                    alert("Error structuring merged data: " + error.message);
                } finally {
                    finishLoading(localLoading, globalLoading);
                }
            }, 50);
            return;
        }

        var fileInfo = arrays[idx];
        var msg = "Parsing " + fileInfo.name + " (" + (idx + 1) + "/" + arrays.length + ")...";
        if (localLoading) localLoading.querySelector("span").innerText = msg;
        if (globalLoading) globalLoading.querySelector("p").innerText = msg;

        setTimeout(function () {
            try {
                var data = new Uint8Array(fileInfo.buffer);
                var workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, cellStyles: false });

                workbook.SheetNames.forEach(function (sn) {
                    var sheet = workbook.Sheets[sn];
                    var rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

                    if (rawRows.length > 0) {
                        var headerRowIndex = 0;
                        var detectedIFSC = null;
                        var ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/i;

                        for (var i = 0; i < Math.min(rawRows.length, 10); i++) {
                            var row = rawRows[i];
                            if (row) {
                                for (var c = 0; c < row.length; c++) {
                                    var val = String(row[c] || "");
                                    var match = val.match(ifscRegex);
                                    if (match) {
                                        detectedIFSC = match[1].toUpperCase();
                                    }
                                }
                                if (row.filter(function (c) { return c !== null && c !== ""; }).length > 2) {
                                    headerRowIndex = i;
                                    break;
                                }
                            }
                        }

                        var headers = App.Utils.normalizeHeaders(rawRows[headerRowIndex]);
                        var dataRows = [];

                        for (var j = headerRowIndex + 1; j < rawRows.length; j++) {
                            var rowArr = rawRows[j];
                            if (!rowArr || rowArr.length === 0 || rowArr.every(function (c) { return c === null || c === ""; })) continue;
                            dataRows.push(App.Utils.buildRowObject(headers, rowArr));
                        }

                        if (dataRows.length > 0) {
                            // Avoid sheet name collisions across files
                            var sheetKey = sn;
                            if (mergedRawData[sn]) {
                                var baseName = fileInfo.name.replace(/\.xlsx$/i, '').replace(/[#?&]/g, '_');
                                sheetKey = sn + " [" + baseName + "]";
                            }
                            mergedRawData[sheetKey] = { headers: headers, rows: dataRows };

                            if (detectedIFSC) {
                                App.state.sheetIFSC[sheetKey] = detectedIFSC;
                            }
                        }
                    }
                });
            } catch (err) {
                console.error("Error parsing " + fileInfo.name + ":", err);
            }

            idx++;
            parseNextFile();
        }, 30);
    }

    parseNextFile();
}

function finishLoading(localLoading, globalLoading) {
    if (localLoading) localLoading.style.display = "none";
    if (globalLoading) globalLoading.style.display = "none";
}

// ---------------------------------------------------------------
// UI update
// ---------------------------------------------------------------
function updateDashboardUI() {
    document.getElementById("upload-overlay").classList.add("hidden");
    document.getElementById("dashboard").style.display = "flex";

    finishLoading(document.getElementById("local-loading"), document.getElementById("global-loading-overlay"));

    var exportBtn = document.getElementById("export-word-btn");
    if (exportBtn) exportBtn.style.display = "inline-block";

    document.getElementById("stat-layers").innerText = App.state.stats.layers;
    document.getElementById("stat-entities").innerText = App.state.stats.entities;
    document.getElementById("stat-txns").innerText = App.state.stats.transactions;

    var totalAmt = App.state.stats.totalAmount;
    // Use the new shared formatter to keep amounts consistent across dashboard, graph, and export
    document.getElementById("stat-amount").innerText = (App.formatters && App.formatters.amount) ? App.formatters.amount(totalAmt) : totalAmt;

    // --- DIAGNOSTICS & BULK RESOLUTION ---
    var diagnosticReport = {
        sheets: [],
        uniqueIFSCs: new Set(),
        resolutions: { api: 0, cache: 0, fallback: 0, failed: 0 },
        unclassifiedRows: 0
    };

    var rawData = App.state.rawData;
    var layers = App.state.layers || [];
    var structured = App.state.structuredData || {};
    var sheetColInfo = App.state.sheetColInfo || {};

    // Single pass over each sheet: detect IFSC presence and collect the unique
    // IFSC codes for that sheet (each row is scanned exactly once).
    var sheetIFSCSets = {};
    var seenIFSCGlobal = {};

    Object.keys(rawData).forEach(function(sheetName) {
        var sheetData = rawData[sheetName];
        var rows = sheetData.rows || [];
        var headers = sheetData.headers || [];
        var colInfo = sheetColInfo[sheetName] || {};

        var layerCol = getColumnNameByPattern(headers, App.state.layerPatterns);
        var entityCol = colInfo.entityCol || getColumnNameByPattern(headers, App.state.primaryEntityPatterns);

        var ifscFound = false;
        var ifscSource = 'none';

        // Check sheet metadata for IFSC
        if (App.state.sheetIFSC && App.state.sheetIFSC[sheetName]) {
            ifscFound = true;
            ifscSource = 'sheet_metadata';
        } else if (App.IFSC.hasIFSCData && App.IFSC.hasIFSCData(sheetName)) {
            ifscFound = true;
            ifscSource = 'header_or_row';
        }

        var sheetIFSCs = new Set();
        for (var i = 0; i < rows.length; i++) {
            // Unclassified rows stat
            if (!layerCol || !entityCol) {
                diagnosticReport.unclassifiedRows++;
            }
            if (App.IFSC.getRowIFSC) {
                var ifscVal = App.IFSC.getRowIFSC(sheetName, rows[i]);
                var code = App.IFSC.safeExtractIFSC ? App.IFSC.safeExtractIFSC(ifscVal) : (ifscVal && ifscVal.code ? ifscVal.code : null);
                if (code) {
                    var c = String(code).trim().toUpperCase();
                    sheetIFSCs.add(c);
                    seenIFSCGlobal[c] = true;
                }
            }
        }
        sheetIFSCSets[sheetName] = sheetIFSCs;
        if (sheetIFSCs.size > 0) {
            ifscFound = true;
            if (ifscSource === 'none') ifscSource = 'row_cell';
        }

        // Add to report
        diagnosticReport.sheets.push({
            name: sheetName,
            totalRows: rows.length,
            layerDetected: !!layerCol,
            entityDetected: !!entityCol,
            ifscDetected: ifscFound,
            ifscSource: ifscSource,
            virtualColumnShown: App.IFSC.hasIFSCData ? App.IFSC.hasIFSCData(sheetName) : ifscFound
        });

        sheetIFSCs.forEach(function(code) {
            diagnosticReport.uniqueIFSCs.add(code);
        });
    });

    // Build layer-priority ordered IFSC list grouped by layer.
    // Uses the per-sheet IFSC sets so no row is ever rescanned.
    var layerGroups = []; // Array of { layerKey: string, ifscs: Array }
    for (var lii = 0; lii < layers.length; lii++) {
        var lk = layers[lii];
        var entities = structured[lk];
        if (!entities) continue;
        var layerIFSCs = [];
        var addedInLayer = {};
        var enames = Object.keys(entities);
        for (var ei = 0; ei < enames.length; ei++) {
            var sheets = entities[enames[ei]];
            if (!sheets) continue;
            var snames = Object.keys(sheets);
            for (var si = 0; si < snames.length; si++) {
                var sheetSet = sheetIFSCSets[snames[si]];
                if (!sheetSet) continue;
                sheetSet.forEach(function(code) {
                    if (!addedInLayer[code]) {
                        addedInLayer[code] = true;
                        layerIFSCs.push(code);
                    }
                });
            }
        }
        if (layerIFSCs.length > 0) {
            layerGroups.push({ layerKey: lk, ifscs: layerIFSCs });
        }
    }

    // Sequentially resolve layer-by-layer, with a visible progress indicator.
    var groupIndex = 0;
    var allUniqueIFSC = Object.keys(seenIFSCGlobal);
    var resolvedCount = 0;

    function updateIfscProgress(done) {
        var el = document.getElementById("ifsc-progress");
        if (!el) return;
        var total = allUniqueIFSC.length;
        if (total === 0) {
            el.style.display = "none";
            return;
        }
        el.style.display = "flex";
        el.innerHTML = '<div class="spinner-small" style="margin-right:10px;"></div><span>Resolving bank addresses <strong>' + done + '</strong> of <strong>' + total + '</strong>... </span>';
    }

    function hideIfscProgress() {
        var el = document.getElementById("ifsc-progress");
        if (el) { el.style.display = "none"; el.innerHTML = ""; }
    }

    function resolveNextLayerGroup() {
        if (groupIndex >= layerGroups.length) {
            // Resolution complete. Tally stats based on cache.
            var cache = (App.IFSC && App.IFSC.getCache) ? (App.IFSC.getCache() || {}) : {};
            allUniqueIFSC.forEach(function(code) {
                var item = cache[code];
                if (!item) {
                    diagnosticReport.resolutions.failed++;
                } else if (item.status === 'resolved') {
                    diagnosticReport.resolutions.cache++;
                } else if (item.status === 'fallback') {
                    diagnosticReport.resolutions.fallback++;
                } else {
                    diagnosticReport.resolutions.failed++;
                }
            });
            hideIfscProgress();
            console.log("--- WORKBOOK DIAGNOSTIC REPORT ---", diagnosticReport);
            return;
        }

        var group = layerGroups[groupIndex];
        console.log("Starting bulk IFSC resolution for: " + group.layerKey + " (" + group.ifscs.length + " unique codes)");

        if (App.IFSC.startBulkIFSCResolution && group.ifscs.length > 0) {
            var groupBase = resolvedCount;
            App.IFSC.startBulkIFSCResolution(group.ifscs, function() {
                console.log("Completed bulk IFSC resolution for: " + group.layerKey);
                groupIndex++;
                resolveNextLayerGroup();
            }, function(completed) {
                resolvedCount = groupBase + completed;
                updateIfscProgress(resolvedCount);
            });
        } else {
            groupIndex++;
            resolveNextLayerGroup();
        }
    }

    if (layerGroups.length > 0) {
        resolveNextLayerGroup();
    } else {
        console.log("--- WORKBOOK DIAGNOSTIC REPORT ---", diagnosticReport);
    }

    // --- END DIAGNOSTICS ---

    if (App.Table.renderSidebarAndTables) {
        App.Table.renderSidebarAndTables();
    }

    // Reset mind map — deferred until user clicks the tab
    App.state.mindMapReady = false;
    if (App.state.cy) {
        App.state.cy.destroy();
        App.state.cy = null;
    }
    // Warn about very large workbooks (memory / row-count monitor)
    if (App.Perf && App.Perf.warnRowCount) {
        App.Perf.warnRowCount(App.state.stats ? App.state.stats.transactions : 0);
    }
    // If the graph tab is currently active, rebuild immediately
    var graphTab = document.querySelector('.tab-btn[data-target="graph-view"]');
    if (graphTab && graphTab.classList.contains("active") && App.state.layers.length > 0) {
        var cyContainer = document.getElementById("cy");
        if (cyContainer) {
            cyContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;"><div class="spinner-small" style="margin-right:10px;"></div> Building graph...</div>';
        }
        setTimeout(function () {
            if (App.Graph.initMindMap) App.Graph.initMindMap();
        }, 50);
    }
}

function setupTabs() {
    var tabs = document.querySelectorAll(".tab-btn");
    var panels = document.querySelectorAll(".view-panel");

    tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            tabs.forEach(function (t) { t.classList.remove("active"); });
            panels.forEach(function (p) { p.classList.remove("active"); });

            tab.classList.add("active");
            document.getElementById(tab.dataset.target).classList.add("active");

            // Lazy mind-map init
            if (tab.dataset.target === "graph-view") {
                if (!App.state.mindMapReady && App.state.layers.length > 0) {
                    var cy = document.getElementById("cy");
                    if (cy) {
                        cy.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;"><div class="spinner-small" style="margin-right:10px;"></div> Building graph...</div>';
                    }
                    setTimeout(function () {
                        if (App.Graph.initMindMap) App.Graph.initMindMap();
                    }, 50);
                } else if (App.state.cy) {
                    App.state.cy.resize();
                    App.state.cy.fit();
                }
            }
        });
    });
}

})(window.PersonallApp);
