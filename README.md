# Vector Illustration Editor

Vector Illustration Editor v1.1.0 is a browser-based editor for diagrams, illustrations, floor plans, and other vector drawings. It combines an office-style illustration workflow with a real-scale CAD mode and keeps project data in the browser unless the user explicitly exports it.

**日本語:** 資料・マニュアル・教材向けの挿絵から、実寸ベースの建築図面まで作成できるブラウザ版ベクターエディタです。UI は日本語（初期設定）と英語に対応しています。

## Highlights in v1.1.0

- Viewport-independent SVG / PNG / PDF export through a shared offscreen export service
- Unified export settings for canvas, content, or selection, including margin, background, transparency, multiplier, file name, and compatible OS clipboard output
- Correct CAD paper-size PDF output and AutoCAD R12 ASCII DXF export
- CAD OSNAP, associative dimensions, and straight or elbow connectors that follow referenced objects
- CAD section profiles with material union, cut-outs, convex fillets, and geometric section properties
- Full-document transactional Undo / Redo, versioned schema validation, and v1-to-v2 migration
- IndexedDB-first auto-save, named projects with up to 20 snapshots, and reusable symbol assets
- Browser-local image vectorization with faithful/cleanup modes, adaptive thresholding, centreline extraction, and editable output
- Searchable, renameable, drag-sortable layer tree with multi-selection visibility and lock operations
- Style presets and sampling/application of the current object style
- Command palette (`Ctrl/⌘+K`), collapsible side panels, accessible dialogs, and responsive layouts
- Vitest unit tests, Playwright browser tests, dependency auditing, Dependabot, and CI/deploy quality gates

## Features

### Drawing and editing

- Line, arrow, text, freehand pencil, rectangle, rounded rectangle, circle, ellipse, triangle, diamond, polygon, and polyline tools
- Select, move, resize, rotate, delete, duplicate, copy/paste, flip, group/ungroup, z-order, alignment, and distribution operations
- Architecture tools for walls, columns, dimensions, and connectors
- LaTeX expressions rendered with KaTeX; the source and font size remain in document metadata
- Numeric move/copy and crossing-window stretch operations
- Canvas presets for A4/A3, US Letter, slides, common web/SNS sizes, and custom dimensions
- Grid, grid snap, smart guides, rulers, guide lines, Ortho constraints, and live cursor coordinates

### CAD mode

- Internal drawing coordinates use millimetres; properties can be displayed in mm, cm, or m
- Space+drag or middle-button drag to pan; the mouse wheel zooms around the pointer
- Configurable drawing bounds (default 10,000 × 8,000 mm) and fit-to-view support
- Adaptive grid rendering limits line density at extreme zoom levels
- OSNAP candidates include endpoints, midpoints, centres, and intersections, using a screen-consistent snap threshold
- Associative dimensions store stable object/anchor references and refresh their value after referenced geometry changes
- Connectors store stable endpoint references and follow moved objects; hold `Alt` while drawing to create an elbow route
- Rulers and guide coordinates share the active canvas viewport, including pan, zoom, and resize changes

### Section profiles and geometric properties

In CAD mode, supported closed shapes can be converted into a section profile at `1 unit = 1 mm`.

- Inputs: rectangles, rounded rectangles, circles, ellipses, closed polygons, supported groups, and existing section profiles
- Basic templates: enter nominal dimensions for rectangular/circular hollow sections, H sections, channels, and lipped channels, then place the generated profile at the visible canvas centre
- Operations: create a section, union overlapping material, subtract holes/notches, and apply a numeric radius to selected convex line-line corners
- Results: area, centroid, `Ix`, `Iy`, `Ixy`, principal moments/axis, centroid-to-extreme-fibre distances, and side-specific elastic section moduli
- Display: switch between mm- and cm-based result units; show centroid, centroidal axes, principal axis, and extreme-fibre bounds as non-persistent overlays
- Integrity: one operation produces one Undo/Redo entry; JSON, auto-save, clone/copy, project, and symbol persistence retain the normalized section metadata
- Export: SVG/PNG/PDF preserve the compound even-odd path; DXF writes every outer/hole boundary as a closed R12 `POLYLINE` and reports approximation/hole limitations
- Accuracy: curve/fillet boundaries are adaptively polygonized using the displayed millimetre tolerance; invalid, self-intersecting, non-finite, empty, or inconsistent ring topology is rejected

