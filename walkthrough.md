# Deep Audit Report - Financial Transaction Visualizer

This report details the findings of an end-to-end audit of the codebase against the claims made in previous commits, tested against expected real-world multi-sheet workbooks.

## PART 1: DEEP AUDIT OF EXISTING CLAIMS

### 1. "IFSC/Bank Branch & Address column appears in every table"
**Status: FALSE / PARTIALLY TRUE**
- **Findings:** The code in `table.js` unconditionally appends a "Bank Branch & Address" header (`thAddr.innerText = "Bank Branch & Address";`) and a corresponding table cell to *every* table, regardless of whether the sheet actually contains IFSC codes.
- **The Bug:** For sheets where IFSCs do not exist, the column appears but is permanently filled with empty values (`-`), cluttering the UI and potentially causing confusion. If an IFSC code is buried in metadata rows but the cell value regex fails, or if `getRowIFSC` fails to find it due to column name mismatches, the lookup fails to populate.
- **Fix Required:** The column must be added *conditionally* per sheet, strictly based on whether any row in that sheet actually returns a detected IFSC code from the `hasIFSCData` or `getRowIFSC` logic.

### 2. "Dynamic Online Lookup & Local Caching via Razorpay API"
**Status: PARTIALLY TRUE**
- **Findings:** The fetch call is implemented in `ifsc.js`. While it handles basic caching via `localStorage`, it has several major flaws for a production file:// application:
  - **CORS / Null Origin:** `fetch` requests originating from `file://` (null origin) can be blocked by strict browser security policies silently. There's no proactive test to inform the user if this happens.
  - **Rate Limiting & Deduplication:** If a sheet renders 500 rows with the same uncached IFSC, `table.js` calls `window.lookupIFSC` 500 times simultaneously. The `fetch` calls are not deduplicated or rate-limited before hitting the cache, resulting in network hammering and potential API throttling.
  - **LocalStorage Limit:** On every API response, `window.ifscCache` is stringified and saved to `localStorage`. A large workbook with thousands of unique IFSCs could exceed the 5MB quota, causing silent `QuotaExceededError` exceptions and breaking the cache.
- **Fix Required:** Implement a dynamic CORS test. Introduce a rate-limited, deduplicated request queue for bulk lookups.

### 3. "Smart Offline Fallback via prefix dictionary"
**Status: TRUE**
- **Findings:** `window.getBankNameFromIFSC` in `ifsc.js` effectively maps 41 common Indian bank prefixes and correctly falls back to `prefix + " Bank"` for unknown codes. This degrades gracefully without throwing errors.

### 4. "Word Export includes Bank Branch & Address, no data loss"
**Status: PARTIALLY TRUE**
- **Findings:** The export logic in `export.js` *does* attempt to `await` pending IFSC lookups sequentially before building the document.
- **The Bug:** It unconditionally adds the "Bank Branch & Address" column option to the export modal for every sheet, even those without IFSC data. Sequential resolution of un-cached IFSC codes can cause the export to hang for a long time on large files.
- **Fix Required:** Restrict the virtual column to relevant sheets. Await the new bulk resolution queue to prevent race conditions or UI hangs during export.

### 5. "Professional formatting: Calibri font, page breaks, zebra striping"
**Status: TRUE**
- **Findings:** `export.js` uses `docx.js` to correctly apply "Calibri" fonts, insert `docx.PageBreak()` between layers, and alternate row shading (`FFFFFF` and `F8F9F9`).

### 6. "Horizontal scrollbar for wide tables"
**Status: TRUE**
- **Findings:** Handled correctly via CSS / layout flow, assuming standard table containment is used.

### 7. "Indian numbering system (Lakh/Crore)"
**Status: PARTIALLY TRUE**
- **Findings:** `formatAmount` exists in `mindmap.js` and inline in `app.js`.
- **The Bug:** It doesn't handle negative numbers, zero, or `NaN`/blank gracefully. Negative numbers pass through as raw values or divide incorrectly. Zero is not explicitly formatted as `0.00`.
- **Fix Required:** Extract `formatAmount` to a global utility in `app.js` and handle `NaN`, negative values, and zero appropriately, replacing invalid values with `—`.

### 8. "Mind map pan controls, fullscreen toggle, improved fitting"
**Status: TRUE**
- **Findings:** `mindmap.js` hooks these controls to Cytoscape correctly (`panBy`, `fit`, `zoom`), and the aggregation threshold performance optimizations remain intact.

---
**Summary:** The core structure is solid, but race conditions, lack of rate-limiting, missing conditional logic for the virtual column, and unhandled numeric edge cases require immediate fixes before the application is production-ready.

## PART 2: REQUIRED FIXES & IMPLEMENTATION DIAGNOSTICS

### Diagnostic Audit Requirements

As part of the final implementation, the application now includes a diagnostic self-test/audit report generated after parsing a workbook. It tracks:

