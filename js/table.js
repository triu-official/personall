// Table rendering and filtering logic
window.renderSidebarAndTables = function() {
    const layers = window.appState.layers;
    const navigator = document.getElementById("layer-navigator");
    const container = document.getElementById("table-container");

    navigator.innerHTML = "";
    container.innerHTML = "";

    const query = window.lastSearchQuery || "";

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
    if (window.lastSearchQuery !== "") {
        performSearch(window.lastSearchQuery, false);
    }

    // Highlight layer in graph as well
    if (window.appState.cy && window.highlightLayerInGraph) {
        window.highlightLayerInGraph(window.appState.cy, layerKey);
    }
}

// Time-sliced rendering: when there are many entities, yield to the main thread
// between each entity so the browser stays responsive and paint events fire.
var ENTITIES_PER_FRAME = 8;
var ROWS_BEFORE_YIELD = 120;

function renderLayerData(layerKey, container) {
    const entities = window.appState.structuredData[layerKey];
    if (!entities) return;

    const currentLayerIndex = window.appState.layers.indexOf(layerKey);
    const prevLayerKey = currentLayerIndex > 0 ? window.appState.layers[currentLayerIndex - 1] : null;
    const query = window.lastSearchQuery || "";

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
            appendEntitySection(visibleEntities[i].entityName, visibleEntities[i].filteredSheetsData, prevLayerKey, container);
        }
        return;
    }

    // Large layer: render entities in chunks via requestAnimationFrame
    var idx = 0;
    function renderChunk() {
        const end = Math.min(idx + ENTITIES_PER_FRAME, visibleEntities.length);
        for (; idx < end; idx++) {
            appendEntitySection(visibleEntities[idx].entityName, visibleEntities[idx].filteredSheetsData, prevLayerKey, container);
        }
        if (idx < visibleEntities.length) {
            requestAnimationFrame(renderChunk);
        }
    }
    requestAnimationFrame(renderChunk);
}

