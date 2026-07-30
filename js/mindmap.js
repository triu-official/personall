// Mind map and graph visualization logic using Cytoscape.js
window.initMindMap = function() {
    try {
        if (window.appState.cy) {
            window.appState.cy.destroy();
        }

        var totalTxns = window.appState.stats ? window.appState.stats.transactions : 0;
        var threshold = 500;
        var isOverThreshold = totalTxns > threshold;
        var aggregateMode = isOverThreshold && !window.appState.forceFullGraph;

        var banner = document.getElementById("graph-perf-banner");
        if (banner) {
            if (isOverThreshold) {
                banner.style.display = "flex";
                if (aggregateMode) {
                    banner.innerHTML = '<span><strong>Performance Mode Active:</strong> Similar terminal transactions and duplicate transfers are grouped (' + totalTxns + ' total transactions).</span><button id="btn-force-full-graph">Show Full Graph</button>';
                    document.getElementById("btn-force-full-graph").addEventListener("click", function () {
                        window.appState.forceFullGraph = true;
                        window.initMindMap();
                    });
                } else {
                    banner.innerHTML = '<span><strong>Full Graph Mode Active:</strong> All ' + totalTxns + ' transactions rendered.</span><button id="btn-reset-perf-graph">Switch to Aggregated</button>';
                    document.getElementById("btn-reset-perf-graph").addEventListener("click", function () {
                        window.appState.forceFullGraph = false;
                        window.initMindMap();
                    });
                }
            } else {
                banner.style.display = "none";
                banner.innerHTML = "";
            }
        }

        var elements = generateGraphElements(aggregateMode);

        // Layer-based color palette — each layer gets a distinct, high-contrast color
        var layerColors = [
            '#2980b9', // Layer 1 — strong blue
            '#27ae60', // Layer 2 — green
            '#e67e22', // Layer 3 — orange
            '#8e44ad', // Layer 4 — purple
            '#e74c3c', // Layer 5 — red
            '#16a085', // Layer 6 — teal
            '#d35400', // Layer 7 — dark orange
            '#2c3e50', // Layer 8 — dark blue-grey
            '#f39c12', // Layer 9 — gold
            '#1abc9c'  // Layer 10 — mint
        ];
        var unclassifiedColor = '#5d6d7e'; // grey for unclassified

        // Build dynamic styles that reference node data (strictly ES5)
        var dynamicStyle = [
            {
                selector: 'node[type="entity"]',
                style: {
                    'label': 'data(label)',
                    'color': '#ffffff',
                    'font-size': '14px',
                    'font-weight': 'bold',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': '8px',
                    'width': 65,
                    'height': 65,
                    'border-width': 5,
                    'shape': 'ellipse',
                    'text-outline-color': '#ffffff',
                    'text-outline-width': 2
                }
            }
        ];

        // Add per-layer selectors to dynamicStyle (avoiding ES6 spread operator)
        for (var lIdx = 0; lIdx < layerColors.length; lIdx++) {
            dynamicStyle.push({
                selector: 'node[type="entity"][layer=' + (lIdx + 1) + ']',
                style: {
                    'background-color': layerColors[lIdx],
                    'border-color': layerColors[lIdx]
                }
            });
        }

        // Add the remaining style objects
        dynamicStyle.push(
            {
                selector: 'node[type="entity"][layerStr="Unclassified Data"]',
                style: {
                    'background-color': unclassifiedColor,
                    'border-color': unclassifiedColor
                }
            },
            {
                selector: 'node[type="terminal"]',
                style: {
                    'background-color': '#c0392b',
                    'label': 'data(label)',
                    'color': '#333333',
                    'font-size': '11px',
                    'font-weight': 'bold',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': '5px',
                    'text-outline-color': '#ffffff',
                    'text-outline-width': 2,
                    'width': 25,
                    'height': 25,
                    'shape': 'diamond',
                    'border-width': 3,
                    'border-color': '#962d22',
                    'text-wrap': 'wrap',
                    'text-max-width': '100px'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#7f8c8d',
                    'target-arrow-color': '#7f8c8d',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(amount)',
                    'font-size': '10px',
                    'font-weight': 'bold',
                    'text-rotation': 'autorotate',
                    'text-margin-y': '-12px',
                    'color': '#2c3e50',
                    'text-outline-color': '#ffffff',
                    'text-outline-width': 1.5
                }
            },
            {
                selector: 'edge[type="money_transfer"]',
                style: {
                    'line-color': '#2980b9',
                    'target-arrow-color': '#2980b9',
                    'line-style': 'solid',
                    'width': 4
                }
            },
            {
                selector: 'edge[type="terminal_flow"]',
                style: {
                    'line-style': 'dashed',
                    'line-color': '#d35400',
                    'target-arrow-color': '#d35400',
                    'width': 3
                }
            },
            {
                selector: 'node[type="entity"]:active',
                style: {
                    'overlay-opacity': 0.15,
                    'overlay-color': '#ffffff'
                }
            },
            {
                selector: 'node[type="terminal"]:active',
                style: {
                    'overlay-opacity': 0.15,
                    'overlay-color': '#ffffff'
                }
            }
        );

        var cyContainer = document.getElementById('cy');
        if (!cyContainer) return;
        cyContainer.innerHTML = "";

        if (!elements || !elements.nodes || elements.nodes.length === 0) {
            cyContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;">No graph data available — add transactions with layer and account information.</div>';
            return;
        }

        cyContainer.style.display = 'block';

        var cy = cytoscape({
            container: cyContainer,
            elements: elements,
            style: dynamicStyle,
            layout: getLayoutOptions(document.getElementById("toggle-layout") ? document.getElementById("toggle-layout").checked : false),
            minZoom: 0.1,
            maxZoom: 5,
            wheelSensitivity: 0.5
        });

        cy.resize();

        // Fit the graph to the viewport after layout completes
        cy.one('layoutstop', function() {
            cy.fit(undefined, 30);
            cy.center();
        });

        window.appState.cy = cy;

        // Hover effects — scale up entity on mouseover for discoverability
        cy.on('mouseover', 'node[type="entity"]', function(evt) {
            evt.target.style('width', 80);
            evt.target.style('height', 80);
            evt.target.style('font-size', '16px');
            evt.target.style('z-index', 999);
        });
        cy.on('mouseout', 'node[type="entity"]', function(evt) {
            evt.target.removeStyle('width height font-size z-index');
        });

        // Interaction: show details on click
        cy.on('tap', 'node', function(evt){
            var node = evt.target;
            if (node.data('type') === 'entity') {
                document.getElementById('global-search').value = node.data('id');
                if (window.performSearch) {
                    window.performSearch();
                }
                document.querySelector('.tab-btn[data-target="table-view"]').click();
            }
        });

        // Initial highlight for the active layer
        var activeLi = document.querySelector('#layer-navigator li.active');
        if (activeLi) {
            var layerKey = activeLi.childNodes[0].textContent.trim();
            window.highlightLayerInGraph(cy, layerKey);
        }
        window.appState.mindMapReady = true;
    } catch(e) {
        console.error("MindMap init error:", e);
        window.appState.mindMapReady = false;
        var cyEl = document.getElementById('cy');
        if (cyEl) cyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#e74c3c;font-size:14px;">Graph Error: ' + e.message + '</div>';
    }
};

