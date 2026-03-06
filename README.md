# Vector Illustration Editor

A browser-based vector illustration editor for creating diagrams and illustrations for documents, manuals, proposals, and educational materials. It provides an intuitive object-based editing experience similar to familiar office drawing tools.

**Japanese (日本語):** ブラウザ上で動作するベクター挿絵エディタです。資料・マニュアル・提案書・教材向けの図形を直感的に作成・編集できます。

## Features

- **Shape Tools** &mdash; Line, arrow, rectangle, rounded rectangle, circle, ellipse, triangle, diamond, polygon, polyline, and text
- **Object Editing** &mdash; Select, move, resize (8-direction handles), rotate, copy, paste, duplicate, and delete
- **Alignment & Distribution** &mdash; Left / center / right / top / middle / bottom alignment, horizontal and vertical even distribution
- **Z-Order & Layers** &mdash; Bring to front, send to back, reorder with layer panel including visibility and lock toggles
- **Grouping** &mdash; Group and ungroup objects for batch operations
- **Properties** &mdash; Numeric input for position, size, rotation; fill color, stroke color/width/dash, opacity, corner radius, and full text formatting (font, size, bold, italic, underline, alignment, line height)
- **Undo / Redo** &mdash; Up to 50 history steps
- **Keyboard Shortcuts** &mdash; Standard shortcuts for all major operations (Windows & macOS)
- **Context Menu** &mdash; Right-click for quick access to common actions
- **Save & Load** &mdash; JSON-based project files for full re-editing; auto-save to localStorage
- **Export** &mdash; SVG (vector) and PNG (2x resolution) export
- **Grid Display** &mdash; Toggle grid overlay for precise placement
- **Bilingual UI** &mdash; Japanese (default) and English, switchable with a button

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
| [Vite](https://vite.dev/) | 7 | MIT | Build tool and dev server |

All runtime dependencies use permissive open-source licenses (MIT, Apache-2.0).

## Project Structure

```
src/
  components/
    Canvas.tsx          # Fabric.js canvas with drawing logic
    Toolbar.tsx         # Top toolbar (file, edit, arrange, align, view, export)
    ToolPanel.tsx       # Left tool selector
    PropertyPanel.tsx   # Right property editor
    LayerPanel.tsx      # Layer list with visibility/lock
    StatusBar.tsx       # Bottom status bar with zoom
    ContextMenu.tsx     # Right-click context menu
    ShortcutHelp.tsx    # Keyboard shortcut reference dialog
  store/
    useEditorStore.ts   # Zustand store (canvas, history, selection, clipboard)
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

## License

This project is licensed under the [MIT License](./LICENSE).

## Third-Party Licenses

This software uses the following open-source libraries. See each project for details:

- **Fabric.js** &mdash; MIT License &mdash; Copyright Fabric.js contributors
- **React** &mdash; MIT License &mdash; Copyright Meta Platforms, Inc.
- **Zustand** &mdash; MIT License &mdash; Copyright pmndrs contributors
- **Vite** &mdash; MIT License &mdash; Copyright Evan You and Vite contributors
- **TypeScript** &mdash; Apache License 2.0 &mdash; Copyright Microsoft Corporation
