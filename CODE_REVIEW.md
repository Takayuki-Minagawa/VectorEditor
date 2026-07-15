# VectorEditor コードレビュー・改善提案

- 対象: `main` / `9a4e5c8`
- 調査日: 2026-07-15
- 対象バージョン: `package.json` 上は v1.1.0
- 観点: 正確性、データ保全、設計、性能、セキュリティ、テスト、UI/UX、追加機能

## 対応サマリー（2026-07-15）

`codex/complete-code-review` ブランチで、当初のレビューに挙げた **P0-1〜P0-5、P1-1〜P1-10、F1〜F10 をすべて実装** しました。単にUI入口を追加するだけでなく、文書schema、履歴、描画セッション、viewport、永続メタデータ、オフスクリーン出力を先に整備し、その境界上へ追加機能を実装しています。

主な成果は次のとおりです。

- 表示中のzoom/panから独立した `ExportService` と統合 `ExportDialog` へ移行し、CAD PDFの物理用紙寸法をmmで生成
- 文書全体を対象にした直列Undo/Redo、schema v2 validation/migration、永続状態と一時UI状態の分離
- `DrawingSession`、CAD viewport publication、rAF座標更新、adaptive grid、画面基準snap閾値を導入
- CAD OSNAP、連動寸法、追従コネクタ、DXF R12 exportを追加
- レイヤー、スタイル、プロジェクト世代、素材、コマンドパレット、パネル折りたたみを追加
- IndexedDB-first autosave、アクセシブルな共通Dialog/IconButton、レスポンシブCSS、テスト/監査/CIを整備

### P0 完了表

| ID | 状態 | 対応内容 / 主な実装 |
|---|---|---|
| P0-1 | ✅ 完了 | `services/exportService.ts` で文書座標から一時 `StaticCanvas` を生成。SVG/PNG/PDFをzoom/pan非依存化し、CAD PDFを `unit: 'mm'` で生成 |
| P0-2 | ✅ 完了 | `CanvasSnapshot` を履歴要素とし、`HistoryService` で非同期restoreを直列化・無効化。設定変更、Layer操作、文書openを同じ履歴規則へ統合 |
| P0-3 | ✅ 完了 | Fabric 7.4.0、jsPDF 4.2.1、Vite 7.3.6へ更新。production audit、Dependabot、CI/deploy gateを追加 |
| P0-4 | ✅ 完了 | `useDrawingSession` の判別unionでdrag/polyline/measure/stretch/LaTeXを一元管理。previewをoverlay描画し、tool変更/Escape/unmountでcleanup |
| P0-5 | ✅ 完了 | 永続propertyを `FABRIC_CUSTOM_PROPERTIES` に型付けし、`selectable` / `evented` を除外。`locked` からFabric操作フラグを復元 |

### P1 完了表

| ID | 状態 | 対応内容 / 主な実装 |
|---|---|---|
| P1-1 | ✅ 完了 | CanvasのZustand購読を個別selectorへ変更し、cursor更新を `useRafCursorPosition` でrAF単位に集約 |
| P1-2 | ✅ 完了 | 描画session、CAD viewport、cursor publication、snap/semantic処理をhooks/utilities/servicesへ分割 |
| P1-3 | ✅ 完了 | live Canvasを変更する旧CAD exporterを廃止し、viewport反映を `useCadViewport`、exportをoffscreen serviceへ分離 |
| P1-4 | ✅ 完了 | zoom/pan/size/revisionを `CanvasViewportSnapshot` としてpublishし、Ruler/guideが同じ座標変換を参照 |
| P1-5 | ✅ 完了 | `zoomToPoint` にviewport pointを使用。最小画面間隔と最大本数からadaptive grid stepを算出 |
| P1-6 | ✅ 完了 | document schema v2、入力上限/enum/JSON構造検証、v1→v2 migration、structured Fabric payloadを導入 |
| P1-7 | ✅ 完了 | `ObjProps` + generic `updateProp<K>` でkey/valueを型付けし、表示・編集幅をscaled size基準へ統一 |
| P1-8 | ✅ 完了 | `NumberField` が文字列draftを保持し、blur/Enter時だけfinite/min/max検証後にcommit。Escapeでrollback |
| P1-9 | ✅ 完了 | 網羅的 `TOOL_DEFINITIONS` registryと、安定ID・`objectKind`・semantic metadataを導入 |
| P1-10 | ✅ 完了 | Vitest/Testing Library/Playwrightを導入し、CIでlint/typecheck/unit/audit/build/E2Eを実行 |

