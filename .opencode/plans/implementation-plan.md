# Financial Transaction Visualizer - Complete Implementation Plan

## Executive Summary
This plan addresses all gaps identified in the deep audit and implements the user's explicit requirements for a production-ready, notebook-style financial transaction visualizer that handles vast workbooks with professional export capabilities.

---

## Phase 1: File Persistence & Notebook Experience (Week 1)

### 1.1 IndexedDB Storage Layer
**File**: `js/storage.js` (new module)
- **Schema**: 
  - `workbooks` store: {id, name, files[], arrayBuffers[], timestamp, metadata}
  - `settings` store: user preferences
- **API**: `saveWorkbook()`, `loadWorkbook()`, `listWorkbooks()`, `deleteWorkbook()`
- **Integration**: Call from `handleFiles()` after parsing; auto-save on each upload
- **Restore**: On DOMContentLoaded, check for saved workbooks → show "Recent Workbooks" panel in upload overlay

### 1.2 Recent Workbooks Panel (UI)
**Files**: `index.html` (upload overlay), `js/app.js`, `css/style.css`
- Add collapsible "Recent Workbooks" section below drop zone
- Show: filename, upload date, sheet count, row count, file size
- Click to restore → re-parse from stored ArrayBuffers
- "Clear History" button

### 1.3 Session Recovery
- Auto-save current workbook state every 30s to IndexedDB
- On refresh: detect incomplete session → prompt "Restore previous session?"

---

## Phase 2: Mind Map Darker Professional Palette (Week 1)

### 2.1 New Color System
**File**: `js/mindmap.js` - `layerColors` array
```javascript
// Darker, presentation-ready palette (WCAG AA contrast on dark backgrounds)
var layerColors = [
  '#1e3a5f', // Layer 1 - Dark Navy
  '#1b4d3e', // Layer 2 - Dark Forest Green
  '#7b3f00', // Layer 3 - Dark Amber
  '#4a1a6e', // Layer 4 - Dark Purple
  '#7b1e1e', // Layer 5 - Dark Crimson
  '#0d5c5c', // Layer 6 - Dark Teal
  '#5d3a00', // Layer 7 - Dark Ochre
  '#2c2c44', // Layer 8 - Dark Slate
  '#7b5b00', // Layer 9 - Dark Gold
  '#0c5c4d'  // Layer 10 - Dark Emerald
];
var unclassifiedColor = '#4a4a5a'; // Dark grey for unclassified
```

### 2.2 Edge Styling Updates
- Money transfer edges: use layer color with opacity
- Terminal flow edges: darker complementary colors
- Ensure all text has sufficient contrast (white text on dark nodes)

### 2.3 Theme Toggle (Optional Enhancement)
- Add "Graph Theme: Dark/Light" toggle in graph controls
- Persist preference in localStorage

---

## Phase 3: Vast Data Workbook Support (Week 2-3)

### 3.1 Virtual Scrolling for Tables
**File**: `js/table.js` - replace pagination with virtual scrolling
- **Library**: Implement lightweight virtual scroller (no external deps)
- **Approach**: 
  - Fixed row height (~35px)
  - Render only visible rows + buffer (5 rows above/below)
  - Use `IntersectionObserver` or scroll position calculation
  - Maintain sticky headers
- **Benefits**: Handle 100k+ rows without DOM explosion

### 3.2 Streaming Parse for Large Files
**File**: `js/app.js` - enhance `processWorkbookAsync`
- Use SheetJS streaming: `XLSX.stream.to_json()` 
- Process in chunks of 1000 rows
- Yield to main thread between chunks
- Update progress UI incrementally

### 3.3 Search Index Optimization
**File**: `js/app.js` - `buildSearchIndex`
- **Current**: Flat array O(n) scan
- **Optimized**: Inverted index per column + trigram index for fuzzy search
- **Implementation**:
  - Build Map<column, Map<normalizedValue, rowIds[]>>
  - For text search: n-gram (trigram) index for substring matching
  - Keep flat index for exact matches, use inverted for filtered

### 3.4 Memory Management
- Add `PerformanceMonitor` utility:
  - Track heap usage via `performance.memory` (Chrome)
  - Warn at 80% threshold
  - Auto-clear non-active layer DOM
  - Implement LRU cache for rendered layers

### 3.5 Web Worker Streaming
- Move entire parse pipeline to Worker
- Stream chunks via `postMessage` with `{type: 'chunk', data: [...]}`
- Main thread builds UI incrementally

---

## Phase 4: Bank Branch & Address Column Enhancement (Week 2)

### 4.1 Pre-fetch & Batch Resolution
**File**: `js/table.js` - `renderPage()` / `ifscCellsToUpdate`
- On page render: collect all unique IFSCs in visible rows + next 2 pages
- Single bulk resolution call instead of per-cell
- Show "Resolving X addresses..." progress in column header

