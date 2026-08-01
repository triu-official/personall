# Deep Audit & SPA Migration Plan

## 1. Current Architecture Map
- **Entry points**: `js/app.js` initializes the UI, handles the upload drop-zone, sets up tabs.
- **Script loading order**: `config.js` -> 3rd party libs (SheetJS, Cytoscape, docx) -> `ifsc.js` -> `app.js` -> `table.js` -> `mindmap.js` -> `export.js`.
- **Global variables/functions attached to window**:
  - State: `window.appState`, `window.exportState`, `window.ifscCache`, `window.personallEnv`, `window.APP_CONFIG`, `window.personallFormatters`.
  - Methods: `window.formatAmount`, `window.getBankNameFromIFSC`, `window.testIfscApi`, `window.lookupIFSC`, `window.getIFSCCachedSync`, `window.hasIFSCData`, `window.getRowIFSC`, `window.safeExtractIFSC`, `window.startBulkIFSCResolution`, `window.exportDocument`, `window.initMindMap`, `window.highlightLayerInGraph`, `window.performSearch`, `window.jumpToLayerFromSearch`, `window.renderSidebarAndTables`.
- **State containers currently used**: Scattered across `appState`, `exportState`, and local storage (`ifscCache`).
- **Workbook parsing**: Done in `app.js` using a Web Worker.
- **Table rendering**: Managed in `table.js` via `window.renderSidebarAndTables()`.
- **Graph rendering**: Managed in `mindmap.js` via `window.initMindMap()`.
- **Export state**: Lives in `export.js` as `window.exportState`.
- **IFSC resolution/caching**: Lives in `ifsc.js` with its own queue and cache globals.
- **Dependencies**: The modules implicitly depend on each other through the `window` object. E.g., `table.js` relies heavily on `window.appState` and `window.safeExtractIFSC`.

## 2. Fragility Analysis
- **Global namespace collisions**: Dozens of variables and functions are exposed directly on the `window` object. Overwriting these accidentally can break the app.
- **Repeated DOM rendering**: `renderSidebarAndTables()` and `initMindMap()` reconstruct significant chunks of the DOM/Canvas.
- **Memory leak risks**: Destroying Cytoscape graphs explicitly helps, but lingering event listeners on DOM elements during full view re-renders might cause leaks.
- **Scattered View Management**: View switching is done manually by adding/removing CSS classes (`.active`, `.hidden`) directly inside multiple files (`app.js`, `table.js`).
- **Cross-dependency**: `export.js` calls `ifsc.js` functions; `table.js` calls `mindmap.js` functions (`window.initMindMap`); `app.js` calls functions in all modules.

## 3. Performance Analysis
- **Upload Parsing Bottlenecks**: Moved to Web Worker, which is good.
- **Table Rendering Bottlenecks**: Large tables with thousands of rows might cause UI freezes. Pagination is implemented, which mitigates this.
- **Graph Rendering Bottlenecks**: Rendering a large node tree freezes the browser. A "Performance Mode" (aggregation) helps, but needs careful state management.
- **IFSC Lookup Bottlenecks**: Resolved sequentially/bulk, but concurrent API calls without rate limiting can result in UI slowdowns or blocked requests.
- **Long-session slowdown causes**: Appending/recreating DOM elements without proper cleanup.

## 4. Feature Integrity Audit
- **Layer-wise grouping**: Working.
- **Unclassified sheet fallback**: Working.
- **Global search & cross-layer hints**: Working.
- **Sidebar highlighting**: Working.
- **Table pagination & horizontal scrolling**: Working.
- **Mind map rendering & performance mode**: Working.
- **Export modal & docx generation**: Working.
- **IFSC address lookup (online, offline fallback, caching)**: Working, though logic is scattered.
- **Select all / indeterminate sync**: Working.
- **File:// and local-server compatibility**: Fully supported.

## 5. Migration Risk Assessment
- **Preserve As-Is**: External libraries (`xlsx`, `cytoscape`, `docx`), styles (`css/style.css`), HTML layout (`index.html`).
- **Refactor**:
  - The scattered `window.*` architecture must be replaced by a single namespace (e.g., `window.PersonallApp`).
  - `window.appState`, `window.exportState`, `window.ifscCache` should be unified into `PersonallApp.state`.
  - Modules (`app.js`, `table.js`, `mindmap.js`, `ifsc.js`, `export.js`) should be wrapped in IIFEs that extend `PersonallApp`.
- **Adapt/Wrap**: UI View management should be routed through a central controller (e.g., `PersonallApp.UI.switchView(...)`).
- **Deprecated**: Direct `window.funcName` calls.