### F1–F10 完了表

| ID | 状態 | 実装結果 |
|---|---|---|
| F1 | ✅ 完了 | 統合export、全体/内容/選択、余白、背景/透過、倍率、ファイル名、対応ブラウザのSVG/PNG clipboard |
| F2 | ✅ 完了 | CAD端点/中点/中心/交点OSNAP、画面基準閾値、描画中marker |
| F3 | ✅ 完了 | 安定ID/anchorを保存する連動寸法と、参照object変更時の値・形状refresh |
| F4 | ✅ 完了 | 安定ID/anchorを保存する直線/エルボーconnectorと移動追従 |
| F5 | ✅ 完了 | Layer検索、rename、D&D Z順、Group tree、複数選択、一括表示/lock、Undo対応 |
| F6 | ✅ 完了 | 組込style preset、選択objectからのstyle記憶、選択/新規objectへの適用 |
| F7 | ✅ 完了 | IndexedDB上の名前付きproject、thumbnail、最大20世代のsnapshot、復元/削除 |
| F8 | ✅ 完了 | 選択範囲をthumbnail付きsymbol/templateとして保存し、IDを再採番して配置 |
| F9 | ✅ 完了 | `Ctrl/⌘+K` command palette、action/tool検索、左右panel折りたたみとlayout保存 |
| F10 | ✅ 完了 | CADモードのAutoCAD R12 ASCII DXF export（mm）と未対応/近似要素warning |

### 最新の検証結果（対応後）

| 検証 | 結果 | 補足 |
|---|---|---|
| `npm run lint` | ✅ 成功 | ESLint errorなし |
| `npm run typecheck` | ✅ 成功 | `tsc -b` |
| `npm run test:run` | ✅ 成功 | 19 files / 76 tests |
| `npm run build` | ✅ 成功 | TypeScript build + Vite production build |
| `npm audit` / `npm run audit:prod` | ✅ 成功 | 0 vulnerabilities |
| `npm run test:e2e` | ✅ 成功 | Chromiumで5 scenarios |

単体テストはexport geometry/PDF、DXF、history queue/transaction、schema migration/validation、autosave storage、CAD viewport/snap、semantic object、style、project/symbol repository、Dialog/PropertyField/Ruler/DrawingSessionを対象にしています。Playwrightは起動、モード切替、統合exportの主要経路を確認します。

### Acceptance scope と将来バックログ

本対応のacceptanceは、上表のP0/P1/F1–F10と、初回レビューの個別不具合・アクセシビリティ改善です。次の候補はデータモデルや製品範囲をさらに拡張するため **今回のacceptance scope外** とし、未完了扱いにはしません。

- Polygon / Polylineのノード編集、Bezierペン、boolean演算
- 複数artboard/pageと複数page PDF
- 角度/面積計測、連続壁、CAD画層
- DXF import / DWG、cloud同期、comment/共同編集

詳細は [`追加機能.md`](./追加機能.md) の「今後のバックログ」に整理しています。

---

## 初回レビュー記録（対応前）

以下は `main` / `9a4e5c8` に対して行った初回レビューの記録です。根拠行や「現行」という表現は対応前コードを指し、上記完了表が現在の実装状態です。

### 初回結論

機能は豊富で、TypeScript の strict 設定、lint、ビルド、CI、シリアライズ処理や共通 Canvas コマンドへの初期分割も整っています。一方、次の5点は新機能より先に対応する価値が高いです。

