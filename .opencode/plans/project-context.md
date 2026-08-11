# Financial Transaction Visualizer - Complete Project Context

## Project Overview
A browser-based, local-first financial transaction analysis tool for reading, organizing, visualizing, and exporting layered bank-trail data from Excel (`.xlsx`) files. No backend required - runs entirely in the browser.

## Current Architecture

### Module Structure (IIFE pattern, no ES modules for file:// compatibility)
| File | Responsibility |
|------|----------------|
| `app-core.js` | Shared namespace `PersonallApp` - state, formatters, Utils (parseAmount, normalizeHeaders, buildRowObject, isAmountHeader, isReceiverHeader, isMoneyTransferSheet) |
| `app.js` | File upload, Web Worker/main-thread parsing, structureData, buildSearchIndex, buildSheetColumnIndex, updateDashboardUI, IFSC bulk resolution |
| `table.js` | Table view rendering, sidebar, pagination, search, cross-layer linking, IFSC address column |
| `mindmap.js` | Cytoscape.js graph visualization, performance mode, swimlane/concentric layouts |
| `ifsc.js` | Razorpay IFSC API lookup, localStorage cache, fallback dictionary, bulk resolution |
| `export.js` | Word (.docx) export modal, presets, column selection, hierarchical document generation |

### Script Load Order (index.html)
```html
<script src="config.js"></script>
<script src="libs/xlsx.full.min.js"></script>
<script src="libs/cytoscape.min.js"></script>
<script src="libs/docx.js"></script>
<script src="js/app-core.js"></script>
<script src="js/ifsc.js"></script>
<script src="js/app.js"></script>
<script src="js/table.js"></script>
<script src="js/mindmap.js"></script>
<script src="js/export.js"></script>
```

### State Management
`PersonallApp.state` contains:
- `rawData` - {sheetName: {headers[], rows[]}}
- `structuredData` - {layerKey: {entityName: {sheetName: rows[]}}}
- `layers` - sorted layer keys ["Layer 1", "Layer 2", ... "Unclassified Data"]
- `stats` - {layers, entities, transactions, totalAmount}
- `searchIndex` - flat array for global search
- `sheetColInfo` / `layerReceiverSets` - precomputed for O(1) lookups
- `sheetIFSC` - sheet-level IFSC metadata
- `primaryEntityPatterns`, `layerPatterns` - detection patterns

## Key Implemented Features

### 1. Excel Parsing (Web Worker + Fallback)
- **Worker path** (HTTP/HTTPS): Embeds XLSX + helpers via `.toString()`, parses off main thread
- **Main-thread fallback** (file://): Sheet-by-sheet async with `setTimeout` yield
- **Multiple files**: Merged rawData with sheet name collision handling
- **Header detection**: First row within first 10 with >2 non-empty cells
- **Header normalization**: `normalizeHeaders()` - dedupes, trims, deterministic blank names (`Column_N`)
- **Row building**: `buildRowObject()` - pads ragged rows with `null`

### 2. Data Structuring
- `structureData()` organizes by Layer → Primary Entity → Sheet
- Layer detection: "Layer N" from layer column values, or "Unclassified Data"
- Amount parsing: `parseAmountValue()` handles Indian format (1,00,000), suffixes (Cr/L/K), parentheses negatives, currency symbols
- Stats computed during structuring (transactions, totalAmount)

### 3. Search & Indexing
- `buildSearchIndex()` - flat index with normalizedText, layer, entity, sheet
- `performSearch()` - single-pass index scan, per-layer entity sets, debounced input
- Search summary bar with layer chips, cross-layer jump

### 4. Table View
- Lazy layer loading (only active layer rendered initially)
- Time-sliced entity rendering (`ENTITIES_PER_FRAME=8`)
- Pagination (50 rows/page)
- Cross-reference badges using precomputed `layerReceiverSets`
- IFSC address column with cache status badges, retry buttons
- Primary entity column toggle

### 5. Mind Map / Graph
- Cytoscape.js with 10-layer color palette
- **Performance mode** (>500 txns): aggregates money transfers & terminal flows
- Swimlane (breadthfirst) and Concentric layouts
- Fullscreen, zoom, pan controls
- Click entity → global search + switch to table view
- Layer highlighting in graph

### 6. IFSC Resolution
- Razorpay API (`https://ifsc.razorpay.com/{IFSC}`)
- localStorage cache with corruption recovery
- Bank prefix fallback dictionary (87 banks)
- Bulk resolution with layer-priority ordering, concurrency=2
- CORS detection → local server banner
- Event-driven cell updates (`ifsc-resolved` CustomEvent)

### 7. Word Export
- Modal with presets: All Data / Investigation Summary / Custom Selection
- Column search, per-sheet select-all, global select-all
- Hierarchical: Layer → Entity → Sheet → Receiver groups
- Pre-resolves selected IFSC codes before document build
- Professional formatting: Calibri, colored headers by sheet type, shaded divider rows, zebra striping, page breaks
- Progress tracking with UI updates

## Identified Gaps & Requirements (from user)

### 1. **File Persistence Across Refresh** (Notebook-type experience)
- **Problem**: file:// mode loses uploaded data on refresh; user must re-upload
- **Solution**: Store ArrayBuffers in IndexedDB; restore on load; show "Recent Workbooks" panel

### 2. **Mind Map Darker Color Palette**
- **Problem**: Current colors are bright/presentation-unfriendly
- **Solution**: Darker, professional palette with better contrast for entity transaction visualization

### 3. **Vast Data Workbook Support** (1000s rows, multiple sheets/columns)
- **Current**: All rows loaded into memory; DOM pagination only
- **Needed**: 
  - Virtual scrolling for tables (render only visible rows)
  - Streaming parse for massive files
  - Search index optimization (suffix array / inverted index)
  - Memory monitoring & chunked processing

### 4. **Bank Branch & Address Column Enhancement**
- **Current**: Works but could be smoother
- **Enhancements**:
  - Pre-fetch for visible rows
  - Batch API requests
  - Better loading states
  - Offline-first with stale-while-revalidate

### 5. **Professional Export Document Formatting**
- **Current**: Good structure but formatting could be more polished
- **Requirements**:
  - Consistent professional typography (no visual formatting needed by user)
  - Proper heading hierarchy with TOC
  - Page numbers, headers/footers with metadata
  - Better wide table handling (landscape, font scaling)
  - Cover page with workbook summary
  - Appendix with IFSC resolution log

### 6. **Complete Integration & Smooth Operation**
- All modules must work seamlessly together
- Error boundaries & graceful degradation
- Performance monitoring
- Comprehensive testing for edge cases

---

## Technical Debt / Code Quality Issues

1. **Duplicate logic**: `findEntityCol`/`findAmountCol`/`isMoneyTransfer` logic repeated in app.js, table.js, mindmap.js, export.js
2. **Global dependencies**: Modules access `App.state` directly instead of passed parameters
3. **No TypeScript**: No type safety for complex data structures
4. **No tests**: Zero automated tests
5. **CSS custom properties** used but no dark mode support
6. **Worker code** built via string concatenation - fragile

---

## Files to Reference for Implementation

### Core Files (must understand)
- `js/app-core.js` - Shared utilities & formatters
- `js/app.js` - Main orchestration, parsing, diagnostics
- `js/table.js` - Table rendering, search, pagination
- `js/mindmap.js` - Graph visualization
- `js/ifsc.js` - IFSC lookup & cache
- `js/export.js` - Word document generation
- `css/style.css` - All styling

### Config
- `config.js` - Razorpay API URL (extend for more settings)
- `config.sample.js` - Template