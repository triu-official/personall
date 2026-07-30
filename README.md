# Financial Transaction Visualizer

A local-first financial transaction analysis tool for reading, organizing, visualizing, searching, and exporting layered bank-trail data from Excel (`.xlsx`) files.

The application runs in the browser and is designed for investigation-style analysis of transaction workbooks containing multiple sheets, account trails, transaction identifiers, IFSC codes, withdrawals, and layered fund movement.

## Core Capabilities

- Upload and analyze Excel (`.xlsx`) workbooks locally
- Read all available sheets without requiring fixed sheet names
- Organize classified records by **Layer -> Primary Entity -> Transaction Sheet**
- Preserve sheets that cannot be classified under **Unclassified Data**
- Search accounts, UTRs, IFSC codes, amounts, dates, remarks, and other values across the entire workbook
- Show which layer contains a search result, even when it is not present in the currently open layer
- Display layer-wise transaction tables with sorting, pagination, filtering, and horizontal scrolling
- Visualize transaction relationships using a layered mind map / graph
- Resolve IFSC codes into bank, branch, city, state, and address information where available
- Export selected sheets and selected columns to professionally formatted Word (`.docx`) reports
- Keep core processing local in the browser

> **Privacy:** Excel workbook data is processed locally in the browser. Core transaction data is not uploaded to a server.

***

## Important Privacy Note

The app has two kinds of functionality:

### Fully Offline Features

These features work locally without internet after the required JavaScript libraries have been downloaded:

- Excel parsing
- Layer-wise grouping
- Table view
- Mind-map view
- Search and filters
- Pagination
- Local cache usage
- Word export
- Classified and unclassified data display

### Optional Online IFSC Lookup

The optional **Bank Branch & Address** feature may contact the Razorpay IFSC lookup service when an IFSC result is not already cached locally.

- The app uses IFSC code lookups only to obtain bank/branch details.
- Lookup results are stored in browser `localStorage` for reuse.
- If the browser is offline, the API is blocked, or the lookup fails, the app uses cached data or a local bank-prefix fallback where possible.
- The application continues to work normally even if online IFSC lookup is unavailable.

***

## Requirements

Use a modern desktop browser:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox

Recommended:

- At least 4 GB available system memory for large files
- Stable internet only if live IFSC branch-address lookup is required
- Microsoft Word or LibreOffice Writer to open exported `.docx` files

***

## Setup

The application has no backend, database server, package manager, or build step.

Download the required JavaScript libraries and place them inside the `libs` folder.

Expected folder structure:

```text
personall/
├── css/
├── js/
├── libs/
│   ├── xlsx.full.min.js
│   ├── cytoscape.min.js
│   └── docx.js
├── index.html
└── README.md
```

### 1. SheetJS

SheetJS reads Excel workbooks in the browser.

Download:

```text
https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js
```

Save as:

```text
libs/xlsx.full.min.js
```