1. **エクスポート寸法を表示ズームから分離し、CAD PDF の用紙実寸を修正する**
2. **Undo/Redo を文書全体のトランザクションとして再設計する**
3. **脆弱性が報告されている直接依存パッケージを更新する**
4. **描画中のプレビューを文書オブジェクトから分離し、キャンセルを一元化する**
5. **`selectable` / `evented` のような一時UI状態を保存データから除外する**

その後、`Canvas.tsx` の責務分割、Fabric と React の状態同期、保存形式の検証、テスト基盤を進めると、追加機能を安全に増やせます。

## 検証結果（対応前）

| 検証 | 結果 | 補足 |
|---|---|---|
| `npm ci` | 成功 | Node v22.18.0 / npm 10.9.3 |
| `npm run lint` | 成功 | ESLint エラーなし |
| `npm run build` | 成功 | メイン JS が 590.13 kB、Vite の 500 kB 警告あり |
| 自動テスト | 未整備 | `test` script、プロジェクト内のテストファイルともになし |
| `npm audit` | 失敗 | 全依存で12件（low 2 / moderate 5 / high 4 / critical 1） |
| `npm audit --omit=dev` | 失敗 | 本番依存ツリーで4件（moderate 2 / high 1 / critical 1） |

### 出力寸法の再現確認

現行実装と同じ Fabric.js / jsPDF 設定で確認しました。

- 800×600 の挿絵キャンバスを PNG `multiplier: 2` で出力した場合、UIズーム 50% / 100% / 200% に対して、出力はそれぞれ **800×600 / 1600×1200 / 3200×2400** でした。README の「2倍解像度」は100%表示時だけ成立します。
- SVG の `width` / `height` も同じ条件で **400×300 / 800×600 / 1600×1200** に変化しました。
- A4縦を現行 CAD PDF 設定で作ると、MediaBox は **157.4×222.8 mm** 相当でした。本来の 210×297 mm に対して縦横とも75%です。

## 最優先（P0・対応前の指摘）

### P0-1. エクスポートを文書座標基準に統一する

**根拠**

- `src/hooks/useCadViewport.ts:69-80` — 挿絵モードで Canvas の寸法と viewport の両方にズームを適用
- `src/components/Toolbar.tsx:166-215` — 現在のライブ Canvas をそのまま SVG / PNG / PDF 化
- `src/components/CadExportDialog.tsx:30-50` — 出力のためライブ Canvas の viewport と寸法を一時変更
- `src/components/CadExportDialog.tsx:69-87` — 72 dpi 相当の px 値を `unit: 'px'` + `px_scaling` に渡す

**問題**

- 挿絵の SVG / PNG 出力寸法が表示ズームに依存します。
- CAD PDF の物理用紙サイズが25%小さくなります。
- PDF生成中に操作対象の Canvas 自体を変更するため、重い出力中のちらつきや別操作との競合が起こり得ます。
- 通常出力と CAD 出力に、PDF生成・ダウンロード処理が重複しています。

**改善案**

- シリアライズ済みデータから一時 `StaticCanvas` を作る `ExportService` を用意し、ライブ viewport を変更しないようにします。
- 挿絵出力は常に `{ canvasWidth, canvasHeight }` と恒等 viewport を基準にし、倍率は明示的な出力設定だけで決めます。
- CAD PDF は `jsPDF({ unit: 'mm', format: [paperW, paperH] })` とし、`pdf.svg()` にも mm 単位の幅・高さを渡します。
- SVG / PNG / PDF の共通テストとして「UIズーム・パンにかかわらず同じ結果」「PDF MediaBox が指定用紙と一致」を追加します。

**期待効果**: 出力物の寸法が信頼でき、CAD用途で致命的になり得る縮尺ミスを防げます。

### P0-2. Undo/Redo を文書全体の直列トランザクションにする

**根拠**