The convex-fillet editor accepts exact straight-edged profiles only. Concave corners, circles or other curved boundaries, curve-derived Boolean results, and a second fillet pass over an already filleted profile remain outside this release; choose every required eligible corner in one preview/commit.

These are geometric section properties only. Material strength, member resistance, buckling, effective width, and connection integrity must be checked separately by the engineer.

### Layers, styles, and reusable content

- Search layers, rename by double-clicking, reorder top-level objects by drag-and-drop, and expand/collapse group children
- `Ctrl/⌘`-click layers for multiple selection; visibility and lock actions apply to the selected set and are undoable
- Built-in style swatches plus “Remember style” / “Apply style” actions for fill, stroke, text, and line settings
- Save the current selection as a named symbol asset, then place or delete it from the browser-local asset library
- Save named projects and version snapshots in IndexedDB; the most recent 20 snapshots per project are retained

### Files, persistence, and history

- Save and load editable JSON project files using document schema v2
- Runtime validation covers schema version, dimensions, enums, guide data, JSON complexity, and Fabric object payloads
- v1 documents with embedded Fabric JSON are migrated to the structured v2 format when loaded
- Temporary interaction flags such as `selectable` and `evented` are not persisted; stable IDs, object kinds, lock state, and semantic references are persisted
- Auto-save runs every 10 seconds, preferring IndexedDB and falling back to localStorage when required; valid legacy localStorage saves are migrated automatically
- Startup restoration requires confirmation, and storage failures are reported with a toast
- Undo / Redo records the complete document state, including objects, canvas/CAD settings, grids, snapping, rulers, guides, scale, and Ortho mode
- History restoration is serialized to avoid overlapping Fabric loads; history is capped at 50 snapshots or approximately 32 MiB
- Import editable SVG or raster PNG, JPEG, GIF, and WebP content with asynchronous error reporting

### Image vectorization

Raster images and handwritten notes can be converted into editable vector objects without uploading the source image. The complete pipeline runs locally in the browser, remains available offline after the application has loaded, and does not call an external API.

- Start from the toolbar or command palette, then drop or choose a PNG/JPEG/WebP/GIF image, or paste an image into the vectorization dialog with `Ctrl/⌘+V`
- An existing raster object on the canvas can be sent to the same dialog from its context menu
- **Faithful trace** preserves contours and handwriting as polygons/polylines; **Cleanup** recognizes line-, rectangle-, circle-, and ellipse-like geometry and aligns their anchors with adjustable snap strengths while preserving free-form vertices
- Otsu thresholding handles relatively even backgrounds, while local Sauvola thresholding is available for photographed paper with shadows or uneven lighting
- Noise removal, simplification, processing-size, and automatic-threshold controls let the result and vertex count be tuned before insertion
- Thin elongated components are automatically represented by their centreline and stroke width; “Import as line art” forces centreline tracing for all suitable components
- Processing runs in a Web Worker with progress, cancellation, a 60-second timeout, debounced SVG preview updates, shape/vertex statistics, and complexity warnings
- Inserted Fabric objects are individually editable (or optionally grouped), selected after insertion, assigned fresh stable IDs, and committed as one transaction so one Undo removes the complete import

OCR is not part of image vectorization. Printed and handwritten text is traced as geometry and can be replaced later with the text tool.

### Unified export

The export dialog is shared by illustration and CAD modes. It renders from an offscreen `StaticCanvas`, so the result is independent of the editor’s current zoom and pan.