window.highlightLayerInGraph = function(cy, layerKey) {
    if (!cy) return;

    cy.elements().style({
        'opacity': 1,
        'overlay-opacity': 0
    });

    if (layerKey && window.appState && window.appState.layers) {
        var expectedIdx = window.appState.layers.indexOf(layerKey) + 1;
        var selectedNodes = cy.nodes().filter(function(n) {
            var nodeLayerIdx = n.data('layer');
            return nodeLayerIdx === expectedIdx || (layerKey === "Unclassified Data" && n.data('layerStr') === "Unclassified Data");
        });

        if (selectedNodes.length > 0) {
            selectedNodes.style('opacity', 1);
            selectedNodes.connectedEdges().style('opacity', 1);
            cy.elements().not(selectedNodes).not(selectedNodes.connectedEdges()).style('opacity', 0.15);
        }
    }
};

function isSheetMoneyTransfer(sheetName, sampleRow) {
    var lowerName = sheetName.toLowerCase();
    if (lowerName.indexOf("money transfer") !== -1 || lowerName.indexOf("transfer") !== -1 || lowerName.indexOf("fund flow") !== -1) {
        return true;
    }
    if (!sampleRow) return false;

    var rowKeys = Object.keys(sampleRow);
    var entityCol = null;
    var primaryPatterns = window.appState.primaryEntityPatterns || [];

    // Find primary entity column in this row
    for (var i = 0; i < rowKeys.length; i++) {
        var kl = rowKeys[i].toLowerCase();
        for (var p = 0; p < primaryPatterns.length; p++) {
            if (kl.indexOf(primaryPatterns[p]) !== -1) {
                entityCol = rowKeys[i];
                break;
            }
        }
        if (entityCol) break;
    }

    // Look for a distinct receiver column
    for (var i = 0; i < rowKeys.length; i++) {
        var kl = rowKeys[i].toLowerCase();
        if (rowKeys[i] === entityCol) continue;

        if (kl.indexOf("to account") !== -1 || 
            kl.indexOf("beneficiary") !== -1 || 
            kl.indexOf("receiver") !== -1 || 
            kl.indexOf("transferred to") !== -1 || 
            kl.indexOf("destination") !== -1 ||
            kl === "account no" ||
            kl === "to_account" ||
            kl === "toacc") {
            return true;
        }
    }
    return false;
}