- `src/store/useEditorStore.ts:171-200` — 履歴は Fabric オブジェクトの文字列だけで、復元は非同期
- `src/utils/documentSerializer.ts:47-70` — 文書スナップショットは既に別途存在
- `src/components/PropertyPanel.tsx:107-151` — Canvas / CAD サイズ・背景色変更は履歴対象外
- `src/components/LayerPanel.tsx:87-100`、`src/components/ContextMenu.tsx:65-79` — 表示・ロック操作で履歴追加が不統一

**問題**

- 背景色、Canvasサイズ、CADサイズ、単位、縮尺、ガイド等を Undo できません。
- 連続 Undo/Redo で複数の `loadFromJSON()` が競合し、`historyIndex` と表示内容がずれる可能性があります。
- 復元失敗時は `_skipHistoryPush` が `.then()` で解除されず、その後の履歴記録が止まります。
- ファイル読込時に履歴をリセットしないため、別文書の状態へ Undo できてしまいます。

**改善案**

- 履歴要素を `CanvasSnapshot` 全体にし、`HistoryService` で復元を直列化します。
- `try/finally` で復元フラグを必ず解除し、復元中は Undo/Redo ボタンを無効化します。
- `executeCanvasCommand()` に変更、再描画、履歴、revision 更新を集約します。
- 連続入力や矢印キーのキーリピートは1トランザクションにまとめます。
- 新規作成・文書読込・自動保存復元には `resetHistory(initialSnapshot)` を使います。

**期待効果**: UI上の入口に関係なく全編集が同じ履歴規則に従い、データ保全と操作の予測可能性が上がります。

### P0-3. 直接依存の脆弱性を解消する

**根拠**

- `package.json:13-20`
- 2026-07-15 時点の `npm audit` / `npm outdated` 実行結果

**確認できた主な更新候補**

| パッケージ | lock上の現行 | semver範囲内の更新候補 | 備考 |
|---|---:|---:|---|
| `fabric` | 7.2.0 | 7.4.0 | SVGシリアライズ関連の advisory あり |
| `jspdf` | 4.2.0 | 4.2.1 | audit上 critical を含む advisory あり |
| `vite` | 7.3.1 | 7.3.6 | 開発サーバー関連の advisory あり |

`dompurify` や `ws` など推移的依存の警告も含まれます。ブラウザ版の実行経路で到達しないものもあるため個別トリアージは必要ですが、`fabric` と `jspdf` は実際のインポート・エクスポート経路で直接使用しているため、先に更新するのが妥当です。

**改善案**

- まず semver 範囲内で `fabric` / `jspdf` / `vite` と lockfile を更新し、描画、JSON互換性、SVG/PDF出力を回帰テストします。
- CI に `npm audit --omit=dev --audit-level=high`、Dependabot または Renovate を追加します。
- advisory がアプリの使用APIに到達するかを記録し、単に件数だけで判断しない運用にします。

### P0-4. 描画セッションと一時プレビューを分離する

**根拠**

- `src/components/Canvas.tsx:27-32` — 複数の ref で描画状態を個別管理
- `src/components/Canvas.tsx:439-452`、`src/components/Canvas.tsx:675-708` — Polygon / Polyline の点・補助線管理
- `src/components/Canvas.tsx:514-580` — mousemove ごとに一時 Fabric オブジェクトを remove / add
- `src/components/Canvas.tsx:716-723` — effect cleanup はイベント解除のみ
- `src/hooks/useKeyboardShortcuts.ts:128-133` — Escape はツール切替だけで描画中データを破棄しない

**問題**

- Polygon / Polyline の途中で Escape や別ツールへ切り替えると、点配列と補助線が残る経路があります。
- 一時図形も通常の Canvas オブジェクトなので、自動保存やエクスポートに混入する可能性があります。
- LayerPanel は `object:added` / `object:removed` を購読しているため、ドラッグ中の毎フレームにレイヤー再構築が発生します。
- 非同期 Alt+複製は clone 完了前に mouseup すると、半透明 clone が履歴外で残る競合があります（`src/components/Canvas.tsx:181-201`）。