| Option | Supported values |
|---|---|
| Format | SVG, PNG, PDF; CAD mode also supports DXF R12 |
| Scope | Entire canvas/drawing, visible content bounds, or current selection |
| Layout | Margin, document background or transparency, file name |
| Raster | Explicit 1×–4× multiplier, with output-size safety limits |
| CAD page | A0–A4, portrait/landscape, and 1:1–1:500 scale |
| Clipboard | SVG or PNG when `ClipboardItem` and the MIME type are supported by the browser |

CAD PDF files are generated in millimetres with the requested physical paper size. DXF export uses millimetres and supports the editor’s R12-compatible LINE, POLYLINE, CIRCLE, and TEXT subset; unsupported or approximated object types are reported before completion. DXF/DWG import is not included in v1.1.0.

### UI and accessibility

- Light/dark theme and Japanese/English language preferences are persisted
- `Ctrl/⌘+K` opens a searchable command palette for editing commands, view toggles, and every registered tool
- Left and right panels can be collapsed independently; layout preferences are persisted
- Shared `Dialog` and `IconButton` components provide accessible names, `role="dialog"`, `aria-modal`, labelled headings, focus trapping, Escape handling, and focus restoration
- Form labels, pressed states, keyboard navigation, reduced-motion preferences, and responsive breakpoints are included
- Toast notifications report save, load, import, export, auto-save, and storage outcomes without blocking the editor
- Built-in shortcut reference and bilingual help manual

## Getting started

### Prerequisites

- Node.js 20 or later (the CI environment uses Node.js 20)
- npm

### Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The deployed GitHub Pages build uses the `/VectorEditor/` base path.

### Quality and build commands

| Command | Purpose |
|---|---|
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check the application and tool configuration with TypeScript |
| `npm test` | Run Vitest in watch mode |
| `npm run test:run` | Run the unit/component test suite once |
| `npm run test:e2e` | Run Playwright browser tests; install Chromium first with `npx playwright install chromium` |
| `npm run audit:prod` | Fail on high/critical production dependency advisories |
| `npm run build` | Type-check and create the Vite production bundle in `dist/` |
| `npm run check` | Run lint, unit tests, and the production build |
| `npm run preview` | Preview the production build locally |

CI runs lint, type checking, unit tests, production dependency auditing, build, and Playwright tests for pull requests and pushes to `main`. The Pages deployment repeats the non-browser quality gates before publishing. Dependabot checks npm dependencies weekly and GitHub Actions monthly.

## Technology

| Library | Version | Purpose |
|---|---:|---|
| React / React DOM | 19.2 | UI |
| TypeScript | 5.9 | Static types and build checks |
| Fabric.js | 7.4 | Canvas rendering and object manipulation |
| polygon-clipping | 0.15 | Section union and difference operations |
| Zustand | 5.0 | Editor, UI, and i18n state |
| jsPDF | 4.2 | PDF generation |
| svg2pdf.js | 2.7 | SVG-to-PDF rendering |
| KaTeX | 0.16 | LaTeX rendering |
| html2canvas | 1.4 | LaTeX bitmap capture |
| Vite | 7.3 | Development and production build |
| Vitest / Testing Library | 4.1 / 16.3 | Unit and component tests |
| Playwright | 1.61 | Browser end-to-end tests |

## Project structure