### 4.2 Stale-While-Revalidate Cache
**File**: `js/ifsc.js`
- Serve cached data immediately (even if stale)
- Background refresh for entries > 7 days old
- Visual indicator: subtle refresh icon on stale entries

### 4.3 Offline-First Architecture
- Service Worker for API caching (Workbox or custom)
- Background sync for failed lookups when online
- Queue failed lookups in IndexedDB → retry on connectivity

### 4.4 Enhanced Address Display
- Tooltip on hover: full address, contact, MICR, RTGS/NEFT/IMPS/UPI flags
- Copy-to-clipboard button on each address cell
- "Open in Maps" link (Google Maps / OpenStreetMap)

---

## Phase 5: Professional Export Document Formatting (Week 3)

### 5.1 Document Architecture Overhaul
**File**: `js/export.js` - `buildDocxObject()`
- **Cover Page**: Workbook name, date, total layers/entities/transactions, generated timestamp
- **Table of Contents**: Auto-generated with page numbers (docx supports TOC fields)
- **Executive Summary**: Stats cards, top entities by volume, amount distribution
- **Layer Sections**: Professional hierarchy with consistent styling
- **Appendices**: 
  - Appendix A: IFSC Resolution Log (code, bank, branch, status, source)
  - Appendix B: Column Mapping (sheet → selected columns)
  - Appendix C: Data Quality Report (unclassified rows, missing amounts, duplicates)

### 5.2 Typography & Styling System
```javascript
const styles = {
  // Consistent sizing (half-points)
  coverTitle: { size: 56, bold: true, color: '1A1A2E', font: 'Calibri' },
  coverSubtitle: { size: 24, color: '4A4A6A', font: 'Calibri' },
  heading1: { size: 32, bold: true, color: '1A1A2E', font: 'Calibri', spacing: { before: 400, after: 200 } },
  heading2: { size: 26, bold: true, color: '2C3E50', font: 'Calibri', spacing: { before: 300, after: 150 } },
  heading3: { size: 22, bold: true, color: '2980B9', font: 'Calibri', spacing: { before: 200, after: 100 } },
  body: { size: 19, font: 'Calibri', color: '333333' },
  tableHeader: { size: 18, bold: true, font: 'Calibri', color: 'FFFFFF' },
  tableCell: { size: 17, font: 'Calibri', color: '333333' },
  tableCellAlt: { size: 17, font: 'Calibri', color: '333333' },
  footer: { size: 16, font: 'Calibri', color: '7F8C8D' },
  caption: { size: 16, italic: true, font: 'Calibri', color: '7F8C8D' }
};
```

### 5.3 Page Layout & Numbering
- **Page size**: A4 (default) with configurable orientation per section
- **Margins**: 1 inch all sides
- **Headers**: Layer name (odd) / Workbook name (even)
- **Footers**: Page X of Y (center), Generated date (right)
- **Section breaks**: Next page for each Layer; Continuous for entities

### 5.4 Table Formatting Excellence
- **Auto-fit columns**: Calculate optimal width from content (max 15cm)
- **Wide tables**: Auto-rotate to landscape for sheets > 12 columns
- **Header repeat**: Repeat header row on each page
- **Cell padding**: 4pt top/bottom, 6pt left/right
- **Borders**: Thin (4pt) inner, Medium (8pt) outer
- **Shading**: Alternating rows (FFFFFF / F8F9FA), header (2C3E50 with white text)

### 5.5 Amount Formatting Consistency
- Use `App.formatters.amount()` everywhere (already implemented)
- Indian numbering in tables: 1,23,45,678.90
- Summary values: 12.34 Cr / 56.78 L / 9.00 K format

### 5.6 Export Presets Enhancement
- **All Data**: Everything with full detail
- **Investigation Summary**: Cover + Executive Summary + Layer summaries (aggregated) + IFSC log
- **Custom Selection**: Current behavior
- **New**: **Audit Trail** - Only money transfer sheets with full receiver chains

---

## Phase 6: Integration, Polish & Quality (Week 4)

### 6.1 Deduplicate Shared Logic
**New File**: `js/shared-utils.js` (or extend `app-core.js` Utils)
Move to single source:
- `findEntityCol(headers, patterns)`
- `findAmountCol(headers)`
- `findReceiverCol(headers, entityCol)`
- `isMoneyTransferSheet(sheetName, headers)`
- `parseAmount(val)` - single implementation

### 6.2 Error Boundaries & Graceful Degradation
- Wrap each module init in try/catch
- `window.onerror` handler → user-friendly toast
- If Cytoscape fails → disable graph tab with explanation
- If docx fails → fallback to CSV export