**改善案**

- `DrawingSession` を `idle | dragging | polyline | measuring | stretching | placingLatex` の状態機械として一元化します。
- `cancelSession()` で一時状態、補助線、カーソル、選択可否を必ず復元します。
- プレビューは `contextTop`、専用 overlay Canvas、または単一オブジェクトの属性更新で描き、文書オブジェクト一覧へ追加しません。
- 非同期 clone / image load には操作トークンまたは `AbortController` 相当のキャンセル判定を入れます。

### P0-5. 一時的な操作状態を文書へ保存しない

**根拠**

- `src/utils/documentSerializer.ts:5,47-49` — `selectable` / `evented` をカスタムpropertyとして保存
- `src/utils/toolActivation.ts:15-20` — 描画ツール中は全オブジェクトを `false`、選択ツールでは `true` に変更
- `src/hooks/useAutoSave.ts:23-50` — 現在の操作状態のまま10秒ごとに保存

**問題**

描画ツールを選んだ状態で手動保存または自動保存すると、既存オブジェクトが `selectable: false` / `evented: false` として永続化されます。起動時の自動復元は active tool が既に `select` のため tool設定が再実行されず、復元したオブジェクトをクリックできない状態になり得ます。これは文書内容ではなく、その瞬間のUIモードが保存結果を変える問題です。

**改善案**

- `selectable` / `evented` を保存対象から外し、active tool、lock、object kind からロード後に導出します。
- ロックは専用の永続propertyで表し、Fabricの操作用フラグへ adapter で反映します。
- 「各ツールを選んだ状態で保存 → 再読込 → 選択・編集可能」を回帰テストへ追加します。

## 優先度高（P1）のリファクタリング（対応前の指摘）

| # | 対象 | 問題と改善方針 | 主な根拠 |
|---|---|---|---|
| P1-1 | `Canvas` の Store 購読 | 引数なしの `useEditorStore()` が全状態を購読しています。カーソル座標更新のたびに約982行の Canvas 全体が再レンダーされるため、個別selector / `useShallow` と `requestAnimationFrame` 単位の座標通知へ変更します。 | `Canvas.tsx:34-44`, `492-501` |
| P1-2 | `Canvas.tsx` の責務 | 初期化、描画、選択、履歴、スナップ、ガイド、CADパン、計測、LaTeX、Stretch、モーダル状態が集中しています。`useFabricCanvasLifecycle`、`useDrawingSession`、`useSnapping`、`useSelectionBridge`、`useGuideRenderer` などへ分割します。 | `Canvas.tsx:23-982` |
| P1-3 | Viewport の所有権 | Store setter、CAD hook、文書復元、Export が別々に Canvas 寸法・背景・viewport を変更します。状態更新を純粋化し、`ViewportController` / `CanvasAdapter` だけが Fabric に反映する設計にします。 | `useEditorStore.ts:133-149`, `useCadViewport.ts:41-82`, `CadExportDialog.tsx:37-50` |
| P1-4 | Fabric→React 同期 | CADパンは Fabric だけを更新するため、Ruler の目盛りが別の React 更新まで追従しません。`zoom/pan/objectCount/revision` を明示状態にするか `useSyncExternalStore` で購読します。 | `Canvas.tsx:481-488`, `Rulers.tsx:20-28`, `StatusBar.tsx:42` |
| P1-5 | CADズームとグリッド | `zoomToPoint()` に scene point を渡しており、パン後のカーソル中心ズームがずれます。viewport point を使います。また最小ズーム0.001では数万〜数十万本のグリッド線を描き得るため、画面上の最小間隔と最大線数で間引きます。 | `useCadViewport.ts:109-123`, `192-219` |
| P1-6 | 保存形式 | `JSON.parse() as DocumentData` は実行時検証ではなく、`version` も読み込み時に未使用です。数値範囲、enum、サイズ、Fabric JSON を検証し、`version -> migrate -> current` を用意します。`objects` の二重JSON文字列も解消候補です。 | `documentSerializer.ts:81-111`, `types.ts:133-148` |
| P1-7 | プロパティ編集 | `getBoundingRect()` の回転後AABBを表示しながら、編集時は raw `width/height` で scale を計算するため意味が一致しません。共通・Text・Rect・複数選択用 adapter に分け、`updateProp<K>()` でキーと値型を結びます。 | `PropertyPanel.tsx:47-70`, `91-101` |
| P1-8 | 数値入力 | `Number('')` が0となり、入力を消した瞬間に Canvas / CAD サイズや scale を0へ変更できます。HTMLの `min` だけでは防げません。文字列draftを保持し、blur / Enter 時に有限値・範囲を検証してcommitします。 | `PropertyField.tsx:38-47`, `PropertyPanel.tsx:113-149`, `useEditorStore.ts:133-166` |
| P1-9 | Tool / object metadata | Tool型、表示定義、描画方法、Ortho対応が分散し、LayerPanel は ID prefix や Group の子構成から意味種別を推測しています。網羅的 `ToolRegistry` と型付き `objectKind` を保存します。 | `types.ts:1-20`, `ToolPanel.tsx:16-43`, `shapeFactory.ts:45-175`, `LayerPanel.tsx:27-51` |
| P1-10 | テスト基盤 | lint / typecheck / build はありますが、正確性を守るテストがありません。Vitest とブラウザE2Eを導入し、CIの必須チェックへ追加します。 | `package.json:7-11`, `.github/workflows/ci.yml:20-29` |