```text
src/
  components/
    Canvas.tsx             Fabric canvas lifecycle and interaction bridge
    TraceDialog.tsx        Image input, trace controls, preview, and insertion
    ExportDialog.tsx       Unified SVG/PNG/PDF/DXF export UI
    ProjectManager.tsx     Named projects and version snapshots
    SymbolLibrary.tsx      Browser-local reusable assets
    CommandPalette.tsx     Ctrl/⌘+K action search
    ToolPanel.tsx          Registry-driven drawing tools
    PropertyPanel.tsx      Typed property and style editing
    SectionPropertiesPanel.tsx  Section results and temporary overlays
    LayerPanel.tsx         Search, tree, rename, reorder, visibility, lock
    Dialog.tsx             Accessible modal primitive
  domain/
    section.ts             Section profile types and structural validation
    trace/                 Pure preprocessing, contour, centreline, classification, alignment, and Fabric conversion
    tools.ts               Exhaustive tool registry and metadata
  hooks/
    useDrawingSession.ts   Drawing-session state and preview cleanup
    useCadViewport.ts      CAD pan/zoom/grid and viewport publication
    useAutoSave.ts         Timed auto-save and legacy migration
  services/
    exportService.ts       Offscreen, viewport-independent export
    traceService.ts        Worker jobs, progress, cancellation, timeout, and response validation
    dxfExporter.ts         AutoCAD R12 ASCII writer
    projectRepository.ts   IndexedDB projects and snapshots
    symbolRepository.ts    IndexedDB symbol assets
  store/
    useEditorStore.ts      Editor state and full-document history
    useUiStore.ts          Collapsible-panel and palette state
  utils/
    sectionGeometry.ts     Fabric-to-section conversion and curve tessellation
    sectionProfileTemplates.ts  Dimension-driven basic steel section profiles
    sectionBoolean.ts      Material union and cut-out operations
    sectionProperties.ts   Area, centroid, inertia, axes, distances, and moduli
    documentSerializer.ts  Schema v2 validation, migration, restore
    historyService.ts      Serialized/abortable history restoration
    semanticObjects.ts     Linked dimensions and connectors
    cadSnapping.ts         CAD snap candidates
    stylePresets.ts        Typed editor styles and presets
  workers/
    traceWorker.ts         Browser-local image-vectorization pipeline
e2e/                       Playwright scenarios
```

The trace domain stages, intermediate-data validation, Fabric conversion, Worker protocol/service, and insertion history are covered by Vitest. Playwright scenarios exercise image input, preview, insertion, and single-step Undo through the browser UI.

## Changelog

### Unreleased

- Added offline, browser-local image vectorization with faithful and cleanup modes, Otsu/Sauvola thresholding, contour and centreline tracing, and editable Fabric output
- Added drop/file/clipboard/dialog and existing-raster input paths, Worker progress/cancellation, debounced SVG preview, result statistics, complexity limits, and one-step Undo insertion
- Added CAD section profiles with material union, cut-outs, convex-corner fillets, and geometric section-property results
- Added dimension-driven templates for rectangular/circular hollow, H, channel, and lipped-channel steel sections
- Added robust ring/topology validation, large-coordinate numerical stabilization, principal-axis calculation, and large-profile Worker analysis
- Preserved section profiles through history, JSON/auto-save/projects/symbols/cloning and SVG/PNG/PDF/DXF export

### v1.1.0

- Replaced separate normal/CAD exporters with a viewport-independent unified export service and dialog
- Added canvas/content/selection scopes, configurable margin/background/transparency/multiplier/file name, and compatible SVG/PNG clipboard output
- Corrected physical CAD PDF sizing and added R12 ASCII DXF export with compatibility warnings
- Added CAD OSNAP, linked dimensions, and straight/elbow connectors
- Reworked Undo / Redo around complete versioned document snapshots and serialized async restoration
- Added schema v2 validation/migration and removed temporary interaction flags from persisted object data
- Moved auto-save to IndexedDB-first storage with fallback and legacy migration
- Added named project snapshots, reusable symbol assets, style presets/sampling, and the enhanced layer tree
- Added the command palette, collapsible side panels, shared accessible dialog/icon primitives, and responsive styles
- Added Vitest, Testing Library, Playwright, dependency auditing, Dependabot, and CI/deploy gates
- Updated Fabric.js to 7.4.0, jsPDF to 4.2.1, and Vite to 7.3.6

### v1.0.3

- Added editable SVG/raster import, smart guides, rulers, and guide lines

### v1.0.2

- Added the real-scale CAD viewport, numeric move/copy, stretch, drawing-mode toggle, unit display, and fit-to-view

### v1.0.1

- Added architecture tools, LaTeX placement/measurement, canvas presets, grid snap, scale display, tool settings, and PDF export

### v1.0.0

- Initial drawing, editing, JSON persistence, and export release

## License

This project is licensed under the [MIT License](./LICENSE). Runtime dependencies use permissive open-source licenses; consult each dependency package for its complete notices.
