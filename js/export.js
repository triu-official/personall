(function(App) {
    'use strict';

    var Export = App.Export || {};
// Export Logic

// Guarded IFSC accessors — export must never hard-crash if the IFSC module
// is unavailable (defensive, mirrors table.js).
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
    return (App.IFSC && App.IFSC.getCache) ? (App.IFSC.getCache() || {}) : {};
}
function ifscLookup(code, cb) {
    if (App.IFSC && App.IFSC.lookupIFSC) {
        App.IFSC.lookupIFSC(code, cb);
        return;
    }
    if (cb) cb({ address: '-', bank: '-', branch: '-', status: 'error' });
}
function ifscHasData(sheetName) {
    return !!(App.IFSC && App.IFSC.hasIFSCData && App.IFSC.hasIFSCData(sheetName));
}
function ifscGetIFSCCachedSync(code) {
    return (App.IFSC && App.IFSC.getIFSCCachedSync) ? App.IFSC.getIFSCCachedSync(code) : null;
}

const yieldToMainThread = () => new Promise(resolve => setTimeout(resolve, 0));

document.addEventListener("DOMContentLoaded", () => {
    const exportBtn = document.getElementById("export-word-btn");
    const modal = document.getElementById("export-modal");
    const closeBtn = document.getElementById("close-export-modal");
    const generateBtn = document.getElementById("generate-word-btn");
    const selectAllBtn = document.getElementById("export-select-all");
    const searchInput = document.getElementById("export-column-search");

    // Preset buttons
    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", (e) => applyPreset(e.target.dataset.preset));
    });

    if (exportBtn) {
        exportBtn.addEventListener("click", () => {
            modal.style.display = "flex";
            renderExportModal();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            modal.style.display = "none";
        });
    }

    // Global Select All / None Checkbox Handler
    if (selectAllBtn) {
        selectAllBtn.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.export-sheet-group').forEach(group => {
                // Only toggle checkboxes that are currently visible to the user
                if (group.style.display !== 'none') {
                    group.querySelectorAll('.col-checkbox, .sheet-toggle').forEach(cb => {
                        cb.checked = isChecked;
                        cb.indeterminate = false;
                    });
                }
            });
            syncAllCheckboxes();
        });
    }

    // Search columns within export modal
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.export-sheet-group').forEach(group => {
                let hasVisible = false;
                group.querySelectorAll('.export-sheet-columns label').forEach(label => {
                    const text = label.textContent.toLowerCase();
                    if (text.includes(query)) {
                        label.style.display = "flex";
                        hasVisible = true;
                    } else {
                        label.style.display = "none";
                    }
                });
                // Hide the entire sheet group if no columns match the search query
                group.style.display = hasVisible ? "block" : "none";
            });
        });
    }

    if (generateBtn) {
        generateBtn.addEventListener("click", () => {
            generateWordDocument();
        });
    }
});

async function generateWordDocument() {
    if (App.state.isExportGenerating) return;

    const loadingUI = document.getElementById("export-loading");
    const generateBtn = document.getElementById("generate-word-btn");

    App.state.isExportGenerating = true;
    if (loadingUI) {
        loadingUI.style.display = "flex";
        loadingUI.innerHTML = `<div class="spinner-small"></div> Generating Document (<span id="export-progress">0%</span>)...`;
    }
    if (generateBtn) generateBtn.disabled = true;

    // Allow UI to render loading state
    setTimeout(async () => {
        try {
            // Pre-resolve selected IFSC codes
            const ifscSet = new Set();
            const selections = App.state.exportSelections;
            const rawData = App.state.rawData;

            Object.keys(rawData).forEach(sheetName => {
                const selectedCols = selections[sheetName] || [];
                if (!selectedCols.includes("Bank Branch & Address")) return;

                const rows = rawData[sheetName].rows || [];
                rows.forEach(row => {
                    const ifscVal = ifscGetRowIFSC(sheetName, row);
                    const code = ifscExtractCode(ifscVal);
                    if (code && !ifscGetCache()[code]) {
                        ifscSet.add(code);
                    }
                });
            });

            const ifscList = Array.from(ifscSet);
            if (ifscList.length > 0) {
                for (let i = 0; i < ifscList.length; i++) {
                    if (loadingUI) {
                        loadingUI.innerHTML = `<div class="spinner-small"></div> Resolving bank addresses (${i + 1}/${ifscList.length})...`;
                    }
                    await new Promise(resolve => {
                        ifscLookup(ifscList[i], function() {
                            resolve();
                        });
                    });
                }
            }

            const doc = await buildDocxObject();
            if (loadingUI) {
                loadingUI.innerHTML = `<div class="spinner-small"></div> Packing file...`;
            }
            await yieldToMainThread();

            const blob = await docx.Packer.toBlob(doc);

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Financial_Export_${new Date().toISOString().split('T')[0]}.docx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error("Failed to generate Word document:", error);
            alert("An error occurred while generating the document. Check console for details.");
        } finally {
            App.state.isExportGenerating = false;
            if (loadingUI) loadingUI.style.display = "none";
            if (generateBtn) generateBtn.disabled = false;
        }
    }, 100);
}