## 個別に確認した不具合・不整合（対応前の指摘）

| 優先 | 内容 | 根拠 / 対応 |
|---|---|---|
| 高 | `Ctrl+Shift+Z` は `KeyboardEvent.key` が通常 `Z` になるのに小文字 `z` と比較しており、Redo が動かないブラウザがあります。 | `useKeyboardShortcuts.ts:42-53`; 最初に `const key = e.key.toLowerCase()` と正規化 |
| 高 | 寸法線の数値は作成時に一度計算した Text を Group 化しただけなので、拡縮後に表示値が追従しません。 | `shapeFactory.ts:129-170`; semantic dimension object と再計算処理へ |
| 高 | レイヤーの表示 / ロックと右クリックのロックは Undo 対象になりません。複数選択へのロックは ActiveSelection 自体にだけ設定され、子へ残らない可能性があります。 | `LayerPanel.tsx:87-100`, `ContextMenu.tsx:79`; Command 層へ統合 |
| 高 | SVG / Image import の外側の `try/catch` は、開始した Promise の rejection を捕捉しません。失敗時Toastが出ない経路があります。 | `Toolbar.tsx:108-155`; `async/await` + `try/catch` へ |
| 高 | CADモードのSpaceキー処理は入力要素やCanvas内テキスト編集中かを確認せず `preventDefault()` するため、文字入力やモーダル入力で空白を入力できない経路があります。 | `useCadViewport.ts:129-159`; editable target / Fabric text editing中はパン用キー処理を無効化 |
| 高 | Ruler は wrapper 原点を基準にしますが、挿絵Canvasは中央配置され、CADでもRuler自体が20px offsetされています。さらにパン・wrapper resizeでReact再描画されず、目盛りとガイド座標がずれます。 | `Rulers.tsx:20-65`, `Canvas.tsx:929-949`, `App.css:218-236`; Canvas viewport座標を単一変換関数で使用 |
| 中 | ステータスバーの「縮尺」と CAD Export ダイアログの縮尺は別stateで、前者は保存メタデータ以外の処理に使われません。 | `StatusBar.tsx:136-145`, `CadExportDialog.tsx:16-28`; 単一の scale 定義に統合、または表示だけなら名称を明確化 |
| 中 | Snap閾値がscene単位で固定5なので、CADのズーム率により画面上0.005px〜500px相当に変化します。 | `Canvas.tsx:247-357`; `thresholdScene = thresholdPx / zoom` |
| 中 | 履歴の矢印キー移動はキーリピート1回ごとに履歴を追加し、50件をすぐ消費します。 | `useKeyboardShortcuts.ts:105-125`; keyupまでを1 transactionにまとめる |
| 中 | LaTeXは callback で式とfontSizeを渡していますが、Canvas側は data URL しか保存せず、再編集できません。 | `LatexDialog.tsx:4-6`, `Canvas.tsx:792-811`; `latexSource` / `fontSize` をカスタムpropertyとして保存 |
| 中 | `html2canvas` を直接importしていますが `package.json` の直接依存ではなく、現在は jsPDF の推移的依存に偶然依存しています。KaTeX CSSもpackage版0.16.35ではなくCDN 0.16.22固定です。 | `LatexDialog.tsx:16-27`, `90`; 直接依存化しローカルCSS importへ |
| 中 | 画像を含むFabric JSONを最大50世代メモリ保持し、自動保存はlocalStorage容量超過を無通知で握りつぶします。保存されていると思って作業を続ける危険があります。 | `useEditorStore.ts:111,171-181`, `useAutoSave.ts:41-53`; 履歴の差分化/容量計測、IndexedDB、保存状態・失敗Toast |
| 低 | 初期履歴用 `setTimeout` が cleanup されず、unmount後に実行される可能性があります。 | `Canvas.tsx:145-154`; timerをclear、または初期化完了イベントで記録 |

