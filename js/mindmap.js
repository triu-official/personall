(function(App) {
    'use strict';

    var Graph = App.Graph || {};

// ------------------------------------------------------------------
// Theme system — dark palette by default, light optional. Persisted.
// ------------------------------------------------------------------
var THEME_KEY = 'personall_graph_theme';

function extractNameFromRemark(remark) {
    if (!remark || remark === 'null') return null;
    var str = String(remark).trim();
    if (str === '') return null;

    if (str.toUpperCase().indexOf('IB:') === 0) {
        return str.substring(3).trim();
    }

    if (str.toUpperCase().indexOf('UPI-') === 0) {
        var parts = str.split('-');
        if (parts.length > 1) {
            var nameCandidate = parts[1].trim();
            if (nameCandidate && !/^\d+$/.test(nameCandidate) && nameCandidate.indexOf('@') === -1) {
                return nameCandidate;
            }
        }
    }

    if (str.toUpperCase().indexOf('UPI/') === 0) {
        var parts = str.split('/');
        if (parts.length > 1) {
            var nameCandidate = parts[1].trim();
            if (/^\d+$/.test(nameCandidate) || nameCandidate.toUpperCase() === 'CW') {
                if (parts.length > 2) {
                    nameCandidate = parts[2].trim();
                }
            }
            if (nameCandidate && !/^\d+$/.test(nameCandidate) && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(nameCandidate)) {
                return nameCandidate;
            }
        }
    }

    if (str.toUpperCase().indexOf('UPI:') === 0) {
        var parts = str.split(':');
        if (parts.length > 0) {
            var lastPart = parts[parts.length - 1].trim();
            if (lastPart && !/^\d+$/.test(lastPart)) {
                return lastPart;
            }
        }
    }

    if (str.indexOf(',') !== -1) {
        var parts = str.split(',');
        var firstPart = parts[0].trim();
        if (firstPart && !/^\d+$/.test(firstPart) && firstPart.length > 2) {
            return firstPart;
        }
    }

    if (/^(?:NFT|NEFT|RTGS)\//i.test(str)) {
        var spaceIdx = str.indexOf(' ');
        if (spaceIdx !== -1) {
            return str.substring(spaceIdx + 1).trim();
        }
    }

    return null;
}

function getGraphTheme() {
    try {
        var t = localStorage.getItem(THEME_KEY);
        if (t === 'light' || t === 'dark') return t;
    } catch (e) {}
    return 'dark';
}

function getPalettes(theme) {
    var dark = theme === 'dark';
    return {
        layerColors: dark ? [
            '#1e3a5f', '#1b4d3e', '#7b3f00', '#4a1a6e', '#7b1e1e',
            '#0d5c5c', '#5d3a00', '#2c2c44', '#7b5b00', '#0c5c4d'
        ] : [
            '#2980b9', '#27ae60', '#e67e22', '#8e44ad', '#e74c3c',
            '#16a085', '#d35400', '#2c3e50', '#f39c12', '#1abc9c'
        ],
        unclassifiedColor: dark ? '#4a4a5a' : '#5d6d7e',
        terminalColor: dark ? '#7b1e1e' : '#c0392b',
        terminalBorder: dark ? '#581414' : '#962d22',
        edgeColor: dark ? '#8a94a3' : '#7f8c8d',
        labelColor: dark ? '#e8ecf1' : '#2c3e50',
        labelOutline: dark ? '#1a1f2e' : '#ffffff',
        moneyEdgeColor: dark ? '#7aa5d8' : '#2980b9',
        terminalEdgeColor: dark ? '#c68a4a' : '#d35400'
    };
}

function applyThemeToContainer(theme) {
    var c = document.getElementById('cy');
    if (c) {
        if (theme === 'dark') c.classList.add('dark-theme');
        else c.classList.remove('dark-theme');
    }
}

// Mind map and graph visualization logic using Cytoscape.js
function initMindMap() {
    try {
        if (App.state.cy) {
            App.state.cy.destroy();
        }

        var totalTxns = App.state.stats ? App.state.stats.transactions : 0;
        var threshold = 500;
        var isOverThreshold = totalTxns > threshold;
        var aggregateMode = isOverThreshold && !App.state.forceFullGraph;

        var banner = document.getElementById("graph-perf-banner");
        if (banner) {
            if (isOverThreshold) {
                banner.style.display = "flex";
                if (aggregateMode) {
                    banner.innerHTML = '<span><strong>Performance Mode Active:</strong> Similar terminal transactions and duplicate transfers are grouped (' + totalTxns + ' total transactions).</span><button id="btn-force-full-graph">Show Full Graph</button>';
                    document.getElementById("btn-force-full-graph").addEventListener("click", function () {
                        App.state.forceFullGraph = true;
                        initMindMap();
                    });
                } else {
                    banner.innerHTML = '<span><strong>Full Graph Mode Active:</strong> All ' + totalTxns + ' transactions rendered.</span><button id="btn-reset-perf-graph">Switch to Aggregated</button>';
                    document.getElementById("btn-reset-perf-graph").addEventListener("click", function () {
                        App.state.forceFullGraph = false;
                        initMindMap();
                    });
                }
            } else {
                banner.style.display = "none";
                banner.innerHTML = "";
            }
        }

        var elements = generateGraphElements(aggregateMode);

        // Theme-aware palette — dark, professional by default.
        var pal = getPalettes(getGraphTheme());
        var layerColors = pal.layerColors;
        var unclassifiedColor = pal.unclassifiedColor;

        // Build dynamic styles that reference node data (strictly ES5)
        var dynamicStyle = [
            {
                selector: 'node[type="entity"]',
                style: {
                    'label': 'data(label)',
                    'color': pal.labelColor,
                    'font-size': '14px',
                    'font-weight': 'bold',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': '8px',
                    'width': 65,
                    'height': 65,
                    'border-width': 5,
                    'shape': 'ellipse',
                    'text-outline-color': pal.labelOutline,
                    'text-outline-width': 2,
                    'text-wrap': 'wrap',
                    'text-max-width': '120px'
                }
            }
        ];

        // Add per-layer selectors to dynamicStyle (avoiding ES6 spread operator)
        var activeLayersCount = App.state.layers ? App.state.layers.length : 0;
        for (var lIdx = 0; lIdx < Math.max(activeLayersCount, layerColors.length); lIdx++) {
            var color = layerColors[lIdx % layerColors.length];
            dynamicStyle.push({
                selector: 'node[type="entity"][layer=' + (lIdx + 1) + ']',
                style: {
                    'background-color': color,
                    'border-color': color
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
                    'background-color': pal.terminalColor,
                    'label': 'data(label)',
                    'color': pal.labelColor,
                    'font-size': '11px',
                    'font-weight': 'bold',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': '5px',
                    'text-outline-color': pal.labelOutline,
                    'text-outline-width': 2,
                    'width': 25,
                    'height': 25,
                    'shape': 'diamond',
                    'border-width': 3,
                    'border-color': pal.terminalBorder,
                    'text-wrap': 'wrap',
                    'text-max-width': '100px'
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': pal.edgeColor,
                    'target-arrow-color': pal.edgeColor,
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(amount)',
                    'font-size': '10px',
                    'font-weight': 'bold',
                    'text-rotation': 'autorotate',
                    'text-margin-y': '-12px',
                    'color': pal.labelColor,
                    'text-outline-color': pal.labelOutline,
                    'text-outline-width': 1.5
                }
            },
            {
                selector: 'edge[type="money_transfer"]',
                style: {
                    'line-color': pal.moneyEdgeColor,
                    'target-arrow-color': pal.moneyEdgeColor,
                    'line-style': 'solid',
                    'width': 4
                }
            },
            {
                selector: 'edge[type="terminal_flow"]',
                style: {
                    'line-style': 'dashed',
                    'line-color': pal.terminalEdgeColor,
                    'target-arrow-color': pal.terminalEdgeColor,
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
        applyThemeToContainer(getGraphTheme());

        if (!elements || !elements.nodes || elements.nodes.length === 0) {
            cyContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#7f8c8d;font-size:14px;">No graph data available — add transactions with layer and account information.</div>';
            return;
        }

        cyContainer.style.display = 'block';

        var cy = cytoscape({
            container: cyContainer,
            elements: elements,
            style: dynamicStyle,
            minZoom: 0.0005,
            maxZoom: 5,
            wheelSensitivity: 0.5
        });

        cy.resize();

        // Fit the graph to the viewport after layout completes
        // We set up the listener before running layout to ensure it's not missed
        var isSwimlane = document.getElementById("toggle-layout") ? document.getElementById("toggle-layout").checked : false;
        var layout = cy.layout(getLayoutOptions(isSwimlane));

        cy.one('layoutstop', function() {
            cy.fit(undefined, 30);
            cy.center();
        });

        layout.run();

        App.state.cy = cy;

        // Setup tooltip element
        var tooltipId = 'graph-node-tooltip';
        var tooltip = document.getElementById(tooltipId);
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = tooltipId;
            tooltip.className = 'graph-tooltip';
            tooltip.style.position = 'absolute';
            tooltip.style.display = 'none';
            tooltip.style.pointerEvents = 'none';
            document.body.appendChild(tooltip);
        }

        // Hover effects — scale up entity on mouseover and show tooltip
        cy.on('mouseover', 'node', function(evt) {
            var node = evt.target;
            if (node.data('type') === 'entity') {
                node.style('width', 80);
                node.style('height', 80);
                node.style('font-size', '16px');
                node.style('z-index', 999);
            }

            var id = node.data('id');
            var type = node.data('type');
            var content = '';

            if (type === 'entity') {
                var name = (App.state.graphAccountNames && App.state.graphAccountNames[id]) || 'Unknown Name';
                var bank = (App.state.graphAccountBanks && App.state.graphAccountBanks[id]) || 'Unknown Bank';
                var layer = node.data('layerStr') || 'Unknown Layer';
                var ifsc = (App.state.graphAccountIFSCs && App.state.graphAccountIFSCs[id]) || '';

                content = '<div><strong>Account:</strong> ' + id + '</div>' +
                          '<div><strong>Name/Payee:</strong> ' + name + '</div>' +
                          '<div><strong>Bank:</strong> ' + bank + '</div>' +
                          '<div><strong>Layer:</strong> ' + layer + '</div>';

                if (ifsc) {
                    content += '<div><strong>IFSC:</strong> ' + ifsc + '</div>';
                    if (App.IFSC && App.IFSC.getIFSCCachedSync) {
                        var cacheItem = App.IFSC.getIFSCCachedSync(ifsc);
                        if (cacheItem) {
                            content += '<div class="tooltip-address"><strong>Branch & Address:</strong> ' + cacheItem.address + '</div>';
                        }
                    }
                }
            } else {
                var label = node.data('label') || 'Terminal';
                var layer = node.data('layerStr') || 'Unknown Layer';
                content = '<div><strong>Type:</strong> ' + label + '</div>' +
                          '<div><strong>Layer:</strong> ' + layer + '</div>';
            }

            tooltip.innerHTML = content;
            tooltip.style.display = 'block';
        });

        cy.on('mousemove', 'node', function(evt) {
            var renderedPosition = evt.renderedPosition;
            var cyContainer = document.getElementById('cy');
            var rect = cyContainer.getBoundingClientRect();
            var x = rect.left + window.scrollX + renderedPosition.x + 15;
            var y = rect.top + window.scrollY + renderedPosition.y + 15;
            tooltip.style.left = x + 'px';
            tooltip.style.top = y + 'px';
        });

        cy.on('mouseout', 'node', function(evt) {
            var node = evt.target;
            if (node.data('type') === 'entity') {
                node.removeStyle('width height font-size z-index');
            }
            tooltip.style.display = 'none';
        });

        // Edge tooltips
        cy.on('mouseover', 'edge', function(evt) {
            var edge = evt.target;
            var amt = edge.data('amount') || '—';
            tooltip.innerHTML = '<div><strong>Transaction:</strong></div><div>' + amt + '</div>';
            tooltip.style.display = 'block';
        });

        cy.on('mousemove', 'edge', function(evt) {
            var renderedPosition = evt.renderedPosition;
            var cyContainer = document.getElementById('cy');
            var rect = cyContainer.getBoundingClientRect();
            var x = rect.left + window.scrollX + renderedPosition.x + 15;
            var y = rect.top + window.scrollY + renderedPosition.y + 15;
            tooltip.style.left = x + 'px';
            tooltip.style.top = y + 'px';
        });

        cy.on('mouseout', 'edge', function() {
            tooltip.style.display = 'none';
        });

        // Interaction: show details on click
        cy.on('tap', 'node', function(evt){
            var node = evt.target;
            if (node.data('type') === 'entity') {
                document.getElementById('global-search').value = node.data('id');
                if (App.Table && App.Table.performSearch) {
                    App.Table.performSearch();
                }
                document.querySelector('.tab-btn[data-target="table-view"]').click();
            }
        });

        // Initial highlight for the active layer
        var activeLi = document.querySelector('#layer-navigator li.active');
        if (activeLi) {
            var layerKey = activeLi.childNodes[0].textContent.trim();
            highlightLayerInGraph(cy, layerKey);
        }
        App.state.mindMapReady = true;
    } catch(e) {
        console.error("MindMap init error:", e);
        App.state.mindMapReady = false;
        var cyEl = document.getElementById('cy');
        if (cyEl) cyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#e74c3c;font-size:14px;">Graph Error: ' + e.message + '</div>';
    }
};

function highlightLayerInGraph(cy, layerKey) {
    if (!cy) return;

    cy.elements().style({
        'opacity': 1,
        'overlay-opacity': 0
    });

    if (layerKey && App.state && App.state.layers) {
        var expectedIdx = App.state.layers.indexOf(layerKey) + 1;
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

function isSheetMoneyTransfer(sheetName, headers, entityCol) {
    return App.Utils.isMoneyTransferSheet(sheetName, headers, entityCol);
}

function generateGraphElements(aggregateMode) {
    var elements = { nodes: [], edges: [] };
    var structured = App.state.structuredData;
    var layers = App.state.layers;
    var query = App.state.lastSearchQuery || "";
    if (!structured || !layers || !layers.length) return elements;

    var addedNodes = {};
    var terminalNodeIdCounter = 0;

    // Build payee name, bank name and IFSC mappings from money-transfer transactions
    var accountNames = {};
    var accountBanks = {};
    var accountIFSCs = {};

    var rawData = App.state.rawData || {};
    var sheetNamesList = Object.keys(rawData);
    for (var sIdx = 0; sIdx < sheetNamesList.length; sIdx++) {
        var sName = sheetNamesList[sIdx];
        var sData = rawData[sName];
        var sHeaders = sData.headers || [];
        var sRows = sData.rows || [];
        if (sHeaders.length === 0 || sRows.length === 0) continue;

        var entityCol = App.Utils.findEntityCol(sHeaders);
        var receiverCol = App.Utils.findReceiverCol(sHeaders, entityCol);
        var isMoneyTransfer = App.Utils.isMoneyTransferSheet(sName, sHeaders, entityCol);

        for (var rIdx = 0; rIdx < sRows.length; rIdx++) {
            var row = sRows[rIdx];
            var senderId = entityCol ? String(row[entityCol]).trim() : null;
            var receiverId = (isMoneyTransfer && receiverCol) ? String(row[receiverCol]).trim() : null;

            var rxBank = row['Bank/FIs'];
            var txBank = row['Action Taken By bank'];

            if (senderId && senderId !== 'null' && senderId !== '') {
                if (txBank && txBank !== 'null' && txBank !== '') {
                    accountBanks[senderId] = txBank;
                }
            }
            if (receiverId && receiverId !== 'null' && receiverId !== '') {
                if (rxBank && rxBank !== 'null' && rxBank !== '') {
                    accountBanks[receiverId] = rxBank;
                }
            }

            if (App.IFSC && App.IFSC.getRowIFSC) {
                var ifscVal = App.IFSC.getRowIFSC(sName, row);
                var code = (App.IFSC.safeExtractIFSC) ? App.IFSC.safeExtractIFSC(ifscVal) : (ifscVal && ifscVal.code ? ifscVal.code : null);
                if (code) {
                    var cleanCode = String(code).trim().toUpperCase();
                    if (receiverId && receiverId !== 'null' && receiverId !== '') {
                        accountIFSCs[receiverId] = cleanCode;
                    }
                    if (!receiverId && senderId && senderId !== 'null' && senderId !== '') {
                        accountIFSCs[senderId] = cleanCode;
                    }
                }
            }

            if (row['Remarks']) {
                var name = extractNameFromRemark(row['Remarks']);
                if (name) {
                    var targetId = receiverId || senderId;
                    if (targetId && targetId !== 'null' && targetId !== '') {
                        if (!accountNames[targetId] || name.length > accountNames[targetId].length) {
                            accountNames[targetId] = name;
                        }
                    }
                }
            }
        }
    }

    App.state.graphAccountNames = accountNames;
    App.state.graphAccountBanks = accountBanks;
    App.state.graphAccountIFSCs = accountIFSCs;

    var sheetColInfo = {};

    function getColInfo(sheetName, sampleRow) {
        if (sheetColInfo[sheetName]) return sheetColInfo[sheetName];
        var rowKeys = sampleRow ? Object.keys(sampleRow) : [];
        var info = {
            isMoneyTransfer: isSheetMoneyTransfer(sheetName, rowKeys, null),
            entityCol: null,
            amountCol: null,
            receiverCol: null,
            patterns: App.state.primaryEntityPatterns || []
        };
        info.entityCol = App.Utils.findEntityCol(rowKeys, info.patterns);
        info.amountCol = App.Utils.findAmountCol(rowKeys);
        if (info.isMoneyTransfer) {
            info.receiverCol = App.Utils.findReceiverCol(rowKeys, info.entityCol);
        }
        sheetColInfo[sheetName] = info;
        return info;
    }

    function rowMatchesQuery(row, q) {
        var keys = Object.keys(row);
        for (var i = 0; i < keys.length; i++) {
            var v = row[keys[i]];
            if (v !== null && v !== undefined && String(v).toLowerCase().indexOf(q) !== -1) {
                return true;
            }
        }
        return false;
    }

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

                var colInfo = getColInfo(sheetName, rows[0]);

                for (var ri = 0; ri < rows.length; ri++) {
                    var row = rows[ri];
                    if (query !== "" && !rowMatchesQuery(row, query)) continue;

                    if (!addedNodes[cleanEntityId]) {
                        var name = accountNames[cleanEntityId];
                        var nodeLabel = name ? (name + "\n(" + cleanEntityId + ")") : cleanEntityId;
                        elements.nodes.push({
                            data: {
                                id: cleanEntityId,
                                label: nodeLabel,
                                type: 'entity',
                                layer: layerIndex + 1,
                                layerStr: layerKey
                            }
                        });
                        addedNodes[cleanEntityId] = true;
                    }

                    var amountVal = colInfo.amountCol ? row[colInfo.amountCol] : "";
                    var amountNum = parseAmount(amountVal);

                    if (colInfo.isMoneyTransfer) {
                        var receiverId = colInfo.receiverCol ? String(row[colInfo.receiverCol]).trim() : null;

                        if (receiverId && receiverId !== cleanEntityId) {
                            if (!addedNodes[receiverId]) {
                                var name = accountNames[receiverId];
                                var nodeLabel = name ? (name + "\n(" + receiverId + ")") : receiverId;
                                elements.nodes.push({
                                    data: {
                                        id: receiverId,
                                        label: nodeLabel,
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
                                        amount: localFormatAmount(amountNum)
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
                                    amount: localFormatAmount(amountNum)
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    function parseAmount(val) {
        var num = App.Utils.parseAmount(val);
        return (num === null) ? 0 : num;
    }

    if (aggregateMode) {
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
                    amount: localFormatAmount(data.amountSum) + " (" + data.count + " txns)"
                }
            });
        }

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
                    amount: localFormatAmount(data.amountSum) + " (" + data.count + " txns)"
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
                var maxLayer = App.state.layers.length + 1;
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

// Delegated to global app.js for consistency via localFormatAmount to avoid global collisions
function localFormatAmount(val) {
    if (App.formatters && App.formatters.amount) return App.formatters.amount(val);
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
            if (App.state && App.state.cy) {
                var isSwimlane = e.target.checked;
                App.state.cy.one('layoutstop', function() {
                    App.state.cy.fit(undefined, 30);
                    App.state.cy.center();
                });
                var layout = App.state.cy.layout(getLayoutOptions(isSwimlane));
                layout.run();
            }
        });
    }

    // Graph theme toggle (Dark/Light) — persisted, default dark.
    var themeBtn = document.getElementById("btn-graph-theme");
    if (themeBtn) {
        var applyBtnState = function() {
            var isDark = getGraphTheme() === 'dark';
            themeBtn.textContent = isDark ? "◐" : "☀";
            themeBtn.title = isDark ? "Switch to Light Theme" : "Switch to Dark Theme";
            themeBtn.setAttribute("aria-pressed", String(isDark));
        };
        applyBtnState();
        themeBtn.addEventListener("click", function () {
            var next = getGraphTheme() === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
            applyBtnState();
            applyThemeToContainer(next);
            if (App.state && App.state.cy) {
                initMindMap();
            }
        });
    }

    // Zoom Controls
    var btnZoomIn = document.getElementById("btn-zoom-in");
    if (btnZoomIn) {
        btnZoomIn.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.zoom(App.state.cy.zoom() * 1.3);
            }
        });
    }

    var btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomOut) {
        btnZoomOut.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.zoom(App.state.cy.zoom() / 1.3);
            }
        });
    }

    var btnZoomFit = document.getElementById("btn-zoom-fit");
    if (btnZoomFit) {
        btnZoomFit.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.fit(undefined, 30);
                App.state.cy.center();
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
                    if (App.state && App.state.cy) {
                        App.state.cy.resize();
                        App.state.cy.fit(undefined, 30);
                        App.state.cy.center();
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
            if (App.state && App.state.cy) {
                App.state.cy.panBy({ x: 0, y: panDistance });
            }
        });
    }

    var btnPanDown = document.getElementById("btn-pan-down");
    if (btnPanDown) {
        btnPanDown.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.panBy({ x: 0, y: -panDistance });
            }
        });
    }

    var btnPanLeft = document.getElementById("btn-pan-left");
    if (btnPanLeft) {
        btnPanLeft.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.panBy({ x: panDistance, y: 0 });
            }
        });
    }

    var btnPanRight = document.getElementById("btn-pan-right");
    if (btnPanRight) {
        btnPanRight.addEventListener("click", function() {
            if (App.state && App.state.cy) {
                App.state.cy.panBy({ x: -panDistance, y: 0 });
            }
        });
    }

    // Ensure graph view has proper height whenever it becomes visible
    var graphView = document.getElementById("graph-view");
    if (graphView) {
        var observer = new MutationObserver(function () {
            if (graphView.classList.contains("active") && App.state && App.state.cy) {
                App.state.cy.resize();
                App.state.cy.fit(undefined, 30);
            }
        });
        observer.observe(graphView, { attributes: true, attributeFilter: ["style", "class"] });
    }
});

    // Expose methods
    Graph.initMindMap = initMindMap;
    Graph.highlightLayerInGraph = highlightLayerInGraph;

    App.Graph = Graph;
})(window.PersonallApp);