SheetJS recommends Web Workers for large spreadsheet processing so browser interaction can remain responsive while parsing occurs. [docs.sheetjs](https://docs.sheetjs.com/docs/demos/bigdata/worker/)

### 2. Cytoscape.js

Cytoscape.js renders the transaction relationship graph / mind map.

Download:

```text
https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js
```

Save as:

```text
libs/cytoscape.min.js
```

### 3. docx

The `docx` library generates real Word (`.docx`) files locally in the browser.

Download a browser-compatible UMD or IIFE bundle. Do **not** use a Node-only/CommonJS bundle if the application expects a browser global object.

Recommended example:

```text
https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.iife.js
```

Save it as:

```text
libs/docx.js
```

The `docx` library supports browser-side Word document generation, and published builds include browser-compatible IIFE and UMD files. [cdn.jsdelivr](https://cdn.jsdelivr.net/npm/docx@8.5.0/build/)

***

## Starting the App

### Option A: Open Directly

After placing the required library files in `libs/`, double-click:

```text
index.html
```

This opens the application directly in the browser using the `file://` protocol.

Core workbook processing, table views, graph views, and Word export run locally in the browser. Live IFSC address lookup is optional and may require internet access; cached and fallback information remains available offline.

### Option B: Recommended Local Server

For the best experience, especially for **live IFSC address lookup**, run a local server.

Open a terminal inside the project folder and run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Alternative for Node.js users:

```bash
npx serve
```

### Why Use a Local Server?

Some browsers can restrict external API calls made from a `file://` page because it has a `null` origin. If live Razorpay IFSC lookup is blocked:

- The app will show a notice.
- Core processing will still work.
- Cached IFSC records will still work.
- Local bank-prefix fallback will still work.
- Running via `http://localhost` may allow live IFSC address lookup.

***

## Excel File Requirements

Upload valid `.xlsx` files only.

The app is designed for workbooks containing layered financial trail information. Common sheets may include:

- Money Transfer to
- Other
- Withdrawal through ATM
- Transaction put on hold
- AEPS
- Cash Withdrawal through Cheque
- Others Less Than 500
- Withdrawal through POS
- Security sold (Put on Hold)
- Old Transaction

The application does not depend only on these names. It attempts to detect information dynamically from all workbook sheets.

### Layer Detection

The app searches for layer-style columns such as:

- `Layer`
- `Layer No`
- `Lyr`

### Primary Entity / Sender Detection

The app attempts to identify sender / primary entity columns similar to:

```text
Account No./ (Wallet /PG/PA) Id
Account (Wallet/PG/PA) Id
Account (Wallet/PD/PA) Id
```

### Receiver Detection

Any other transaction-side account field such as `Account No` can be treated as a receiver/account reference when present.

### Unclassified Data

A sheet is not dropped if it lacks a recognized Layer or Primary Entity column.

Instead, it remains available under:

```text
Unclassified Data
```

This preserves access to all available sheets, rows, and columns.

***

## Dashboard Features

### Layer-wise View

The table view organizes records by:

```text
Layer
  -> Primary Entity / Sender
      -> Sheet / Transaction Type
          -> Receiver Account, where available
              -> Individual transaction rows
```

This structure helps trace movement from a sender entity to receiver accounts and subsequent withdrawal or transaction activity.

### Cross-Layer Search

The global search checks the entire workbook, not only the currently selected layer.

You can search by:

- Account number
- UTR / transaction ID
- IFSC code
- Amount
- Date
- Remarks
- Bank name
- Branch name
- Address text
- Other available cell values

If a searched value is not found in the active layer but exists elsewhere, the app shows:

- Total match count
- Matching layers
- Clickable layer result chips
- Sidebar indicators/badges for layers containing matches

This avoids manually opening each layer one by one.

### Large Table Support

Wide transaction tables support horizontal scrolling so all columns remain accessible.

The app also uses pagination to reduce browser slowdown for large transaction datasets.

### Indian Numbering Format

Amounts are displayed using Indian number grouping where applicable:

```text
1,23,45,678.90
```

Large values may also display quick context:

```text
1.23 Cr
5.60 L
12.50 K
```

Invalid or missing amounts are shown safely without displaying `NaN` or `undefined`.

***

## IFSC Bank and Branch Address Lookup

When an IFSC code is detected, the app can add a virtual column:

```text
Bank Branch & Address
```

This column may include available information such as:

- Bank name
- Branch name
- Address
- City
- District
- State
- Contact number
- MICR
- RTGS availability

The Razorpay IFSC API is designed to retrieve bank/branch information for an IFSC code. [ifsc.razorpay](https://ifsc.razorpay.com/)

### IFSC Detection

The application tries to detect IFSC data through multiple methods:

1. A column header containing IFSC-related wording, such as:
   - IFSC
   - IFSC Code
   - IFS Code
   - RTGS Code
   - NEFT Code
   - Branch Code
   - Sol ID

2. A valid IFSC-like value found inside transaction row cells

3. IFSC information found in sheet metadata before the actual table header

### When the Address Column Appears

The `Bank Branch & Address` virtual column is added only if the corresponding sheet has at least one identifiable IFSC code.

This avoids adding empty address columns to sheets that contain no IFSC information.

### Resolution States

An address cell may show:

- Resolved bank and branch details
- `Looking up...`
- Cached result
- Offline bank-prefix fallback
- `Address unavailable`
- Retry action for failed lookup

### Local Cache

IFSC lookup data is cached in browser storage to avoid repeatedly requesting the same IFSC code.

The app should deduplicate lookups, so the same IFSC appearing hundreds of times triggers one lookup rather than hundreds.

***

## Mind Map / Graph View

The graph view shows transaction relationships visually.

### Standard View

For smaller workbooks, the graph can display detailed entity-to-entity links and transaction-related terminal nodes.

### Performance Mode

For larger workbooks, the graph may automatically group repeated similar transactions to prevent browser slowdown.

For example:

```text
Entity A -> ATM Withdrawal
```

may represent multiple ATM withdrawal records in the graph.

This does **not** remove the underlying detailed records. Full data remains available in the tables and Word export.

A visible performance-mode notice should explain when transaction grouping is active. Users can optionally attempt a full graph view if their device can handle it.

***

## Word Export

The application can generate a downloadable `.docx` report directly in the browser.

### Export Workflow

1. Upload an Excel workbook
2. Click **Export to Word**
3. Choose an export preset:
   - All Data
   - Investigation Summary
   - Custom Selection
4. Select or unselect sheets
5. Select or unselect columns within each sheet
6. Use global and per-sheet Select All / Select None controls
7. Review the live export summary
8. Click **Generate Word File**

### Export Controls

The export panel provides control over:

- Classified sheets
- Unclassified sheets
- Individual sheet selection
- Individual column selection
- Original Excel column names
- Virtual `Bank Branch & Address` field when IFSC data exists
- Full data or custom subset selection

### Export Structure

The report is professionally structured with:

```text
Report Title
Layer Summary

Layer 1
  Primary Entity / Sender
    Transaction Type
      Receiver Account
        Transaction detail rows

Layer 2
  ...

Unclassified Data
  Sheet Name
    Flat table using selected original columns
```

### Export Formatting

The Word export should include:

- Calibri typography
- Title and section hierarchy
- Page break before each layer
- Page break before Unclassified Data
- Professional light color palette
- Shaded sender/entity rows
- Sheet/transaction-type visual separation
- Receiver grouping rows where relevant
- Table borders
- Original selected column headers
- Zebra striping or readable alternating table-row styling
- Correct handling of wide tables and missing receiver columns

### Address Lookup During Export

If `Bank Branch & Address` is selected:

- The app checks cached IFSC results first.
- It waits for relevant unresolved address lookups where possible.
- It uses fallback information when online lookup is unavailable.
- It exports an explicit unavailable status rather than silently leaving a blank cell.

***

## Performance

The application is designed for workbooks up to approximately 10 MB, subject to browser memory and workbook complexity.

Performance features include:

- Web Worker-based Excel parsing
- Lazy rendering of layers
- Deferred graph initialization
- Pagination for large tables
- Debounced global search
- In-memory global search index
- Graph aggregation/performance mode
- Asynchronous/chunked Word generation
- IFSC request deduplication
- Rate-limited IFSC lookup queue
- Local IFSC cache reuse

For large browser-side spreadsheet workflows, using a Web Worker is recommended because it keeps the interface responsive while parsing occurs. [docs.sheetjs](https://docs.sheetjs.com/docs/demos/bigdata/stream/)

***

## Troubleshooting

### Export Button Does Nothing

Check that:

```text
libs/docx.js
```

exists and is a browser-compatible IIFE/UMD build.

Reload the page after adding the file.

### “Error Parsing Workbook”

Make sure the uploaded file is:

- A valid `.xlsx` file
- Not corrupt
- Not password-protected
- Not `.xls`, `.csv`, or another unsupported format

### IFSC Address Is Not Appearing

Possible reasons:

- The sheet has no detectable IFSC value
- The IFSC code is invalid
- The browser is offline
- The API is blocked under `file://`
- The lookup is still in progress
- The address is unavailable for that IFSC

Try:

1. Wait for lookup completion
2. Use the retry control
3. Open the app through `http://localhost:8000`
4. Check the diagnostics summary
5. Confirm the IFSC code is valid

### App Is Slow With Large Files

- Wait for the background parser to finish.
- Keep only necessary browser tabs open.
- Use table view instead of full graph view for very large workbooks.
- Allow performance mode to aggregate graph elements.
- Use a device with more available memory for files approaching 10 MB.

### Search Shows No Result in Current Layer

The result may exist in another layer.

Check:

- Search summary bar
- Highlighted layer badges
- Clickable layer result chips

***

## Development

This project uses:

- HTML5
- CSS3
- Vanilla JavaScript (ES6+)
- SheetJS
- Cytoscape.js
- docx browser bundle

It intentionally uses standard `<script>` tags rather than ES modules so the core application can be opened directly through the `file://` protocol.

No backend, database server, package manager, or build tool is required.

***

## Data Handling Commitment

The project is designed around a no-silent-loss principle:

- Every loaded sheet remains accessible.
- Unclassified sheets remain visible.
- Rows with partial data remain visible.
- Original columns remain available for export selection.
- Visual graph aggregation does not remove source table data.
- Export selection controls determine what the user chooses to include; they do not silently remove unselected source data from the application.
### Configuration

If you need to use a custom Razorpay IFSC endpoint or a proxy, you can edit `config.js` in the root folder. A sample is provided in `config.sample.js`. The `config.js` file is loaded directly by the browser to avoid needing any build step or environment variables injected via a Node.js process.
