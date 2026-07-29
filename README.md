# Financial Transaction Visualizer

This is a fully local, offline-capable web application for visualizing and analyzing layered financial transaction data extracted from Excel (.xlsx) files.
It processes data completely in the browser — no backend, no server, and no internet dependency after the initial setup.

## Setup Instructions

To run this application locally without internet access, you need to download three JavaScript libraries and place them in the `/libs/` folder.

1. **SheetJS**
   - Download the latest stable version of `xlsx.full.min.js`.
   - You can get it from their CDN or GitHub releases. For example: `https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`
   - Save the file as `libs/xlsx.full.min.js`.

2. **Cytoscape.js**
   - Download the latest stable version of `cytoscape.min.js`.
   - You can get it from their CDN or GitHub. For example: `https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js`
   - Save the file as `libs/cytoscape.min.js`.

3. **docx** (Required for Word Export functionality)
   - Download the standalone browser build of the `docx` library.
   - Visit `https://unpkg.com/docx/dist/index.umd.cjs` and save the file as `libs/docx.js`.
   - Alternatively: right-click the link, "Save link as..." and save to the `libs/` folder with the name `docx.js`.
   - **Important:** The file must be named exactly `libs/docx.js` (lowercase, no extension changes). Without this file, the Export to Word feature will not work.

After placing these three files in the `libs` folder, simply open `index.html` in your web browser (double-click the file) to start using the application.

## Features

- **Local Processing:** 100% of the data processing happens in your browser. No data is sent to any server.
- **Layer-wise Organization:** Visualizes multiple layers of financial transactions (Layer 1, Layer 2, etc.).
- **Cross-Reference:** Links entities and transaction flows automatically between layers.
- **Table and Mind Map Views:** Explore the data either in a detailed, sortable table or visually via an interactive concentric mind map.
- **Filtering & Search:** Easily filter by specific transaction criteria (amount, date, UTR, account).
- **Export to Word:** Generate fully customized `.docx` files completely in the browser. Select exact sheets and columns you wish to include in your reports using the advanced column-picker interface with Presets.
- **Themes:** Light theme for clarity and professional forensic analysis.

## Performance

- **Background Parsing:** Excel parsing, data structuring, and search-index building all run inside a Web Worker, keeping the UI responsive during upload.
- **Lazy Rendering:** Only the currently viewed layer is rendered; switching layers disposes the previous DOM and renders the new one on demand.
- **Deferred Graph:** The mind map is built only when you first click the Graph View tab.
- **Pagination:** Each transaction table paginates at 50 rows per page.
- **Debounced Search:** Typing in the search box waits 300ms before triggering, preventing UI stalls.
- **Large File Support:** Designed to handle workbooks up to 10 MB reliably.

## Using the Word Export Feature
1. Upload your `.xlsx` transaction file.
2. Once the dashboard loads, click the **Export to Word** button at the top.
3. In the modal, use **Presets** (All Data, Investigation Summary, Custom Selection) to quickly select the most important columns.
4. Expand sheets and check/uncheck exact columns using the column-picker.
5. See the live summary at the bottom update dynamically.
6. Click **Generate Word File** to immediately construct and download the `.docx` document locally without sending your data anywhere.

## Troubleshooting

- **Export button does nothing:** Make sure `libs/docx.js` exists. Download it as described in step 3 above.
- **App is slow with very large files:** The mind map tab defers loading until first opened. If it feels slow, close unused browser tabs to free memory.
- **"Error parsing workbook" message:** Ensure the uploaded file is a valid `.xlsx` file (not `.xls` or `.csv`).

## Development

This app is built using plain HTML5, CSS3, and Vanilla JavaScript (ES6+).
It uses `<script>` tags rather than ES6 modules to support opening via the `file://` protocol directly.