async function buildDocxObject() {
    const docSections = [];
    const selections = App.state.exportSelections;
    const structuredData = App.state.structuredData;

    // Helper formatting functions for Word styling
    const createHeading = (text, level = 1) => {
        let size = 24; // size in half-points (24 = 12pt)
        let color = "2C3E50";
        if (level === 1) { size = 32; color = "2C3E50"; }
        else if (level === 2) { size = 26; color = "34495E"; }
        else if (level === 3) { size = 22; color = "2980B9"; }

        return new docx.Paragraph({
            children: [
                new docx.TextRun({
                    text: text,
                    bold: true,
                    size: size,
                    color: color,
                    font: "Calibri"
                })
            ],
            spacing: { before: level === 1 ? 400 : 200, after: level === 1 ? 200 : 100 }
        });
    };

    const createTable = (sheetName, headers, groupedRowsData, isUnclassified = false) => {
        // Color headers by sheet/transaction type
        const getHeaderColor = (name) => {
            const lower = name.toLowerCase();
            if (lower.includes("transfer")) return "E8F8F5"; // Soft Green
            if (lower.includes("atm")) return "FADBD8";      // Soft Red
            if (lower.includes("pos")) return "FCF3CF";      // Soft Yellow
            if (lower.includes("hold")) return "F5CBA7";     // Soft Orange
            return "EAF2F8"; // Soft Blue (default)
        };

        const headerColor = getHeaderColor(sheetName);
        const tableRows = [];

        // Header Row
        tableRows.push(new docx.TableRow({
            tableHeader: true,
            children: headers.map(headerText => new docx.TableCell({
                children: [new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: headerText,
                            bold: true,
                            font: "Calibri",
                            size: 20 // 10pt
                        })
                    ]
                })],
                shading: { fill: headerColor },
                margins: { top: 120, bottom: 120, left: 120, right: 120 }
            }))
        }));

        if (isUnclassified || !Array.isArray(groupedRowsData)) {
            // Fallback flat rendering
            const flatRows = Array.isArray(groupedRowsData) ? groupedRowsData : [];
            flatRows.forEach((rowObj, index) => {
                const rowColor = index % 2 === 0 ? "FFFFFF" : "F8F9F9";
                tableRows.push(new docx.TableRow({
                    children: headers.map(header => {
                        let cellText = "";
                        if (header === "Bank Branch & Address") {
                            const ifscVal = ifscGetRowIFSC(sheetName, rowObj);
                            const code = ifscExtractCode(ifscVal);
                            if (code && ifscGetIFSCCachedSync(code)) {
                                cellText = ifscGetIFSCCachedSync(code).address;
                            } else {
                                cellText = "—";
                            }
                        } else {
                            cellText = String(rowObj[header] !== null && rowObj[header] !== undefined ? rowObj[header] : '');
                        }
                        return new docx.TableCell({
                            children: [new docx.Paragraph({
                                children: [
                                    new docx.TextRun({
                                        text: cellText,
                                        font: "Calibri",
                                        size: 19 // 9.5pt
                                    })
                                ]
                            })],
                            shading: { fill: rowColor },
                            margins: { top: 60, bottom: 60, left: 120, right: 120 }
                        });
                    })
                }));
            });
        } else {
            // Grouped by receiver
            groupedRowsData.forEach((group) => {
                // Add receiver grouping divider row
                if (group.receiver !== "Unknown Receiver") {
                    tableRows.push(new docx.TableRow({
                        children: [new docx.TableCell({
                            children: [new docx.Paragraph({
                                children: [
                                    new docx.TextRun({
                                        text: `Receiver: ${group.receiver}`,
                                        bold: true,
                                        font: "Calibri",
                                        size: 20
                                    })
                                ]
                            })],
                            shading: { fill: "F2F4F4" }, // Shaded gray divider row
                            margins: { top: 80, bottom: 80, left: 120, right: 120 },
                            columnSpan: headers.length
                        })]
                    }));
                }

                // Add data rows
                group.rows.forEach((rowObj, index) => {
                    const rowColor = index % 2 === 0 ? "FFFFFF" : "F8F9F9";
                    tableRows.push(new docx.TableRow({
                        children: headers.map(header => {
                            let cellText = "";
                            if (header === "Bank Branch & Address") {
                                const ifscVal = ifscGetRowIFSC(sheetName, rowObj);
                                const code = ifscExtractCode(ifscVal);
                                if (code) {
                                    const cached = ifscGetIFSCCachedSync(code);
                                    cellText = cached ? cached.address : "-";
                                    if (cached && cached.status === 'fallback') {
                                        cellText = "Address unavailable — offline lookup failed (" + cached.bank + ")";
                                    }
                                } else {
                                    cellText = "-";
                                }
                            } else if (header.toLowerCase().includes("amount") && typeof rowObj[header] !== 'undefined') {
                                cellText = (App.formatters && App.formatters.amount) ? App.formatters.amount(rowObj[header]) : String(rowObj[header] !== null ? rowObj[header] : "—");
                            } else {
                                cellText = String(rowObj[header] !== null && rowObj[header] !== undefined ? rowObj[header] : '');
                            }
                            return new docx.TableCell({
                                children: [new docx.Paragraph({
                                    children: [
                                        new docx.TextRun({
                                            text: cellText,
                                            font: "Calibri",
                                            size: 19
                                        })
                                    ]
                                })],
                                shading: { fill: rowColor },
                                margins: { top: 60, bottom: 60, left: 120, right: 120 }
                            });
                        })
                    }));
                });
            });
        }

        return new docx.Table({
            rows: tableRows,
            width: { size: 100, type: docx.WidthType.PERCENTAGE }
        });
    };

    // Calculate total entities to process for progress tracking
    let totalSteps = 0;
    App.state.layers.forEach(layerKey => {
        if (layerKey === "Unclassified Data") return;
        totalSteps += Object.keys(structuredData[layerKey] || {}).length;
    });
    if (structuredData["Unclassified Data"]) {
        totalSteps += 1;
    }
    if (totalSteps === 0) totalSteps = 1;

    let currentStep = 0;
    const updateProgress = () => {
        const progressEl = document.getElementById("export-progress");
        if (progressEl) {
            progressEl.innerText = Math.round((currentStep / totalSteps) * 100) + "%";
        }
    };

    // 1. Process Classified Data Hierarchy
    for (const layerKey of App.state.layers) {
        if (layerKey === "Unclassified Data") continue;

        const entities = structuredData[layerKey] || {};
        let layerHasContent = false;
        const layerSection = [];

        for (const entityName of Object.keys(entities)) {
            let entityHasContent = false;
            const entityContent = [];
            const sheets = entities[entityName] || {};

            for (const sheetName of Object.keys(sheets)) {
                const selectedCols = selections[sheetName] || [];
                if (selectedCols.length === 0) continue;

                const rows = sheets[sheetName] || [];
                if (rows.length === 0) continue;

                // Group by receiver
                const originalHeaders = App.state.rawData[sheetName].headers;
                const primaryPatterns = App.state.primaryEntityPatterns || [];
                const entityCol = originalHeaders.find(k => {
                    const kl = k.toLowerCase();
                    return primaryPatterns.some(p => kl.includes(p));
                });
                const receiverColName = originalHeaders.find(k => {
                    if (k === entityCol) return false;
                    const kl = k.toLowerCase();
                    return kl.includes("to account") || 
                           kl.includes("beneficiary") || 
                           kl.includes("receiver") || 
                           kl.includes("transferred to") || 
                           kl.includes("destination") ||
                           kl === "account no" ||
                           kl === "to_account" ||
                           kl === "toacc";
                });

                const isGroupedSheet = receiverColName !== undefined;

                let tableData;
                if (isGroupedSheet) {
                    const grouped = {};
                    rows.forEach(row => {
                        const recVal = (receiverColName && row[receiverColName]) ? String(row[receiverColName]).trim() : "Unknown Receiver";
                        if (!grouped[recVal]) grouped[recVal] = [];
                        grouped[recVal].push(row);
                    });

                    tableData = Object.keys(grouped).map(rec => ({
                        receiver: rec,
                        rows: grouped[rec]
                    }));
                } else {
                    tableData = rows;
                }

                entityHasContent = true;
                entityContent.push(createHeading(`${sheetName} (${rows.length} rows)`, 3));
                entityContent.push(createTable(sheetName, selectedCols, tableData, !isGroupedSheet));
                entityContent.push(new docx.Paragraph({ text: "" }));
            }

            if (entityHasContent) {
                layerHasContent = true;
                layerSection.push(createHeading(`Entity: ${entityName}`, 2));
                layerSection.push(...entityContent);
            }

            currentStep++;
            updateProgress();
            await yieldToMainThread(); // Yield to main thread after each entity
        }

        if (layerHasContent) {
            if (docSections.length > 0) {
                // Add page break before subsequent layers
                docSections.push(new docx.Paragraph({
                    children: [new docx.PageBreak()]
                }));
            }
            docSections.push(createHeading(`Layer: ${layerKey}`, 1));
            docSections.push(...layerSection);
        }
    }

    // 2. Process Unclassified Data
    if (structuredData["Unclassified Data"]) {
        const entities = structuredData["Unclassified Data"] || {};
        let hasUnclassifiedContent = false;
        const unclassifiedSection = [];

        for (const entityName of Object.keys(entities)) {
            const sheets = entities[entityName] || {};
            for (const sheetName of Object.keys(sheets)) {
                const selectedCols = selections[sheetName] || [];
                if (selectedCols.length === 0) continue;

                const rows = sheets[sheetName] || [];
                if (rows.length === 0) continue;

                hasUnclassifiedContent = true;
                unclassifiedSection.push(createHeading(`Sheet: ${sheetName}`, 2));
                unclassifiedSection.push(createTable(sheetName, selectedCols, rows, true));
                unclassifiedSection.push(new docx.Paragraph({ text: "" }));
            }
            await yieldToMainThread();
        }

        if (hasUnclassifiedContent) {
            if (docSections.length > 0) {
                docSections.push(new docx.Paragraph({
                    children: [new docx.PageBreak()]
                }));
            }
            docSections.push(createHeading(`Unclassified Data`, 1));
            docSections.push(...unclassifiedSection);
        }

        currentStep++;
        updateProgress();
        await yieldToMainThread();
    }

    if (docSections.length === 0) {
        docSections.push(new docx.Paragraph({
            children: [
                new docx.TextRun({
                    text: "No data matched the selected columns for export.",
                    font: "Calibri",
                    size: 22
                })
            ]
        }));
    }

    const doc = new docx.Document({
        sections: [{
            properties: {},
            children: [
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: "Financial Transaction Export",
                            bold: true,
                            size: 44, // 22pt
                            color: "2C3E50",
                            font: "Calibri"
                        })
                    ],
                    alignment: docx.AlignmentType.CENTER,
                    spacing: { after: 400 }
                }),
                ...docSections
            ]
        }]
    });

    return doc;
}