## アクセシビリティとUI構造（対応前の指摘）

モーダルは見た目上の overlay / div で、`role="dialog"`、`aria-modal`、見出しとの関連付け、フォーカストラップ、Escapeクローズ、復帰フォーカスがありません。アイコンだけの閉じる・テーマ・レイヤー操作にも `aria-label` が不足しています。`label` と input の `htmlFor/id` 関係もありません。

また、Toolbar はwrap、左右パネルは72px / 220px固定、StatusBarは多数の操作を1行に並べ、CSSに media query がありません。機能追加前に次を用意するとUIの拡張余地が増えます。

- 共通 `Dialog` と `IconButton` コンポーネント
- focus管理とキーボード操作の共通hook
- 左右パネルの折りたたみ
- 狭い幅ではToolbar / StatusBarの低頻度操作を overflow menu へ移す
- 色をCSS custom propertiesへ寄せ、ライト / ダークの重複指定を減らす

主な根拠: `src/App.tsx:120-143`、`src/components/StretchDialog.tsx:29-49`、`src/components/LatexDialog.tsx:107-160`、`src/App.css:62-136`、`src/App.css:421-443`、`src/App.css:1085-1196`。

## 効果的な追加機能（対応前の提案）

前提として、上記P0と最低限の自動テストを先に完了させます。規模は実装と基本テストを含む概算です。