function appendEntitySection(entityName, filteredSheetsData, prevLayerKey, container) {
    const entityDiv = document.createElement("div");
    entityDiv.className = "entity-section";

    const header = document.createElement("div");
    header.className = "entity-header";
    const totalTxns = Object.values(filteredSheetsData).reduce((sum, arr) => sum + arr.length, 0);

    let headerText = `Entity: ${entityName} (${totalTxns} Transactions)`;

    let crossRefText = "";
    if (prevLayerKey) {
        const isLinked = checkCrossReference(prevLayerKey, entityName);
        if (isLinked) {
            crossRefText = `<span class="cross-ref-badge">Linked from ${prevLayerKey}</span>`;
            entityDiv.classList.add("cross-ref");
        }
    }

    header.innerHTML = `<span>${crossRefText} ${headerText}</span> <span>&#9660;</span>`;
    entityDiv.appendChild(header);

    const content = document.createElement("div");
    content.className = "entity-content";
    content.style.display = "block";

    header.addEventListener("click", () => {
        content.style.display = content.style.display === "none" ? "block" : "none";
        header.querySelector("span:last-child").innerText = content.style.display === "none" ? "\u25B6" : "\u25BC";
    });

    // Render each sheet's transaction table
    const sheetNames = Object.keys(filteredSheetsData);
    for (let s = 0; s < sheetNames.length; s++) {
        const sheetName = sheetNames[s];
        const rows = filteredSheetsData[sheetName];
        const txnSection = document.createElement("div");
        txnSection.className = "transaction-section";
        txnSection.innerHTML = `<h4>${sheetName} (${rows.length})</h4>`;

        const table = document.createElement("table");
        table.className = "data-table";

        const originalHeaders = window.appState.rawData[sheetName].headers;

        const thead = document.createElement("thead");
        const trHead = document.createElement("tr");
        originalHeaders.forEach(col => {
            const th = document.createElement("th");
            th.innerText = col;
            th.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        table.appendChild(tbody);
        txnSection.appendChild(table);

        const paginationControls = document.createElement("div");
        paginationControls.className = "pagination-controls";
        paginationControls.style.display = "none";
        const prevBtn = document.createElement("button");
        const pageInfo = document.createElement("span");
        const nextBtn = document.createElement("button");
        paginationControls.appendChild(prevBtn);
        paginationControls.appendChild(pageInfo);
        paginationControls.appendChild(nextBtn);
        txnSection.appendChild(paginationControls);

        const ROWS_PER_PAGE = 50;
        table.filteredRows = rows;
        table.currentPage = 1;

        table.renderPage = () => {
            const totalPages = Math.ceil(table.filteredRows.length / ROWS_PER_PAGE) || 1;
            if (table.currentPage > totalPages) table.currentPage = totalPages;

            tbody.innerHTML = "";
            const start = (table.currentPage - 1) * ROWS_PER_PAGE;
            const end = start + ROWS_PER_PAGE;
            const pageRows = table.filteredRows.slice(start, end);

            for (let r = 0; r < pageRows.length; r++) {
                const row = pageRows[r];
                const tr = document.createElement("tr");
                originalHeaders.forEach(col => {
                    const td = document.createElement("td");
                    td.innerText = row[col] !== null && row[col] !== undefined ? row[col] : "";
                    td.className = isPrimaryEntityCol(col) ? "primary-entity-col" : "";
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }

            setupPrimaryEntityToggle(true);

            if (totalPages > 1) {
                paginationControls.style.display = "flex";
                prevBtn.innerText = "Previous";
                prevBtn.disabled = table.currentPage === 1;
                pageInfo.innerText = `Page ${table.currentPage} of ${totalPages}`;
                nextBtn.innerText = "Next";
                nextBtn.disabled = table.currentPage === totalPages;
            } else {
                paginationControls.style.display = "none";
            }
        };

        prevBtn.addEventListener("click", () => {
            if (table.currentPage > 1) {
                table.currentPage--;
                table.renderPage();
            }
        });

        nextBtn.addEventListener("click", () => {
            const totalPages = Math.ceil(table.filteredRows.length / ROWS_PER_PAGE);
            if (table.currentPage < totalPages) {
                table.currentPage++;
                table.renderPage();
            }
        });

        table.renderPage();
        content.appendChild(txnSection);
    }

    entityDiv.appendChild(content);
    container.appendChild(entityDiv);
}

function checkCrossReference(prevLayerKey, currentEntityName) {
    const prevLayerEntities = window.appState.structuredData[prevLayerKey];
    if (!prevLayerEntities) return false;

    const primaryPatterns = window.appState.primaryEntityPatterns || [];

    for (const senderEntity in prevLayerEntities) {
        for (const sheetName in prevLayerEntities[senderEntity]) {
            const rows = prevLayerEntities[senderEntity][sheetName];
            if (!rows || !rows.length) continue;

            const rowKeys = Object.keys(rows[0]);
            let entityCol = null;
            for (let ki = 0; ki < rowKeys.length; ki++) {
                const kl = rowKeys[ki].toLowerCase();
                for (let pi = 0; pi < primaryPatterns.length; pi++) {
                    if (kl.includes(primaryPatterns[pi])) {
                        entityCol = rowKeys[ki];
                        break;
                    }
                }
                if (entityCol) break;
            }

            let receiverCol = null;
            for (let ki = 0; ki < rowKeys.length; ki++) {
                const kl = rowKeys[ki].toLowerCase();
                if (rowKeys[ki] === entityCol) continue;

                if (kl.includes("to account") || 
                    kl.includes("beneficiary") || 
                    kl.includes("receiver") || 
                    kl.includes("transferred to") || 
                    kl.includes("destination") ||
                    kl === "account no" ||
                    kl === "to_account" ||
                    kl === "toacc") {
                    receiverCol = rowKeys[ki];
                    break;
                }
            }

            const isMoneyTransfer = sheetName.toLowerCase().includes("money transfer") || 
                                    sheetName.toLowerCase().includes("transfer") || 
                                    sheetName.toLowerCase().includes("fund flow") ||
                                    receiverCol !== null;

            if (isMoneyTransfer && receiverCol) {
                for (const row of rows) {
                    if (row[receiverCol] && String(row[receiverCol]).trim() === String(currentEntityName).trim()) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function isPrimaryEntityCol(colName) {
    const lower = colName.toLowerCase();
    return window.appState.primaryEntityPatterns.some(p => lower.includes(p));
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

window.lastSearchQuery = "";

function performSearch(queryText = null, updateWindowRef = true) {
    const searchInput = document.getElementById("global-search");
    const query = queryText !== null ? queryText : searchInput.value.toLowerCase().trim();
    
    if (updateWindowRef) {
        window.lastSearchQuery = query;
        searchInput.value = query;
    }

    const layers = window.appState.layers;
    const navigator = document.getElementById("layer-navigator");
    const summaryBar = document.getElementById("search-summary-bar");

    // 1. Get search statistics using the flat index (single pass)
    let totalMatches = 0;
    const layerMatchCounts = {};
    const matchedLayersSet = new Set();
    const matchedEntitiesSet = new Set();

    if (query !== "") {
        const searchIndex = window.appState.searchIndex;
        for (let i = 0; i < searchIndex.length; i++) {
            if (searchIndex[i].normalizedText.includes(query)) {
                totalMatches++;
                const m = searchIndex[i];
                matchedLayersSet.add(m.layer);
                matchedEntitiesSet.add(m.entity);
                layerMatchCounts[m.layer] = (layerMatchCounts[m.layer] || 0) + 1;
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
                discoveryHTML += `<button class="search-chip ${isActive ? 'active-chip' : ''}" onclick="window.jumpToLayerFromSearch('${layerKey.replace(/'/g, "\\'")}')">${layerKey} (${count})</button>`;
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
        // Use pre-computed layerMatchCounts for sidebar counts instead of re-scanning
        let entityCount;
        if (query) {
            // Count unique entities for this layer from the index
            const entitySet = new Set();
            const searchIndex = window.appState.searchIndex;
            for (let i = 0; i < searchIndex.length; i++) {
                if (searchIndex[i].layer === layerKey && searchIndex[i].normalizedText.includes(query)) {
                    entitySet.add(searchIndex[i].entity);
                }
            }
            entityCount = entitySet.size;
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
    if (window.appState.cy && window.initMindMap && graphTab && graphTab.classList.contains("active")) {
        window.initMindMap();
    }
}
window.performSearch = performSearch;

window.jumpToLayerFromSearch = function(layerKey) {
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
    const entities = window.appState.structuredData[layerKey];
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
    const searchIndex = window.appState.searchIndex;
    let count = 0;
    for (let i = 0; i < searchIndex.length; i++) {
        if (searchIndex[i].layer === layerKey && searchIndex[i].normalizedText.includes(query)) {
            count++;
        }
    }
    return count;
}

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
