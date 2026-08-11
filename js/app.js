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
    mindMapReady: false,
    primaryEntityPatterns: ["account no", "wallet", "pg", "pa", "id", "account no./(wallet/pg/pa) id"],
    layerPatterns: ["layer", "layer no", "lyr"],
    sheetIFSC: {}
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
                var layerMatch = String(layerVal).match(/\d+/);
                var layerNum = layerMatch ? parseInt(layerMatch[0]) : 999;
                layerKey = "Layer " + layerNum;
            }

            if (!structured[layerKey]) structured[layerKey] = {};
            if (!structured[layerKey][entityVal]) structured[layerKey][entityVal] = {};
            if (!structured[layerKey][entityVal][sheetName]) structured[layerKey][entityVal][sheetName] = [];

            structured[layerKey][entityVal][sheetName].push(row);
            entitiesSet[entityVal] = 1;
            totalTxns++;

            if (amountCol && row[amountCol] !== null && row[amountCol] !== undefined && row[amountCol] !== "") {
                var amt = parseAmountValue(row[amountCol]);
                if (amt !== null) totalAmt += amt;
            }
        }
    }

    var layerKeys = Object.keys(structured).sort(function (a, b) {
        if (a === "Unclassified Data") return 1;
        if (b === "Unclassified Data") return -1;
        var numA = parseInt((a.match(/\d+/) || [999])[0]);
        var numB = parseInt((b.match(/\d+/) || [999])[0]);
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
    var entityColCache = {};

    function findEntityCol(headers) {
        var patterns = App.state.primaryEntityPatterns || [];
        for (var h = 0; h < headers.length; h++) {
            var lower = headers[h].toLowerCase();
            for (var p = 0; p < patterns.length; p++) {
                if (lower.indexOf(patterns[p]) !== -1) return headers[h];
            }
        }
        return null;
    }

    function findAmountCol(headers) {
        for (var h = 0; h < headers.length; h++) {
            if (App.Utils.isAmountHeader(headers[h])) return headers[h];
        }
        return null;
    }

    Object.keys(rawData).forEach(function(sheetName) {
        var headers = rawData[sheetName].headers;
        var entityCol = findEntityCol(headers);
        var amountCol = findAmountCol(headers);
        var receiverCol = null;
        for (var h = 0; h < headers.length; h++) {
            if (headers[h] !== entityCol && App.Utils.isReceiverHeader(headers[h], entityCol)) {
                receiverCol = headers[h];
                break;
            }
        }
        var isMoneyTransfer = App.Utils.isMoneyTransferSheet(sheetName) || receiverCol !== null;
        colInfo[sheetName] = {
            entityCol: entityCol,
            amountCol: amountCol,
            receiverCol: receiverCol,
            isMoneyTransfer: isMoneyTransfer
        };
        entityColCache[sheetName] = entityCol;
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
                            tryWorkerParsing(ab, localLoading, globalLoading);
                        } else {
                            parseMainThreadAsync(ab, localLoading, globalLoading);
                        }
                    } else {
                        // Multiple files: process sequentially on main thread, merge rawData
                        processMultipleFilesAsync(arrays, localLoading, globalLoading);
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
function tryWorkerParsing(arrayBuffer, localLoading, globalLoading) {
    if (localLoading) localLoading.querySelector("span").innerText = "Loading parser library...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Loading parser library...";

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "libs/xlsx.full.min.js", true);
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            runWorker(arrayBuffer, xhr.responseText, localLoading, globalLoading);
        } else {
            console.warn("XLSX library fetch returned status " + xhr.status + ", falling back to main-thread.");
            parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
        }
    };
    xhr.onerror = function () {
        console.warn("XLSX library fetch failed (network error), falling back to main-thread.");
        parseMainThreadAsync(arrayBuffer, localLoading, globalLoading);
    };
    xhr.send();
}

function runWorker(arrayBuffer, xlsxCode, localLoading, globalLoading) {
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
            buildSheetColumnIndex(App.state.rawData, App.state.structuredData, App.state.layers);
            updateDashboardUI();
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
function parseMainThreadAsync(arrayBuffer, localLoading, globalLoading) {
    if (localLoading) localLoading.querySelector("span").innerText = "Parsing workbook...";
    if (globalLoading) globalLoading.querySelector("p").innerText = "Parsing workbook...";

    // Yield so the spinner paints before we block
    setTimeout(function () {
        try {
            var data = new Uint8Array(arrayBuffer);
            var workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, cellStyles: false });
            processWorkbookAsync(workbook, localLoading, globalLoading);
        } catch (error) {
            console.error("Error parsing workbook on main thread:", error);
            alert("Error parsing Excel file: " + (error.message || String(error)));
            finishLoading(localLoading, globalLoading);
        }
    }, 50);
}

// Sheet-by-sheet async processing to avoid blocking main thread
function processWorkbookAsync(workbook, localLoading, globalLoading) {
    var rawData = {};
    var sheetNames = workbook.SheetNames;
    var idx = 0;

    function parseNext() {
        if (idx >= sheetNames.length) {
            // All sheets parsed — structure and index
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

                    buildSheetColumnIndex(App.state.rawData, App.state.structuredData, App.state.layers);
                    updateDashboardUI();
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
function processMultipleFilesAsync(arrays, localLoading, globalLoading) {
    var mergedRawData = {};
    var idx = 0;

    function parseNextFile() {
        if (idx >= arrays.length) {
            // All files parsed — structure and render
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

                    buildSheetColumnIndex(App.state.rawData, App.state.structuredData, App.state.layers);
                    updateDashboardUI();
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

    // Sequentially resolve layer-by-layer
    var groupIndex = 0;
    function resolveNextLayerGroup() {
        if (groupIndex >= layerGroups.length) {
            // Resolution complete. Tally stats based on cache.
            var cache = (App.IFSC && App.IFSC.getCache) ? (App.IFSC.getCache() || {}) : {};
            var allCodes = Object.keys(seenIFSCGlobal);
            allCodes.forEach(function(code) {
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
            console.log("--- WORKBOOK DIAGNOSTIC REPORT ---", diagnosticReport);
            return;
        }

        var group = layerGroups[groupIndex];
        console.log("Starting bulk IFSC resolution for: " + group.layerKey + " (" + group.ifscs.length + " unique codes)");
        
        if (App.IFSC.startBulkIFSCResolution && group.ifscs.length > 0) {
            App.IFSC.startBulkIFSCResolution(group.ifscs, function() {
                console.log("Completed bulk IFSC resolution for: " + group.layerKey);
                groupIndex++;
                resolveNextLayerGroup();
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