function loadSelections() {
    try {
        const saved = localStorage.getItem('personall_export_selections');
        if (saved) {
            App.state.exportSelections = JSON.parse(saved) || {};
        }
    } catch (e) {
        console.error("Failed to load selections", e);
    }
    if (!App.state.exportSelections) {
        App.state.exportSelections = {};
    }
}

function saveSelections() {
    const selections = {};
    document.querySelectorAll('.export-sheet-group').forEach(group => {
        const sheetName = group.dataset.sheet;
        selections[sheetName] = [];
        group.querySelectorAll('.col-checkbox:checked').forEach(cb => {
            selections[sheetName].push(cb.value);
        });
    });
    App.state.exportSelections = selections;
    try {
        localStorage.setItem('personall_export_selections', JSON.stringify(selections));
    } catch (e) {
        console.error("Failed to save selections", e);
    }
}

function applyPreset(presetType) {
    document.querySelectorAll('.export-sheet-group').forEach(group => {
        group.querySelectorAll('.col-checkbox').forEach(cb => {
            if (presetType === 'all') {
                cb.checked = true;
            } else if (presetType === 'none') {
                cb.checked = false;
            } else if (presetType === 'summary') {
                const valLower = cb.value.toLowerCase();
                const isImportant =
                    App.state.primaryEntityPatterns.some(p => valLower.includes(p)) ||
                    App.state.layerPatterns.some(p => valLower.includes(p)) ||
                    valLower.includes('amount') || valLower.includes('date') ||
                    valLower.includes('utr') || valLower.includes('txn') || valLower.includes('remarks');
                cb.checked = isImportant;
            }
        });
    });

    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.preset-btn[data-preset="${presetType}"]`)?.classList.add('active');

    syncAllCheckboxes();
}

function renderExportModal() {
    loadSelections();
    const container = document.getElementById("export-sheets-container");
    container.innerHTML = "";

    const rawData = App.state.rawData;
    if (!rawData || Object.keys(rawData).length === 0) {
        container.innerHTML = "<p>No data available to export.</p>";
        return;
    }

    // Check classified sheets
    const classifiedSheets = new Set();
    const structuredData = App.state.structuredData;

    Object.keys(structuredData).forEach(layer => {
        if (layer === "Unclassified Data") return;
        const entities = structuredData[layer] || {};
        Object.keys(entities).forEach(entity => {
            Object.keys(entities[entity] || {}).forEach(sheet => {
                classifiedSheets.add(sheet);
            });
        });
    });

    const createSheetGroup = (sheetName, headers, rows, isUnclassified) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "export-sheet-group";
        if (isUnclassified) groupDiv.classList.add("unclassified-group");
        groupDiv.dataset.sheet = sheetName;

        const headerDiv = document.createElement("div");
        headerDiv.className = "export-sheet-header";

        headerDiv.innerHTML = `
            <h4>${sheetName} (${rows.length} rows)</h4>
            <label><input type="checkbox" class="sheet-toggle"> Select All</label>
        `;

        const colsDiv = document.createElement("div");
        colsDiv.className = "export-sheet-columns";

        const savedCols = App.state.exportSelections[sheetName];

        headers.forEach(header => {
            // Default to checked if no saved configurations exist
            const isChecked = savedCols ? savedCols.includes(header) : true;
            const label = document.createElement("label");
            label.style.display = "flex";
            label.style.gap = "8px";
            label.style.alignItems = "center";
            label.innerHTML = `<input type="checkbox" class="col-checkbox" value="${header}" ${isChecked ? 'checked' : ''}> <span>${header}</span>`;
            colsDiv.appendChild(label);

            label.querySelector('input').addEventListener('change', () => {
                syncAllCheckboxes();
            });
        });

        const sheetToggle = headerDiv.querySelector('.sheet-toggle');
        sheetToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            colsDiv.querySelectorAll('.col-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
            syncAllCheckboxes();
        });

        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(colsDiv);
        return groupDiv;
    };

    let hasClassified = false;
    let hasUnclassified = false;

    Object.keys(rawData).forEach(sheetName => {
        const { headers, rows } = rawData[sheetName];
        if (headers.length === 0) return;

        const isUnclassified = !classifiedSheets.has(sheetName);
        if (isUnclassified) hasUnclassified = true;
        else hasClassified = true;

        const displayedHeaders = [].concat(headers);
        const hasIFSC = ifscHasData(sheetName);
        if (hasIFSC) {
            displayedHeaders.push("Bank Branch & Address");
        }

        const groupDiv = createSheetGroup(sheetName, displayedHeaders, rows, isUnclassified);

        // Add cache status note if this sheet has IFSC
        if (hasIFSC) {
            const note = document.createElement("div");
            note.style.fontSize = "12px";
            note.style.color = "#7f8c8d";
            note.style.marginTop = "5px";
            note.className = "ifsc-export-note";
            note.innerText = "Includes address cache";
            groupDiv.querySelector('.export-sheet-header').appendChild(note);
        }

        container.appendChild(groupDiv);
    });

    if (hasClassified && hasUnclassified) {
        const firstUnclassified = container.querySelector('.unclassified-group');
        if (firstUnclassified) {
            const separator = document.createElement('h3');
            separator.innerText = "Unclassified Sheets";
            separator.style.marginTop = "20px";
            separator.style.marginBottom = "10px";
            separator.style.color = "var(--secondary-text-color)";
            container.insertBefore(separator, firstUnclassified);
        }
    }

    // Initialize all checkboxes to match loaded state
    syncAllCheckboxes();
}

function syncAllCheckboxes() {
    const globalSelectAll = document.getElementById("export-select-all");
    const sheetGroups = document.querySelectorAll(".export-sheet-group");

    let totalCols = 0;
    let totalCheckedCols = 0;

    sheetGroups.forEach(group => {
        const sheetToggle = group.querySelector(".sheet-toggle");
        const colCheckboxes = group.querySelectorAll(".col-checkbox");

        let sheetCols = colCheckboxes.length;
        let checkedSheetCols = 0;

        colCheckboxes.forEach(cb => {
            if (cb.checked) {
                checkedSheetCols++;
            }
        });

        totalCols += sheetCols;
        totalCheckedCols += checkedSheetCols;

        // Update sheet-level select-all checkbox state
        if (sheetToggle) {
            if (checkedSheetCols === sheetCols && sheetCols > 0) {
                sheetToggle.checked = true;
                sheetToggle.indeterminate = false;
            } else if (checkedSheetCols > 0) {
                sheetToggle.checked = false;
                sheetToggle.indeterminate = true;
            } else {
                sheetToggle.checked = false;
                sheetToggle.indeterminate = false;
            }
        }
    });

    // Update global select-all checkbox state
    if (globalSelectAll) {
        if (totalCheckedCols === totalCols && totalCols > 0) {
            globalSelectAll.checked = true;
            globalSelectAll.indeterminate = false;
        } else if (totalCheckedCols > 0) {
            globalSelectAll.checked = false;
            globalSelectAll.indeterminate = true;
        } else {
            globalSelectAll.checked = false;
            globalSelectAll.indeterminate = false;
        }
    }

    updateSummary();
    saveSelections();
}

function updateSummary() {
    let sheetsSelected = 0;
    let colsSelected = 0;
    let rowsToExport = 0;

    const rawData = App.state.rawData;

    document.querySelectorAll('.export-sheet-group').forEach(group => {
        const sheetName = group.dataset.sheet;
        const checkedCols = group.querySelectorAll('.col-checkbox:checked').length;

        if (checkedCols > 0) {
            sheetsSelected++;
            colsSelected += checkedCols;
            if (rawData[sheetName]) {
                rowsToExport += rawData[sheetName].rows.length;
            }
        }
    });

    const summaryText = document.getElementById("export-summary");
    if (summaryText) {
        summaryText.innerText = `${sheetsSelected} sheets selected, ${colsSelected} columns selected, ${rowsToExport} total data rows to be exported.`;
    }

    const generateBtn = document.getElementById("generate-word-btn");
    const warningText = document.getElementById("export-warning");

    if (colsSelected === 0) {
        if (generateBtn) generateBtn.disabled = true;
        if (warningText) warningText.style.display = "block";
    } else {
        if (generateBtn && !App.state.isExportGenerating) generateBtn.disabled = false;
        if (warningText) warningText.style.display = "none";
    }
}

    // Expose methods
    Export.exportDocument = generateWordDocument;
    Export.openExportModal = renderExportModal;

    App.Export = Export;
})(window.PersonallApp);