| 優先 | 機能 | ユーザー価値 | 既存コードを活かす実装案 | 規模目安 |
|---|---|---|---|---|
| F1 | 統合エクスポート + OSクリップボード | 選択範囲だけを透過PNG/SVGで資料へ即貼付でき、最頻出の持ち出し操作が短縮されます。 | 共通 `ExportDialog` に範囲（全体/内容/選択）、余白、背景、倍率/DPI、ファイル名を追加。`ClipboardItem` は対応判定付きで実装。 | S〜M（3〜5人日） |
| F2 | CAD描画時 OSNAP | 線・壁・寸法を端点、中点、中心、交点へ正確に接続できます。現行の移動時Smart Guideとは別のCAD中核機能です。 | `Canvas.tsx:395-396,503-512,593-603` の座標決定を `snapPoint()` に集約し、近傍候補とマーカーを表示。 | M（5〜8人日） |
| F3 | 連動寸法線 | 対象形状を変更しても寸法値が正しく保たれ、CAD図面の信頼性が上がります。 | `objectKind: 'dimension'`、参照ID、anchor、精度、単位を保存し、参照物の変更時に再計算。補助線・矢印も追加。 | M〜L（7〜12人日） |
| F4 | 接続点付きコネクタ | フローチャートや構成図で、図形移動後も線が追従します。 | 安定IDを利用し `fromId/toId/anchor/route` を保存。straight / elbow の自動ルーティングから開始。 | M〜L（7〜12人日） |
| F5 | レイヤーパネル強化 | オブジェクトが増えたときの探索・整理が大幅に速くなります。 | 既に保存される `name` を使い、リネーム、検索、D&D Z順、Groupツリー、複数選択の一括表示/ロックを追加。 | M（5〜8人日） |
| F6 | スタイルプリセット / スポイト | 図全体の色・線・文字を揃え、繰り返し作図を高速化します。 | `shapeFactory.ts:33-40` 等のハードコードを `EditorStyle` に置換し、図形・線・文字別の現在スタイルをlocalStorageへ保存。 | M（4〜7人日） |
| F7 | バージョン付きプロジェクト管理 | 誤編集やブラウザ再起動から復旧でき、複数作品を管理できます。 | 単一localStorageから IndexedDB の documents / snapshots へ移行。stable documentId、タイトル、サムネイル、世代上限を追加。 | M〜L（6〜10人日） |
| F8 | シンボル / テンプレート素材 | ドア、窓、家具、吹き出し、フローチャート部品を再利用できます。 | Group clone、ID再付与、SVG importを利用し、選択範囲をthumbnail付き素材としてIndexedDBへ保存。 | M〜L（6〜12人日） |
| F9 | コマンドパレット + パネル折りたたみ | 機能密度が上がっても目的の操作へ到達しやすく、Canvas面積も確保できます。 | 操作を action registry 化し Cmd/Ctrl+K 検索、ショートカット表示、左右パネル表示切替に利用。 | S〜M（3〜6人日） |
| F10 | DXF相互運用 | AutoCAD / Jw_cad 等との受け渡しが可能になり、CADモードの実務価値が上がります。 | 先に R12 ASCII export（LINE / LWPOLYLINE / CIRCLE / TEXT、mm）を実装し、未対応要素を警告。Importは後段。 | Export M、Import L |

### 将来候補（今回のacceptance scope外）

- Polygon / Polyline のノード編集、Bezierペン、ブール演算
- 複数アートボードと複数ページPDF
- 角度・面積計測、連続壁、建築画層

これらはデータモデル、選択制御、履歴への影響が大きいため、Command / History / object metadata の再設計後に着手する方が安全です。

## 推奨ロードマップ（対応前の計画・現在は完了）

### Phase 0: 正確性と安全性

1. Fabric / jsPDF / Vite の更新と回帰確認
2. ExportService と出力寸法テスト
3. HistoryService / Command transaction
4. DrawingSession と一時overlay
5. 保存schema検証、Vitest / E2E導入

### Phase 1: 日常操作の価値向上

1. 統合エクスポート / OSクリップボード
2. CAD OSNAP
3. 連動寸法線
4. レイヤーパネル強化
5. アクセシブルな共通Dialog / IconButton

### Phase 2: 差別化

1. コネクタ
2. スタイルプリセット / スポイト
3. バージョン付きプロジェクト管理
4. シンボル / テンプレート素材
5. DXF export

## ドキュメント整合性（対応前の指摘・現在は解消）

- `package.json:4` は v1.1.0 ですが、README の changelog は v1.0.3 までです（`README.md:133-159`）。
- 既存の `追加機能.md:3-23` は v1.0.3 を前提とし、鉛筆、Ortho、ダークモード、Toast、復元確認など、現在すでに実装済みの機能を最優先候補として挙げています。
- `README.md:36` の「縮尺」は現状ほぼ表示・保存用で、`README.md:43` の「PNG 2x」はUIズーム100%時のみ成立します。

本レポートを現行の改善バックログとして使い、既存 `追加機能.md` は更新または履歴資料として明示することを推奨します。
