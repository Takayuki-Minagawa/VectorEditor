# Vector Illustration Editor

A browser-based vector illustration editor for creating diagrams and illustrations for documents, manuals, proposals, educational materials, and architectural drawings. It provides an intuitive object-based editing experience similar to familiar office drawing tools.

**Japanese (日本語):** ブラウザ上で動作するベクター挿絵エディタです。資料・マニュアル・提案書・教材・建築図面向けの図形を直感的に作成・編集できます。

## Features

### Shape & Drawing Tools
- **Basic Tools** &mdash; Line, arrow, text
- **Shape Tools** &mdash; Rectangle, rounded rectangle, circle, ellipse, triangle, diamond, polygon, polyline
- **Architecture Tools** &mdash; Dimension line (auto-displays distance), wall, column &mdash; for floor plans, beam layouts, and elevation drawings
- **LaTeX Math** &mdash; Place LaTeX math expressions on the canvas with live preview (powered by KaTeX)
- **LaTeX Position Measure** &mdash; Draw a rectangle to display position and size in LaTeX coordinates (bottom-left origin)

### CAD Mode (1:1 Real-Scale)
- **1:1 mm Coordinates** &mdash; Internal coordinates are real-world mm values; draw at actual scale
- **Viewport Pan & Zoom** &mdash; Space+drag or middle-button drag to pan; mouse wheel to zoom toward cursor
- **Drawing Size** &mdash; Configurable document bounds in mm (default 10m &times; 8m)
- **Unit Display** &mdash; Switch between mm, cm, and m for property display
- **CAD Export** &mdash; Specify paper size (A0&ndash;A4) and scale (1:1 to 1:500); export as SVG, PNG, or PDF with automatic coordinate conversion
- **Numeric Move / Copy** &mdash; Move or copy selected objects by exact mm offset
- **Stretch** &mdash; Draw a crossing window and stretch objects by numeric value

### Editing & Layout
- **Object Editing** &mdash; Select, move, resize (8-direction handles), rotate, copy, paste, duplicate, and delete
- **Alignment & Distribution** &mdash; Left / center / right / top / middle / bottom alignment, horizontal and vertical even distribution
- **Z-Order & Layers** &mdash; Bring to front, send to back, reorder with layer panel including visibility and lock toggles
- **Grouping** &mdash; Group and ungroup objects for batch operations
- **Properties** &mdash; Numeric input for position, size, rotation; fill color, stroke color/width/dash, opacity, corner radius, and full text formatting
- **Grid & Snap** &mdash; Toggle grid overlay with configurable grid size; snap-to-grid for precise placement
- **Scale Display** &mdash; Selectable scale indicator (1:1 to 1:500)
- **Canvas Presets** &mdash; A4/A3, US Letter, slides (16:9/4:3), OGP, Instagram, YouTube thumbnail, and more

### File & Export
- **Save & Load** &mdash; JSON-based project files for full re-editing; auto-save to localStorage with CAD metadata
- **Export** &mdash; SVG (vector), PNG (2x resolution), and PDF (vector-quality) export; CAD mode uses paper+scale export dialog
- **Undo / Redo** &mdash; Up to 50 history steps

### UI & Accessibility
- **Tool Visibility Settings** &mdash; Show/hide tools by category (Basic, Shapes, Architecture, Utility) via checkbox dialog
- **Keyboard Shortcuts** &mdash; Standard shortcuts for all major operations (Windows & macOS)
- **Context Menu** &mdash; Right-click for quick access to common actions
- **Bilingual UI** &mdash; Japanese (default) and English, switchable with a button
- **In-App Help** &mdash; Built-in user guide with bilingual support

## Demo

Hosted on GitHub Pages: *(URL will be available after deployment)*

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

### Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
npm run build
```

Output is generated in the `dist/` directory and can be served as a static site.

### Deploy to GitHub Pages

This project is configured for GitHub Pages deployment. Set the repository name in `vite.config.ts` if needed, then use GitHub Actions or manually push the `dist/` directory.

## Tech Stack

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [React](https://react.dev/) | 19 | MIT | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Apache-2.0 | Type safety |
| [Fabric.js](http://fabricjs.com/) | 7 | MIT | Canvas rendering and object manipulation |
| [Zustand](https://zustand-demo.pmnd.rs/) | 5 | MIT | State management |
| [jsPDF](https://github.com/parallax/jsPDF) | 4 | MIT | PDF export |
| [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) | 2 | MIT | SVG to PDF conversion |
| [KaTeX](https://katex.org/) | 0.16 | MIT | LaTeX math rendering |
| [Vite](https://vite.dev/) | 7 | MIT | Build tool and dev server |

All runtime dependencies use permissive open-source licenses (MIT, Apache-2.0).

## Project Structure

```
src/
  components/
    Canvas.tsx          # Fabric.js canvas with drawing logic
    Toolbar.tsx         # Top toolbar (file, edit, arrange, align, view, export)
    ToolPanel.tsx       # Left tool selector with category & visibility settings
    PropertyPanel.tsx   # Right property editor
    LayerPanel.tsx      # Layer list with visibility/lock
    StatusBar.tsx       # Bottom status bar with zoom, grid, snap, scale
    ContextMenu.tsx     # Right-click context menu
    ShortcutHelp.tsx    # Keyboard shortcut reference dialog
    HelpManual.tsx      # In-app user guide dialog
    LatexDialog.tsx     # LaTeX math input dialog with live preview
    NumericMoveDialog.tsx # Numeric move/copy dialog
    CadExportDialog.tsx  # CAD paper+scale export dialog
  store/
    useEditorStore.ts   # Zustand store (canvas, history, selection, clipboard, grid, snap, scale)
  hooks/
    useKeyboardShortcuts.ts  # Global keyboard shortcut handler
    useAutoSave.ts           # Auto-save to localStorage
  i18n/
    ja.ts               # Japanese translations
    en.ts               # English translations
    useI18n.ts          # i18n store
  types.ts              # Shared TypeScript types
  App.tsx               # Root layout
  App.css               # All styles
```

## Changelog

### v1.0.2
- **CAD 1:1 viewport system** &mdash; Internal coordinates in real-world mm; viewport-based pan (Space+drag) and zoom (mouse wheel)
- **CAD export dialog** &mdash; Paper size (A0&ndash;A4), scale (1:1&ndash;1:500), and format (SVG/PNG/PDF) selection
- **Numeric move/copy** &mdash; Move or duplicate selected objects by exact offset
- **Stretch tool** &mdash; Select a crossing window and stretch objects by numeric value
- **Drawing mode toggle** &mdash; Switch between Illustration (pixel) and CAD (mm) modes via status bar
- **Unit display** &mdash; mm/cm/m unit switching for CAD mode
- **Fit-to-view** button for CAD mode
- Auto-save/load preserves CAD settings (drawing size, mode, unit)

### v1.0.1
- Architecture tools: dimension line, wall, column
- LaTeX math expression placement with KaTeX
- LaTeX coordinate measurement tool
- Canvas size presets (A4, slides, SNS, etc.)
- Grid snap with configurable grid size
- Scale display in status bar
- Tool visibility settings (show/hide by category)
- PDF export support

### v1.0.0
- Initial release with core drawing, editing, and export features

## License

This project is licensed under the [MIT License](./LICENSE).

## Third-Party Licenses

This software uses the following open-source libraries. See each project for details:

- **Fabric.js** &mdash; MIT License &mdash; Copyright Fabric.js contributors
- **React** &mdash; MIT License &mdash; Copyright Meta Platforms, Inc.
- **Zustand** &mdash; MIT License &mdash; Copyright pmndrs contributors
- **jsPDF** &mdash; MIT License &mdash; Copyright James Hall and yWorks GmbH
- **svg2pdf.js** &mdash; MIT License &mdash; Copyright yWorks GmbH
- **KaTeX** &mdash; MIT License &mdash; Copyright Khan Academy and contributors
- **Vite** &mdash; MIT License &mdash; Copyright Evan You and Vite contributors
- **TypeScript** &mdash; Apache License 2.0 &mdash; Copyright Microsoft Corporation