### 6.3 Performance Monitoring
**File**: `js/perf-monitor.js` (new)
- `mark(name)`, `measure(name, startMark)`
- Report to console in dev mode
- UI: "Performance" panel in settings (shift+ctrl+P)

### 6.4 Accessibility (WCAG 2.1 AA)
- Semantic HTML (already good)
- ARIA labels on all interactive elements
- Keyboard navigation for all controls
- Focus indicators
- Color contrast verification
- Screen reader announcements for dynamic content

### 6.5 Configuration System
**File**: `js/config.js` - extend
```javascript
window.APP_CONFIG = {
  RAZORPAY_IFSC_API_URL: "https://ifsc.razorpay.com/",
  IFSC_API_KEY: "",
  MAX_FILE_SIZE_MB: 50,
  VIRTUAL_SCROLL_THRESHOLD: 5000, // rows
  CACHE_TTL_DAYS: 30,
  EXPORT_DEFAULT_ORIENTATION: 'portrait',
  GRAPH_THEME: 'dark', // 'dark' | 'light'
  ENABLE_SERVICE_WORKER: true
};
```

### 6.6 Service Worker (PWA-lite)
**File**: `sw.js` (new)
- Cache static assets (HTML, CSS, JS, libs)
- Cache IFSC API responses (stale-while-revalidate)
- Offline fallback page
- Background sync for failed exports

---

## Phase 7: Testing & Documentation (Week 4)

### 7.1 Test Matrix
| Scenario | Rows | Sheets | Columns | Expected |
|----------|------|--------|---------|----------|
| Small | 100 | 3 | 10 | < 1s parse |
| Medium | 5,000 | 10 | 20 | < 5s parse |
| Large | 50,000 | 20 | 30 | < 30s parse |
| Huge | 200,000 | 50 | 50 | < 2min parse |

### 7.2 Edge Cases to Verify
- Duplicate headers across sheets
- Ragged rows (missing trailing columns)
- Sheets with no data rows
- Special characters in sheet names
- Circular references in layer detection
- IFSC codes in non-IFSC columns
- Negative amounts in parentheses
- Mixed date formats
- Password-protected files (graceful error)

### 7.3 Documentation Updates
- Update `README.md` with new features
- Add `ARCHITECTURE.md` for developers
- Add `CONTRIBUTING.md`
- Inline JSDoc for all public functions

---

## Implementation Priority Order

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| P0 | 1 - Persistence | Medium | High (user pain point) |
| P0 | 2 - Dark Palette | Low | High (presentation) |
| P1 | 4 - IFSC Enhancement | Medium | High (core feature) |
| P1 | 5 - Export Polish | Medium | High (deliverable quality) |
| P2 | 3 - Vast Data | High | Medium (scale) |
| P2 | 6 - Integration | High | Medium (maintainability) |
| P3 | 7 - Testing/Docs | Medium | Low (quality) |

---

## File Change Summary

### New Files
1. `js/storage.js` - IndexedDB persistence
2. `js/shared-utils.js` - Deduplicated utilities
3. `js/perf-monitor.js` - Performance tracking
4. `sw.js` - Service Worker
5. `js/config-extended.js` - Extended config

### Modified Files
1. `js/app-core.js` - Add config, remove duplicated utils
2. `js/app.js` - Integrate storage, streaming parse
3. `js/table.js` - Virtual scroll, IFSC pre-fetch
4. `js/mindmap.js` - Dark palette, theme toggle
5. `js/ifsc.js` - Stale-while-revalidate, batch API
6. `js/export.js` - Professional formatting overhaul
7. `index.html` - Recent workbooks panel, PWA manifest
8. `css/style.css` - Dark graph theme, virtual scroll styles
9. `config.js` - Extended configuration

### Configuration
- `config.js` - Extended with new options
- `manifest.json` - PWA manifest

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| IndexedDB quota exceeded | Medium | High | Implement LRU eviction, warn user |
| Virtual scroll flicker | Medium | Medium | CSS containment, fixed row heights |
| docx generation OOM | Low | High | Chunked build, blob streaming |
| Service Worker cache stale | Medium | Low | Versioned caches, skipWaiting |
| Breaking file:// compatibility | Low | High | Test both protocols, graceful fallback |

---

## Success Criteria

1. ✅ File persists across refresh (no re-upload needed)
2. ✅ Mind map uses dark professional palette
3. ✅ Handles 100k+ rows without UI freeze
4. ✅ IFSC column resolves smoothly with batch/pre-fetch
5. ✅ Export produces publication-ready Word docs
6. ✅ All modules integrated with zero console errors
7. ✅ Works on file:// and http://localhost
8. ✅ Accessible (WCAG 2.1 AA)
9. ✅ Zero duplicated logic across modules