1. **Sheet Data:**
   - Sheet name
   - Total source rows
   - Whether a "Layer" column was detected
   - Whether a "Primary Entity" column was detected
   - Whether "IFSC" data was detected
   - IFSC detection source (Header, Row Cell scan, Metadata/Sheet-level, or None)
   - Whether the virtual "Bank Branch & Address" column is shown for that sheet

2. **Overall Resolution Stats:**
   - Total number of unique IFSC codes detected
   - API-resolved count (success via Razorpay)
   - Cache-resolved count (loaded from previous successful lookups)
   - Offline-fallback count (resolved via prefix dictionary)
   - Failed count (invalid codes or complete failures)
   - Skipped/unclassified row count (rows not matching Layer/Entity rules)

This diagnostic report guarantees transparency, ensuring no data is silently dropped, and providing explicit reasons why a virtual column appears (or doesn't appear) on a per-sheet basis.

---

## Critical Fixes

### Critical Fix 1: Global formatAmount recursion causing stack overflow (FIXED)
- **Root Cause:** In `mindmap.js`, a top-level function named `formatAmount` collided with `window.formatAmount` defined in `app.js`. When `updateDashboardUI()` called `window.formatAmount()` on file upload, it was overridden by the mindmap version which itself called `window.formatAmount()`, causing infinite self-recursion.
- **Fix:** The helper in `mindmap.js` was renamed to `localFormatAmount` and now delegates to the shared `window.personallFormatters.amount`. A single shared formatter namespace (`window.personallFormatters`) was introduced in `app.js` to reduce cross-file global collision risk.
- **Verification:** All `formatAmount(` call sites now point to the intended implementation. Dashboard totals, graph edge labels, graph node labels, and export formatting all work correctly.

### Critical Fix 2: IFSC object/string mismatch causing broken export lookups (FIXED)
- **Root Cause:** `window.getRowIFSC()` returns an object `{ code: "...", source: "..." }` but some callers passed the raw object directly to `window.ifscCache` and `window.lookupIFSC()` instead of extracting `.code`. This produced broken API URLs like `https://ifsc.razorpay.com/[object Object]`.
- **Fix:** Added `window.safeExtractIFSC()` helper (`ifsc.js:294`) that safely handles string, object-with-code, null, and invalid formats. All callers in `app.js`, `table.js`, and `export.js` now use this helper consistently.
- **Verification:** IFSC cache keys are always strings. Export lookups produce valid URLs. No `[object Object]` appears in console, tables, or exported output.

### Critical Fix 3: ifscData reference error in table.js (FIXED)
- **Bug:** `table.js:288` referenced `ifscData.source` but `ifscData` was never defined — the correct variable is `ifscVal`. This caused a `ReferenceError: ifscData is not defined` that was caught by the `updateDashboardUI()` try/catch and displayed as "Error structuring data: ifscData is not defined".
- **Fix:** Changed `ifscData.source` to `ifscVal.source` at `table.js:288`.
- **Verification:** The error no longer appears on workbook upload. All IFSC address cells correctly populate with resolved data.

### Critical Fix 4: IFSC resolution race condition — "Looking up..." never resolves (FIXED)
- **Root Cause:** A race condition between bulk pre-resolution and per-cell lookups. `lookupIFSC` in `ifsc.js` returned "Looking up..." immediately when an IFSC was already `{status:"pending"}` in cache (set by bulk resolution), without queuing the callback. The bulk resolution's fetch then completed and dispatched an `ifsc-resolved` custom event, but `table.js` never listened for it. Result: cells were stuck on "Looking up..." permanently.
- **Fix:** Two changes:
  1. **`ifsc.js`** — Implemented callback queuing via `window.ifscCallbackQueue`. When `lookupIFSC` encounters a pending code, it queues the callback instead of returning "Looking up..." immediately. When the fetch completes, `firePendingCallbacks()` invokes all queued callbacks for that code.
  2. **`table.js`** — Added `document.addEventListener('ifsc-resolved', ...)` that finds all `td[data-ifsc="..."]` cells in the DOM and updates them with the resolved address. The `data-ifsc` attribute is now set on every address cell during rendering.
- **Verification:** Cells now transition from "Looking up..." → resolved address or fallback in real-time as bulk resolution completes. No more stuck cells.

### Critical Fix 5: Mind map graph generation performance (FIXED)
- **Root Cause:** `generateGraphElements` in `mindmap.js` scanned column headers for every single row to find entity/amount/receiver columns, even though column positions are identical across rows within the same sheet. For large workbooks with thousands of rows, this caused significant lag.
- **Fix:** Pre-compute per-sheet column info (`entityCol`, `amountCol`, `receiverCol`, `isMoneyTransfer`) once via a `sheetColInfo` cache object. The row loop now uses the pre-computed values directly. Also optimized `rowMatchesQuery` to return early on first match instead of building a full concatenated string per row.
- **Verification:** Mind map generation is now O(rows × 1) instead of O(rows × columns) for column scans. Measurable improvement for workbooks with 500+ rows per sheet.
