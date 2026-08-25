(function(App) {
    'use strict';

    var Table = App.Table || {};

// Guarded IFSC accessors — the table view must keep working even if the
// IFSC module failed to initialize (e.g. corrupt localStorage cache).
function ifscHasData(sheetName) {
    return !!(App.IFSC && App.IFSC.hasIFSCData && App.IFSC.hasIFSCData(sheetName));
}
function ifscGetRowIFSC(sheetName, row) {
    return (App.IFSC && App.IFSC.getRowIFSC) ? App.IFSC.getRowIFSC(sheetName, row) : null;
}
function ifscExtractCode(ifscVal) {
    if (App.IFSC && App.IFSC.safeExtractIFSC) return App.IFSC.safeExtractIFSC(ifscVal);
    if (ifscVal && ifscVal.code) return ifscVal.code;
    if (typeof ifscVal === 'string') return ifscVal;
    return null;
}
function ifscGetCache() {
    return (App.IFSC && App.IFSC.getCache) ? App.IFSC.getCache() : {};
}
function ifscLookup(code, cb) {
    if (App.IFSC && App.IFSC.lookupIFSC) {
        App.IFSC.lookupIFSC(code, cb);
        return;
    }
    if (cb) cb({ address: '-', bank: '-', branch: '-', status: 'error' });
}

// Table rendering and filtering logic
function renderSidebarAndTables() {
    const layers = App.state.layers;
    const navigator = document.getElementById("layer-navigator");
    const container = document.getElementById("table-container");

    navigator.innerHTML = "";
    container.innerHTML = "";

    const query = App.state.lastSearchQuery || "";

    layers.forEach((layerKey, index) => {
        const entityCount = getMatchingEntityCountForLayer(layerKey, query);

        // Sidebar item
        const li = document.createElement("li");
        li.innerHTML = `${layerKey} <span class="meta">${entityCount} Entities</span>`;
        if (index === 0) li.classList.add("active");
        
        // Highlight if matches exist
        if (query !== "" && getLayerMatchCount(layerKey, query) > 0) {
            li.classList.add("has-matches");
        }

        li.addEventListener("click", () => switchLayer(layerKey, li));
        navigator.appendChild(li);

        // Layer container
        const layerDiv = document.createElement("div");
        layerDiv.id = `view-${layerKey.replace(/\s+/g, '-')}`;
        layerDiv.className = "layer-view";
        layerDiv.style.display = index === 0 ? "block" : "none";
        container.appendChild(layerDiv);

        // Lazy load: only render the active layer initially
        if (index === 0) {
            renderLayerData(layerKey, layerDiv);
            layerDiv.dataset.rendered = "true";
        } else {
            layerDiv.dataset.rendered = "false";
        }
    });

    setupSearchFilter();
    setupPrimaryEntityToggle();
};

function switchLayer(layerKey, activeLi) {
    document.querySelectorAll(".layer-list li").forEach(li => li.classList.remove("active"));
    activeLi.classList.add("active");

    // Hide all other layer containers and recycle their DOM
    document.querySelectorAll(".layer-view").forEach(div => {
        const expectedId = `view-${layerKey.replace(/\s+/g, '-')}`;
        if (div.id !== expectedId) {
            div.style.display = "none";
            // Clear content to free DOM memory (DOM Recycling)
            div.innerHTML = "";
            div.dataset.rendered = "false";
        }
    });

    const layerDivId = `view-${layerKey.replace(/\s+/g, '-')}`;
    const layerDiv = document.getElementById(layerDivId);
    if (layerDiv) {
        layerDiv.style.display = "block";
        if (layerDiv.dataset.rendered === "false") {
            renderLayerData(layerKey, layerDiv);
            layerDiv.dataset.rendered = "true";
        }
    }

    // Update active search summary chips
    if (App.state.lastSearchQuery !== "") {
        performSearch(App.state.lastSearchQuery, false);
    }

    // Highlight layer in graph as well
    if (App.state.cy && App.Graph.highlightLayerInGraph) {
        App.Graph.highlightLayerInGraph(App.state.cy, layerKey);
    }
}

// Time-sliced rendering: when there are many entities, yield to the main thread
// between each entity so the browser stays responsive and paint events fire.
var ENTITIES_PER_FRAME = 8;
var ROWS_BEFORE_YIELD = 120;

function renderLayerData(layerKey, container) {
    const entities = App.state.structuredData[layerKey];
    if (!entities) return;

    const currentLayerIndex = App.state.layers.indexOf(layerKey);
    const prevLayerKey = currentLayerIndex > 0 ? App.state.layers[currentLayerIndex - 1] : null;
    const query = App.state.lastSearchQuery || "";

    // Use the precomputed per-layer receiver sets (built once per workbook in
    // buildSheetColumnIndex) so per-entity linkage checks are O(1) Set lookups
    // instead of rescanning the whole previous layer for every entity.
    const crossRefSet = prevLayerKey
        ? (App.state.layerReceiverSets && App.state.layerReceiverSets[prevLayerKey]) || buildCrossReferenceSet(prevLayerKey)
        : new Set();

    // Pre-filter: figure out which entities have matches before starting DOM work
    const entityNames = Object.keys(entities);
    const visibleEntities = [];

    for (let i = 0; i < entityNames.length; i++) {
        const entityName = entityNames[i];
        const sheets = entities[entityName];
        let entityHasMatches = false;
        const filteredSheetsData = {};
        const sheetNames = Object.keys(sheets);

        for (let j = 0; j < sheetNames.length; j++) {
            const sheetName = sheetNames[j];
            const rows = sheets[sheetName];
            const filtered = query === "" ? rows : rows.filter(r => {
                const vals = Object.values(r);
                const parts = [];
                for (let v = 0; v < vals.length; v++) {
                    if (vals[v] !== null && vals[v] !== undefined) parts.push(String(vals[v]).toLowerCase());
                }
                return parts.join(" ").includes(query);
            });
            if (filtered.length > 0) {
                filteredSheetsData[sheetName] = filtered;
                entityHasMatches = true;
            }
        }
        if (entityHasMatches) {
            visibleEntities.push({ entityName, filteredSheetsData });
        }
    }

    if (visibleEntities.length === 0) return;

    // If few entities, render synchronously (no overhead for small layers)
    if (visibleEntities.length <= ENTITIES_PER_FRAME) {
        for (let i = 0; i < visibleEntities.length; i++) {
            appendEntitySection(visibleEntities[i].entityName, visibleEntities[i].filteredSheetsData, crossRefSet, container);
        }
        return;
    }

    // Large layer: render entities in chunks via requestAnimationFrame
    var idx = 0;
    function renderChunk() {
        const end = Math.min(idx + ENTITIES_PER_FRAME, visibleEntities.length);
        for (; idx < end; idx++) {
            appendEntitySection(visibleEntities[idx].entityName, visibleEntities[idx].filteredSheetsData, crossRefSet, container);
        }
        if (idx < visibleEntities.length) {
            requestAnimationFrame(renderChunk);
        }
    }
    requestAnimationFrame(renderChunk);
}

function appendEntitySection(entityName, filteredSheetsData, crossRefSet, container) {
    const entityDiv = document.createElement("div");
    entityDiv.className = "entity-section";

    const header = document.createElement("div");
    header.className = "entity-header";
    const totalTxns = Object.values(filteredSheetsData).reduce((sum, arr) => sum + arr.length, 0);

    let headerText = `Entity: ${entityName} (${totalTxns} Transactions)`;

    let crossRefText = "";
    if (crossRefSet && crossRefSet.has(entityName)) {
        crossRefText = `<span class="cross-ref-badge">Linked from previous layer</span>`;
        entityDiv.classList.add("cross-ref");
    }

    header.innerHTML = `<span>${crossRefText} ${headerText}</span> <span>&#9660;</span>`;
    entityDiv.appendChild(header);

    const content = document.createElement("div");
    content.className = "entity-content";
    content.style.display = "block";

    header.addEventListener("click", () => {
        content.style.display = content.style.display === "none" ? "block" : "none";
        header.querySelector("span:last-child").innerText = content.style.display === "none" ? "\u25B6" : "\u25BC";
        // Re-render virtual windows when content is expanded (viewport changed).
        if (content.style.display !== "none") {
            content.querySelectorAll(".vs-scroll").forEach(ss => {
                ss.dispatchEvent(new Event("scroll"));
            });
        }
    });

    // Render each sheet's transaction table (virtual-scrolled)
    const sheetNames = Object.keys(filteredSheetsData);
    for (let s = 0; s < sheetNames.length; s++) {
        const sheetName = sheetNames[s];
        const rows = filteredSheetsData[sheetName];
        const txnSection = document.createElement("div");
        txnSection.className = "transaction-section";
        txnSection.innerHTML = `<h4>${sheetName} (${rows.length})</h4>`;

        const table = document.createElement("table");
        table.className = "data-table";

        const originalHeaders = App.state.rawData[sheetName].headers;
        const hasIFSC = ifscHasData(sheetName);

        const thead = document.createElement("thead");
        const trHead = document.createElement("tr");
        originalHeaders.forEach(col => {
            const th = document.createElement("th");
            th.innerText = col;
            th.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
            trHead.appendChild(th);
        });

        if (hasIFSC) {
            const thAddr = document.createElement("th");
            thAddr.innerHTML = 'Bank Branch & Address <span class="ifsc-status-badge" style="font-size: 0.8em; font-weight: normal; margin-left: 5px; color: #7f8c8d;"></span>';
            thAddr.className = "resolved-address-header";
            trHead.appendChild(thAddr);
        }

        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        table.appendChild(tbody);

        const vsScroll = document.createElement("div");
        vsScroll.className = "vs-scroll";
        vsScroll.appendChild(table);
        txnSection.appendChild(vsScroll);

        setupVirtualScroll(vsScroll, table, sheetName, originalHeaders, hasIFSC, rows);
        content.appendChild(txnSection);
    }

    entityDiv.appendChild(content);
    container.appendChild(entityDiv);
}

// ---------------------------------------------------------------
// Virtual scrolling — render only visible rows (fixed row height) so
// sheets with thousands of rows stay smooth without a DOM explosion.
// ---------------------------------------------------------------
const VIRTUAL_ROW_HEIGHT = 36;
const VIRTUAL_BUFFER = 10;

function createTableRow(sheetName, originalHeaders, hasIFSC, row) {
    const tr = document.createElement("tr");
    originalHeaders.forEach(col => {
        const td = document.createElement("td");
        if (col.toLowerCase().includes("amount") && typeof row[col] !== 'undefined') {
            td.innerText = (App.formatters && App.formatters.amount) ? App.formatters.amount(row[col]) : (row[col] !== null ? row[col] : "—");
        } else {
            td.innerText = row[col] !== null && row[col] !== undefined ? row[col] : "";
        }
        td.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
        tr.appendChild(td);
    });

    if (hasIFSC) {
        const tdAddr = document.createElement("td");
        tdAddr.className = "resolved-address-cell";
        const ifscVal = ifscGetRowIFSC(sheetName, row);
        const clean = ifscExtractCode(ifscVal);

        if (clean) {
            const cleanUpper = String(clean).trim().toUpperCase();
            const cached = ifscGetCache()[cleanUpper];
            const source = ifscVal && ifscVal.source ? ifscVal.source : 'row_cell';

            if (cached && cached.status === 'resolved') {
                tdAddr.innerHTML = cached.address;
            } else if (cached && cached.status === 'fallback') {
                tdAddr.innerHTML = cached.address + ' <button class="retry-ifsc-btn" data-ifsc="' + cleanUpper + '" title="Retry Online Lookup" style="background:none;border:none;cursor:pointer;font-size:12px;">🔄</button>';
            } else {
                // Unknown or in-flight: show placeholder, request resolution once.
                tdAddr.innerHTML = '<span style="color:#7f8c8d;font-style:italic;">Looking up...</span>';
                if (!cached || cached.status !== 'pending') {
                    ifscLookup(cleanUpper, function (details) {
                        updateIfscCell(tdAddr, cleanUpper, details, source);
                    });
                }
            }

            tdAddr.dataset.source = source;
            tdAddr.dataset.ifsc = cleanUpper;

            if (source === 'sheet_metadata') {
                tdAddr.innerHTML += ' <span style="font-size: 0.75em; color: #95a5a6; display: block;">(Sheet-level IFSC)</span>';
            }
        } else {
            tdAddr.innerText = "-";
        }
        tr.appendChild(tdAddr);
    }
    return tr;
}

function updateIfscCell(td, code, details, source) {
    if (!td || !document.body.contains(td)) return;
    let html = details.address;
    if (details.status === 'fallback') {
        html += ' <button class="retry-ifsc-btn" data-ifsc="' + code + '" title="Retry Online Lookup" style="background:none;border:none;cursor:pointer;font-size:12px;">🔄</button>';
    }
    if (source === 'sheet_metadata') {
        html += ' <span style="font-size: 0.75em; color: #95a5a6; display: block;">(Sheet-level IFSC)</span>';
    }
    td.innerHTML = html;
}

function setupVirtualScroll(scrollEl, table, sheetName, originalHeaders, hasIFSC, rows) {
    const tbody = table.querySelector('tbody');
    const colCount = originalHeaders.length + (hasIFSC ? 1 : 0);

    function renderWindow() {
        const scrollTop = scrollEl.scrollTop || 0;
        const viewportH = scrollEl.clientHeight || 300;
        const total = rows.length;
        if (total === 0) {
            tbody.innerHTML = "";
            return;
        }

        const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER);
        const visibleCount = Math.ceil(viewportH / VIRTUAL_ROW_HEIGHT) + VIRTUAL_BUFFER * 2;
        const end = Math.min(total, start + visibleCount);

        tbody.innerHTML = "";

        // Top spacer keeps scroll position aligned with the real row grid.
        if (start > 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = colCount;
            td.style.height = (start * VIRTUAL_ROW_HEIGHT) + "px";
            td.style.padding = "0";
            td.style.border = "none";
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        for (let i = start; i < end; i++) {
            tbody.appendChild(createTableRow(sheetName, originalHeaders, hasIFSC, rows[i]));
        }

        if (end < total) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = colCount;
            td.style.height = ((total - end) * VIRTUAL_ROW_HEIGHT) + "px";
            td.style.padding = "0";
            td.style.border = "none";
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        setupPrimaryEntityToggle(true);
    }

    let rafPending = false;
    scrollEl.addEventListener("scroll", function () {
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(function () {
                rafPending = false;
                renderWindow();
            });
        }
    });

    // Delegated retry-click handling (rows are recreated on scroll).
    scrollEl.addEventListener("click", function (e) {
        const target = e.target;
        if (!target || !target.classList || !target.classList.contains("retry-ifsc-btn")) return;
        e.preventDefault();
        const code = target.dataset.ifsc;
        const td = target.closest ? target.closest("td") : null;
        const source = td ? (td.dataset.source || "row_cell") : "row_cell";
        if (ifscGetCache()[code]) delete ifscGetCache()[code];
        if (td) td.innerHTML = '<span style="color:#7f8c8d;font-style:italic;">Looking up...</span>';
        ifscLookup(code, function (details) {
            updateIfscCell(td, code, details, source);
        });
    });

    renderWindow();
}

function checkCrossReference(prevLayerKey, currentEntityName) {
    return buildCrossReferenceSet(prevLayerKey).has(currentEntityName);
}

// Build a Set of entity names that appear as the receiver/destination account
// in the previous layer's money-transfer sheets. Called once per layer render
// so per-entity linkage checks are O(1) instead of a full-layer rescan.
function buildCrossReferenceSet(prevLayerKey) {
    const linked = new Set();
    const prevLayerEntities = App.state.structuredData[prevLayerKey];
    if (!prevLayerEntities) return linked;

    for (const senderEntity in prevLayerEntities) {
        for (const sheetName in prevLayerEntities[senderEntity]) {
            const rows = prevLayerEntities[senderEntity][sheetName];
            if (!rows || !rows.length) continue;

            const headers = App.state.rawData && App.state.rawData[sheetName]
                ? App.state.rawData[sheetName].headers
                : Object.keys(rows[0] || {});
            const entityCol = App.Utils.findEntityCol(headers);
            const receiverCol = App.Utils.findReceiverCol(headers, entityCol);
            const isMoneyTransfer = App.Utils.isMoneyTransferSheet(sheetName, headers, entityCol);

            if (isMoneyTransfer && receiverCol) {
                for (const row of rows) {
                    const recv = row[receiverCol];
                    if (recv !== null && recv !== undefined) {
                        linked.add(String(recv).trim());
                    }
                }
            }
        }
    }
    return linked;
}

function isPrimaryEntityCol(colName) {
    const lower = colName.toLowerCase();
    return App.state.primaryEntityPatterns.some(p => lower.includes(p));
}

function setupPrimaryEntityToggle(skipEvent = false) {
    const toggle = document.getElementById("toggle-primary-entity");
    const updateVisibility = () => {
        const cols = document.querySelectorAll(".primary-entity-col");
        cols.forEach(c => {
            c.style.display = toggle.checked ? "table-cell" : "none";
        });
    };

    if (!skipEvent) {
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        newToggle.addEventListener("change", updateVisibility);
    }
    updateVisibility();
}

App.state.lastSearchQuery = "";

function performSearch(queryText = null, updateWindowRef = true) {
    const searchInput = document.getElementById("global-search");
    const query = queryText !== null ? queryText : searchInput.value.toLowerCase().trim();
    
    if (updateWindowRef) {
        App.state.lastSearchQuery = query;
        searchInput.value = query;
    }

    const layers = App.state.layers;
    const navigator = document.getElementById("layer-navigator");
    const summaryBar = document.getElementById("search-summary-bar");

    // 1. Get search statistics. Uses the inverted trigram index to narrow the
    //    candidate set when the query is long enough; otherwise falls back to
    //    a full scan of the flat index (correct in both cases).
    let totalMatches = 0;
    const layerMatchCounts = {};
    const matchedLayersSet = new Set();
    const matchedEntitiesSet = new Set();
    const layerEntitySets = {};

    if (query !== "") {
        const searchIndex = App.state.searchIndex;
        const candidates = App.Utils.searchCandidates(App.state.searchIndexMap, query);
        const range = candidates ? candidates.length : searchIndex.length;

        for (let i = 0; i < range; i++) {
            const idx = candidates ? candidates[i] : i;
            if (searchIndex[idx].normalizedText.includes(query)) {
                totalMatches++;
                const m = searchIndex[idx];
                matchedLayersSet.add(m.layer);
                matchedEntitiesSet.add(m.entity);
                layerMatchCounts[m.layer] = (layerMatchCounts[m.layer] || 0) + 1;
                if (!layerEntitySets[m.layer]) layerEntitySets[m.layer] = new Set();
                layerEntitySets[m.layer].add(m.entity);
            }
        }
    }

    // 2. Render Search Summary Bar
    if (query === "") {
        summaryBar.style.display = "none";
        summaryBar.innerHTML = "";
    } else {
        summaryBar.style.display = "flex";
        
        let discoveryHTML = `<div class="summary-text">`;
        if (totalMatches === 0) {
            discoveryHTML += `&#128269; No matches found anywhere in the workbook.`;
        } else {
            discoveryHTML += `&#128269; Found <strong>${totalMatches}</strong> matches in <strong>${matchedEntitiesSet.size}</strong> entities across <strong>${matchedLayersSet.size}</strong> layers. `;
        }
        discoveryHTML += `</div>`;

        const activeLi = navigator.querySelector("li.active");
        const activeLayerKey = activeLi ? activeLi.childNodes[0].textContent.trim() : (layers[0] || "");
        const activeLayerMatches = layerMatchCounts[activeLayerKey] || 0;

        if (totalMatches > 0) {
            discoveryHTML += `<div class="search-chips">`;
            if (activeLayerMatches === 0) {
                discoveryHTML += `<span style="margin-right: 5px; font-weight: bold; color: var(--danger-color);">Not in current layer. Go to:</span>`;
            } else {
                discoveryHTML += `<span style="margin-right: 5px; font-weight: bold;">Jump to:</span>`;
            }

            matchedLayersSet.forEach(layerKey => {
                const count = layerMatchCounts[layerKey];
                const isActive = (layerKey === activeLayerKey);
                discoveryHTML += `<button class="search-chip ${isActive ? 'active-chip' : ''}" onclick="PersonallApp.Table.jumpToLayerFromSearch('${layerKey.replace(/'/g, "\\'")}')">${layerKey} (${count})</button>`;
            });
            discoveryHTML += `</div>`;
        }

        summaryBar.innerHTML = discoveryHTML;
    }

    // 3. Re-render Sidebar to show matching layer badges and counts
    const activeLi = navigator.querySelector("li.active");
    const activeLayerKey = activeLi ? activeLi.childNodes[0].textContent.trim() : (layers[0] || "");
    navigator.innerHTML = "";

    layers.forEach((layerKey, index) => {
        // Use pre-computed stats from the single index pass
        let entityCount;
        if (query) {
            entityCount = layerEntitySets[layerKey] ? layerEntitySets[layerKey].size : 0;
        } else {
            entityCount = getMatchingEntityCountForLayer(layerKey, "");
        }

        const li = document.createElement("li");
        li.innerHTML = `${layerKey} <span class="meta">${entityCount} Entities</span>`;
        if (layerKey === activeLayerKey) {
            li.classList.add("active");
        }
        
        if (query !== "" && layerMatchCounts[layerKey] > 0) {
            li.classList.add("has-matches");
        }

        li.addEventListener("click", () => switchLayer(layerKey, li));
        navigator.appendChild(li);
    });

    // 4. Re-render Active Layer View
    if (activeLayerKey) {
        const activeContainerId = `view-${activeLayerKey.replace(/\s+/g, '-')}`;
        let activeContainer = document.getElementById(activeContainerId);
        if (!activeContainer) {
            activeContainer = document.createElement("div");
            activeContainer.id = activeContainerId;
            activeContainer.className = "layer-view";
            document.getElementById("table-container").appendChild(activeContainer);
        }
        activeContainer.innerHTML = "";
        activeContainer.style.display = "block";
        renderLayerData(activeLayerKey, activeContainer);
        activeContainer.dataset.rendered = "true";
    }

    // 5. Reset all other layer views to unrendered/empty state to prevent DOM growth
    document.querySelectorAll(".layer-view").forEach(div => {
        const expectedId = `view-${activeLayerKey.replace(/\s+/g, '-')}`;
        if (div.id !== expectedId) {
            div.dataset.rendered = "false";
            div.innerHTML = "";
            div.style.display = "none";
        }
    });

    // 6. Update the Mind Map Graph only if the graph tab is active AND graph was initialized
    // This avoids expensive Cytoscape rebuild when user is on table view
    const graphTab = document.querySelector('.tab-btn[data-target="graph-view"]');
    if (App.state.cy && App.Graph.initMindMap && graphTab && graphTab.classList.contains("active")) {
        App.Graph.initMindMap();
    }
}
Table.performSearch = performSearch;

function jumpToLayerFromSearch(layerKey) {
    const navigator = document.getElementById("layer-navigator");
    const lis = navigator.querySelectorAll("li");
    let targetLi = null;
    
    lis.forEach(li => {
        if (li.childNodes[0].textContent.trim() === layerKey) {
            targetLi = li;
        }
    });

    if (targetLi) {
        switchLayer(layerKey, targetLi);
    }
};

function getMatchingEntityCountForLayer(layerKey, query) {
    const entities = App.state.structuredData[layerKey];
    if (!entities) return 0;
    if (!query) return Object.keys(entities).length;

    let count = 0;
    const entityNames = Object.keys(entities);
    for (let i = 0; i < entityNames.length; i++) {
        const sheets = entities[entityNames[i]];
        let entityMatches = false;
        const sheetNames = Object.keys(sheets);
        for (let j = 0; j < sheetNames.length; j++) {
            const rows = sheets[sheetNames[j]];
            for (let r = 0; r < rows.length; r++) {
                const vals = Object.values(rows[r]);
                const parts = [];
                for (let v = 0; v < vals.length; v++) {
                    if (vals[v] !== null && vals[v] !== undefined) parts.push(String(vals[v]).toLowerCase());
                }
                if (parts.join(" ").includes(query)) {
                    entityMatches = true;
                    break;
                }
            }
            if (entityMatches) break;
        }
        if (entityMatches) count++;
    }
    return count;
}

function getLayerMatchCount(layerKey, query) {
    if (!query) return 0;
    const searchIndex = App.state.searchIndex;
    const candidates = App.Utils.searchCandidates(App.state.searchIndexMap, query);
    const range = candidates ? candidates.length : searchIndex.length;
    let count = 0;
    for (let i = 0; i < range; i++) {
        const idx = candidates ? candidates[i] : i;
        if (searchIndex[idx].layer === layerKey && searchIndex[idx].normalizedText.includes(query)) {
            count++;
        }
    }
    return count;
}

// Listen for IFSC resolution events to update "Looking up..." cells in real-time
document.addEventListener('ifsc-resolved', function(e) {
    var code = e.detail && e.detail.code;
    var result = e.detail && e.detail.result;
    if (!code || !result) return;
    var cells = document.querySelectorAll('td[data-ifsc="' + code + '"]');
    for (var i = 0; i < cells.length; i++) {
        var td = cells[i];
        updateIfscCell(td, code, result, td.dataset.source || 'row_cell');
    }
});

function setupSearchFilter() {
    const searchInput = document.getElementById("global-search");
    const filterBtn = document.getElementById("filter-btn");

    const newBtn = filterBtn.cloneNode(true);
    filterBtn.parentNode.replaceChild(newBtn, filterBtn);

    const newInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newInput, searchInput);

    newBtn.addEventListener("click", () => performSearch());

    let debounceTimer;
    newInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
            clearTimeout(debounceTimer);
            performSearch();
        } else {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(), 300);
        }
    });
}

    // Expose methods
    Table.renderSidebarAndTables = renderSidebarAndTables;
    Table.jumpToLayerFromSearch = jumpToLayerFromSearch;
    Table.performSearch = performSearch;

    App.Table = Table;
})(window.PersonallApp);