function generateGraphElements(aggregateMode) {
    var elements = { nodes: [], edges: [] };
    var structured = window.appState.structuredData;
    var layers = window.appState.layers;
    var query = window.lastSearchQuery || "";
    if (!structured || !layers || !layers.length) return elements;

    var addedNodes = {};
    var terminalNodeIdCounter = 0;

    // Aggregation maps
    var moneyTransferMap = {};
    var terminalFlowMap = {};

    for (var li = 0; li < layers.length; li++) {
        var layerKey = layers[li];
        var layerIndex = li;
        var entities = structured[layerKey];
        if (!entities) continue;

        var entityNames = Object.keys(entities);
        for (var ei = 0; ei < entityNames.length; ei++) {
            var entityName = entityNames[ei];
            var cleanEntityId = String(entityName).trim();
            var sheets = entities[entityName];
            if (!sheets) continue;

            var sheetNames = Object.keys(sheets);
            for (var si = 0; si < sheetNames.length; si++) {
                var sheetName = sheetNames[si];
                var rows = sheets[sheetName];
                if (!rows || !rows.length) continue;

                var isMoneyTransfer = isSheetMoneyTransfer(sheetName, rows[0]);

                for (var ri = 0; ri < rows.length; ri++) {
                    var row = rows[ri];
                    // Filter row by search query if active
                    if (query !== "") {
                        var rowVals = [];
                        var tempKeys = Object.keys(row);
                        for (var tki = 0; tki < tempKeys.length; tki++) {
                            rowVals.push(row[tempKeys[tki]]);
                        }
                        var rowStr = "";
                        for (var vi = 0; vi < rowVals.length; vi++) {
                            if (rowVals[vi] !== null && rowVals[vi] !== undefined) {
                                rowStr += String(rowVals[vi]).toLowerCase() + " ";
                            }
                        }
                        if (rowStr.indexOf(query) === -1) continue;
                    }

                    // Add sender node
                    if (!addedNodes[cleanEntityId]) {
                        elements.nodes.push({
                            data: {
                                id: cleanEntityId,
                                label: cleanEntityId,
                                type: 'entity',
                                layer: layerIndex + 1,
                                layerStr: layerKey
                            }
                        });
                        addedNodes[cleanEntityId] = true;
                    }

                    var rowKeys = Object.keys(row);
                    var entityCol = null;
                    for (var ki = 0; ki < rowKeys.length; ki++) {
                        var kl = rowKeys[ki].toLowerCase();
                        for (var pi = 0; pi < window.appState.primaryEntityPatterns.length; pi++) {
                            if (kl.indexOf(window.appState.primaryEntityPatterns[pi]) !== -1) {
                                entityCol = rowKeys[ki];
                                break;
                            }
                        }
                        if (entityCol) break;
                    }

                    var amountCol = null;
                    for (var ki = 0; ki < rowKeys.length; ki++) {
                        if (rowKeys[ki].toLowerCase().indexOf("amount") !== -1) {
                            amountCol = rowKeys[ki];
                            break;
                        }
                    }
                    var amountVal = amountCol ? row[amountCol] : "";
                    var amountNum = parseAmount(amountVal);

                    if (isMoneyTransfer) {
                        var receiverCol = null;
                        for (var ki = 0; ki < rowKeys.length; ki++) {
                            var kl = rowKeys[ki].toLowerCase();
                            if (rowKeys[ki] === entityCol) continue; // Skip sender column

                            if (kl.indexOf("to account") !== -1 || 
                                kl.indexOf("beneficiary") !== -1 || 
                                kl.indexOf("receiver") !== -1 || 
                                kl.indexOf("transferred to") !== -1 || 
                                kl.indexOf("destination") !== -1 ||
                                kl === "account no" ||
                                kl === "to_account" ||
                                kl === "toacc") {
                                receiverCol = rowKeys[ki];
                                break;
                            }
                        }
                        var receiverId = receiverCol ? String(row[receiverCol]).trim() : null;

                        if (receiverId && receiverId !== cleanEntityId) {
                            if (!addedNodes[receiverId]) {
                                elements.nodes.push({
                                    data: {
                                        id: receiverId,
                                        label: receiverId,
                                        type: 'entity',
                                        layer: layerIndex + 2,
                                        layerStr: layerKey
                                    }
                                });
                                addedNodes[receiverId] = true;
                            }

                            if (aggregateMode) {
                                var edgeKey = cleanEntityId + "_to_" + receiverId;
                                if (!moneyTransferMap[edgeKey]) {
                                    moneyTransferMap[edgeKey] = {
                                        source: cleanEntityId,
                                        target: receiverId,
                                        amountSum: 0,
                                        count: 0
                                    };
                                }
                                moneyTransferMap[edgeKey].amountSum += amountNum;
                                moneyTransferMap[edgeKey].count += 1;
                            } else {
                                elements.edges.push({
                                    data: {
                                        id: cleanEntityId + "_to_" + receiverId + "_edge_" + ri + "_" + layerIndex,
                                        source: cleanEntityId,
                                        target: receiverId,
                                        type: 'money_transfer',
                                        amount: formatAmount(amountNum)
                                    }
                                });
                            }
                        }
                    } else {
                        if (aggregateMode) {
                            var edgeKey = cleanEntityId + "_to_" + sheetName;
                            if (!terminalFlowMap[edgeKey]) {
                                terminalFlowMap[edgeKey] = {
                                    source: cleanEntityId,
                                    sheetName: sheetName,
                                    amountSum: 0,
                                    count: 0,
                                    layerIndex: layerIndex,
                                    layerKey: layerKey
                                };
                            }
                            terminalFlowMap[edgeKey].amountSum += amountNum;
                            terminalFlowMap[edgeKey].count += 1;
                        } else {
                            var termId = "term_" + (terminalNodeIdCounter++);
                            elements.nodes.push({
                                data: {
                                    id: termId,
                                    label: getShortLabel(sheetName),
                                    type: 'terminal',
                                    layer: layerIndex + 1,
                                    layerStr: layerKey
                                }
                            });
                            elements.edges.push({
                                data: {
                                    id: cleanEntityId + "_to_" + termId + "_edge",
                                    source: cleanEntityId,
                                    target: termId,
                                    type: 'terminal_flow',
                                    amount: formatAmount(amountNum)
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    // Helper to parse amount
    function parseAmount(val) {
        if (!val) return 0;
        var num = parseFloat(String(val).replace(/,/g, ''));
        return isNaN(num) ? 0 : num;
    }

    // Map aggregated elements into output lists
    if (aggregateMode) {
        // 1. Add aggregated money transfers
        var mtKeys = Object.keys(moneyTransferMap);
        for (var mti = 0; mti < mtKeys.length; mti++) {
            var edgeKey = mtKeys[mti];
            var data = moneyTransferMap[edgeKey];
            elements.edges.push({
                data: {
                    id: edgeKey,
                    source: data.source,
                    target: data.target,
                    type: 'money_transfer',
                    amount: formatAmount(data.amountSum) + " (" + data.count + " txns)"
                }
            });
        }

        // 2. Add aggregated terminal nodes and edges
        var terminalCounter = 0;
        var tfKeys = Object.keys(terminalFlowMap);
        for (var tfi = 0; tfi < tfKeys.length; tfi++) {
            var edgeKey = tfKeys[tfi];
            var data = terminalFlowMap[edgeKey];
            var termNodeId = "term_agg_" + (terminalCounter++);
            elements.nodes.push({
                data: {
                    id: termNodeId,
                    label: getShortLabel(data.sheetName),
                    type: 'terminal',
                    layer: data.layerIndex + 1,
                    layerStr: data.layerKey
                }
            });

            elements.edges.push({
                data: {
                    id: edgeKey,
                    source: data.source,
                    target: termNodeId,
                    type: 'terminal_flow',
                    amount: formatAmount(data.amountSum) + " (" + data.count + " txns)"
                }
            });
        }
    }

    return elements;
}

function getLayoutOptions(isSwimlane) {
    if (isSwimlane) {
        return {
            name: 'breadthfirst',
            directed: true,
            padding: 30,
            spacingFactor: 1.5,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: true,
            roots: undefined
        };
    } else {
        return {
            name: 'concentric',
            concentric: function(node) {
                var maxLayer = window.appState.layers.length + 1;
                return maxLayer - (node.data('layer') || 1);
            },
            levelWidth: function() {
                return 1;
            },
            padding: 40,
            spacingFactor: 1.5,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: true
        };
    }
}

// Delegated to global app.js for consistency
function formatAmount(val) {
    if (window.formatAmount) return window.formatAmount(val);
    return val;
}

function getShortLabel(sheetName) {
    // Return the actual sheet name directly to ensure all information is reflected.
    // E.g. "Withdrawal through ATM", "Cash Withdrawal through Cheque", "Others Less Than 500"
    return sheetName;
}

document.addEventListener("DOMContentLoaded", function () {
    var layoutToggle = document.getElementById("toggle-layout");
    if (layoutToggle) {
        layoutToggle.addEventListener("change", function (e) {
            if (window.appState && window.appState.cy) {
                var isSwimlane = e.target.checked;
                var layout = window.appState.cy.layout(getLayoutOptions(isSwimlane));
                layout.run();
            }
        });
    }

    // Zoom Controls
    var btnZoomIn = document.getElementById("btn-zoom-in");
    if (btnZoomIn) {
        btnZoomIn.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.zoom(window.appState.cy.zoom() * 1.3);
            }
        });
    }

    var btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomOut) {
        btnZoomOut.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.zoom(window.appState.cy.zoom() / 1.3);
            }
        });
    }

    var btnZoomFit = document.getElementById("btn-zoom-fit");
    if (btnZoomFit) {
        btnZoomFit.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.fit(undefined, 30);
                window.appState.cy.center();
            }
        });
    }

    // Fullscreen Controls
    var btnFullscreen = document.getElementById("btn-fullscreen");
    if (btnFullscreen) {
        btnFullscreen.addEventListener("click", function() {
            var graphView = document.getElementById("graph-view");
            if (graphView) {
                var isFullscreen = graphView.classList.toggle("fullscreen");
                btnFullscreen.classList.toggle("active", isFullscreen);
                setTimeout(function() {
                    if (window.appState && window.appState.cy) {
                        window.appState.cy.resize();
                        window.appState.cy.fit(undefined, 30);
                        window.appState.cy.center();
                    }
                }, 100);
            }
        });
    }

    // Pan Controls
    var panDistance = 60;
    var btnPanUp = document.getElementById("btn-pan-up");
    if (btnPanUp) {
        btnPanUp.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.panBy({ x: 0, y: panDistance });
            }
        });
    }

    var btnPanDown = document.getElementById("btn-pan-down");
    if (btnPanDown) {
        btnPanDown.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.panBy({ x: 0, y: -panDistance });
            }
        });
    }

    var btnPanLeft = document.getElementById("btn-pan-left");
    if (btnPanLeft) {
        btnPanLeft.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.panBy({ x: panDistance, y: 0 });
            }
        });
    }

    var btnPanRight = document.getElementById("btn-pan-right");
    if (btnPanRight) {
        btnPanRight.addEventListener("click", function() {
            if (window.appState && window.appState.cy) {
                window.appState.cy.panBy({ x: -panDistance, y: 0 });
            }
        });
    }

    // Ensure graph view has proper height whenever it becomes visible
    var graphView = document.getElementById("graph-view");
    if (graphView) {
        var observer = new MutationObserver(function () {
            if (graphView.style.display !== "none" && window.appState && window.appState.cy) {
                window.appState.cy.resize();
                window.appState.cy.fit(undefined, 30);
            }
        });
        observer.observe(graphView, { attributes: true, attributeFilter: ["style", "class"] });
    }
});
