# 軸部材断面・断面性能表示機能 作業計画

- 作成日: 2026-07-15
- 対象: `codex/section-properties`（基点: `dc191da`）
- 対象アプリ: VectorEditor v1.1.0
- 状態: 初期リリース範囲と最終統合QAを完了、Draft PR作成待ち

初期リリースとして計画したチェック項目は、実装と対応テストを確認してすべて`[x]`にしています。

### 現在の到達点

- 断面化、材料Union、穴・欠込みDifference、選択した凸角への直線―直線Rを実装
- `A`、`G`、`Ix`、`Iy`、`Ixy`、主軸、最外縁距離、弾性断面係数を実装
- 結果パネル、単位切替、Canvasオーバーレイ、Worker解析、Undo／Redo、保存、主要exportを統合
- 既知解、位相、Boolean、R、履歴、永続化、10,000頂点、ブラウザE2Eのテストを追加
- 一般曲線・凹角Rなどの対象外範囲を明示し、最終品質ゲートと実ブラウザ確認を完了

## 1. 目的

CADモード上の閉じたベクター図形を、軸部材の「材料が存在する断面」として扱えるようにします。複数部材の合成、切り抜き、基本的な角Rを反映した断面プロファイルを作成し、その形状から次の幾何学的断面性能を表示します。

- 断面積 `A`
- 重心位置 `G = (Cx, Cy)`
- 重心軸まわりの断面二次モーメント `Ix`, `Iy`
- 断面相乗モーメント `Ixy`
- 主断面二次モーメント `Imax`, `Imin` と主軸角度
- 重心から上下左右の最外縁までの距離 `cTop`, `cBottom`, `cLeft`, `cRight`
- 各側の弾性断面係数 `ZxTop`, `ZxBottom`, `ZyLeft`, `ZyRight`

本機能は、断面形状を整理し、断面性能を確認するためのものです。材料強度、許容応力度、軸力・曲げ耐力、座屈、接合部の一体性などを判定する設計照査機能ではありません。

## 2. 初期方針

### 2.1 対象範囲

- CADモード限定とし、内部座標は `1 unit = 1 mm` とします。
- 同一材料で構成された2次元の総断面（gross section）を対象とします。
- 線幅は断面厚さとして扱わず、閉じた面の内部だけを材料領域とします。
- Boolean演算後の正規化された断面輪郭を保存し、計算結果は形状から毎回再計算します。
- 操作は破壊的な確定操作としますが、Canvas履歴の1トランザクションとしてUndo可能にします。
- 必要に応じて「元図形を保持」を選択できるようにします。

### 2.2 MVPで扱う形状

| 入力形状 | 対応 | 備考 |
|---|---|---|
| 矩形 | 対応 | 回転、拡大縮小、反転を座標へ反映 |
| 角丸矩形 | 対応 | `rx` / `ry` を断面境界へ反映 |
| 円・楕円 | 対応 | 許容差付きの折線へ変換 |
| 閉じたPolygon | 対応 | 自己交差しない形状に限定 |
| Group | 条件付き対応 | 対応形状だけで構成される場合に再帰展開 |
| 開いたPolyline・Line | 対象外 | 面積を定義できないため拒否 |
| Pencil・Bezier・任意SVG Path | 対象外 | 初期リリースでは輪郭の妥当性を保証しない |
| 文字・画像 | 対象外 | 断面形状へ変換しない |

### 2.3 初期の形状操作

- **断面化**: 選択した閉図形を1個の断面プロファイルへ変換
- **合成（Union）**: 重複を二重計上せず、複数の材料領域を合成
- **切り抜き（Difference）**: 選択した閉図形を穴・欠込みとして減算
- **角R**:
  - 既存の角丸矩形の`rx` / `ry`は断面性能へ反映
  - `approximate: false`の閉じた直線輪郭について、外周の凸頂点を選択し数値Rを適用
  - 選択角、各角の最大R、隣接角を含む共通最大RをUIへ表示し、確定前の輪郭をpreview
  - Rが辺長に対して大きすぎる場合や自己交差を生む場合は確定しない
  - R適用結果は円弧を折線近似するため`approximate: true`となり、同じ断面への2回目のR適用は行わない
  - 円・楕円・角丸矩形、およびそれらを含むBoolean結果への追加Rは行わない
  - 凹頂点、穴頂点、円弧同士、円弧と直線の一般フィレットは後続段階へ分離
- 離れた複数領域も数学上は1断面として計算できますが、接合条件を確認する警告を表示

### 2.4 初期対象外

- 材料別ヤング係数を考慮する換算断面
- 塑性断面係数、ねじり定数、そり定数、せん断中心、せん断面積
- 薄肉線要素としての断面入力
- 応力、耐力、許容値、使用率の照査
- 元図形の変更へ自動追従する非破壊Boolean
- 3次元断面、複数材料、鉄筋を含むRC断面解析
- Pencil・Bezier・任意SVG Pathなどの一般曲線を断面輪郭として取り込む処理
- 凹角・入隅R、穴角R、直線―円弧／円弧―円弧フィレット
- 円・楕円・既存R・曲線由来Boolean結果への追加R、およびR確定後の再R編集

## 3. 利用フロー

1. CADモードで矩形、角丸矩形、円、楕円、Polygonを実寸で配置します。
2. 材料として扱う閉図形を選び、「断面を作成」または「材料を合成」を実行します。
3. 穴や欠込みにする閉図形を選び、「選択形状で切り抜き」を実行します。
4. 直線輪郭では必要な凸角を選択し、最大Rを確認しながらR寸法を入力してpreview後に確定します。
5. 右パネルの「断面性能」で数値、単位、近似精度、警告を確認します。
6. Canvas上には重心、重心軸、主軸、最外縁補助線をオーバーレイ表示します。
7. 合成・切り抜き・R操作はUndo/Redoでき、保存・再読込後も同じ結果を再計算します。

重心位置の既定原点は断面外接範囲の左下とします。将来は、ユーザーが断面ローカル原点を指定できるよう拡張します。

## 4. データモデル

Fabricオブジェクトを直接積分せず、Fabric／Reactから独立した純粋な断面モデルへ変換します。

```ts
interface SectionPoint {
  x: number;
  y: number;
}

interface SectionRing {
  role: 'outer' | 'hole';
  points: SectionPoint[];
}

interface SectionProfileData {
  version: 1;
  rings: SectionRing[];
  analysisToleranceMm: number;
  approximate: boolean;
}

interface SectionProperties {
  area: number;
  centroid: SectionPoint;
  ix: number;
  iy: number;
  ixy: number;
  principalMax: number;
  principalMin: number;
  principalAngleDeg: number;
  cTop: number;
  cBottom: number;
  cLeft: number;
  cRight: number;
  zxTop: number;
  zxBottom: number;
  zyLeft: number;
  zyRight: number;
}
```

設計上の規則:

- `objectKind: 'sectionProfile'` と `sectionProfileData` をFabricの永続メタデータへ追加します。
- 外周は反時計回り、穴は時計回りへ正規化します。
- 離れた領域は複数外周を持つMultiPolygonとして保持します。
- 計算結果は保存せず、正規輪郭から都度計算してstaleな結果を防ぎます。
- 表示用Fabric Pathは派生キャッシュとし、`fillRule: 'evenodd'` で穴を表現します。
- 保存データにはリング数・頂点数・座標範囲・有限値の専用検証を追加します。
- 旧文書に新メタデータが存在しなくても読めるため、文書schema v2は維持し、`SectionProfileData.version` で将来移行します。

## 5. 座標・単位・符号規約

- 解析カーネルは `x: 右向き`, `y: 上向き` の断面ローカル座標を使用します。
- Fabric Canvasの下向きY軸は、変換境界で一度だけ反転します。
- 図面の表示縮尺、zoom、panは断面性能へ影響させません。
- `Ixy = ∫xy dA` を正と定義します。
- 主軸角度は+x軸から反時計回り、`[-90°, 90°)` で表示します。
- 計算はmm系で行い、表示時だけ選択単位へ変換します。

| 結果 | 内部単位 |
|---|---:|
| 重心、最外縁距離 | mm |
| 断面積 | mm² |
| 断面二次／相乗モーメント | mm⁴ |
| 断面係数 | mm³ |
| 主軸角度 | degree |

表示単位はmm系／cm系を切り替え、面積は2乗、断面二次モーメントは4乗、断面係数は3乗で換算します。

## 6. 幾何処理

### 6.1 Fabric形状の正規化

1. `calcTransformMatrix()` 相当の全変換を適用し、document mm座標へ展開
2. CanvasのY軸を工学座標へ変換
3. 曲線を許容差付きの折線へ変換
4. 重複点、極短辺、同一直線上の不要点を整理
5. 自己交差、面積ゼロ、非有限座標、特異変換を検査
6. 外周・穴の包含関係と向きを正規化

非一様拡大された円は楕円として、せん断された形状は一般輪郭として処理します。stroke幅は面積に含めません。

### 6.2 円・楕円・角R

円弧は許容サジッタから分割数を決めます。

```text
Δθmax = 2 acos(1 - e / r)
n = ceil(|θ| / Δθmax)
```

- `e` はユーザーが指定するmm単位の解析公差とし、内部では余裕を持たせたサジッタ基準で再帰分割します。
- 曲線変換は最大再帰深さと65,536頂点、R円弧は4,096分割を上限とします。
- 上限まで収束しない場合は、精度を偽らずエラーにします。
- 結果パネルへ「近似計算」と使用公差を表示します。

### 6.3 Boolean演算

浮動小数点のクリッピングを独自実装せず、MITライセンスでブラウザ対応の`polygon-clipping`をadapter越しに利用します。穴、接触形状、離れた領域、大座標を既知解と比較し、結果は独自の断面モデルへ戻して位相検証します。整数量子化方式は採用していません。

処理手順:

1. 形状を外接範囲中心付近へ一時移動し、桁落ちを抑制
2. 浮動小数点MultiPolygonとしてUnionまたはDifferenceを実行
3. MultiPolygonを外周・穴へ再構成
4. 極小結果、点接触、線接触、空結果を検査
5. リング向き、包含、交差を再検証
6. 妥当な場合だけCanvasと履歴へcommit

Difference対象が交差しない場合は警告し、Canvasや履歴を変更しません。Unionでは重複面積を二重計上しません。

## 7. 断面性能計算

各リングを構成する有向辺 `(xi, yi) → (xj, yj)` についてGreenの定理を用います。

```text
cross = xi*yj - xj*yi

A    = 1/2  Σ cross
Cx   = 1/(6A) Σ (xi + xj) cross
Cy   = 1/(6A) Σ (yi + yj) cross

Ix0  = 1/12 Σ (yi² + yi*yj + yj²) cross
Iy0  = 1/12 Σ (xi² + xi*xj + xj²) cross
Ixy0 = 1/24 Σ
       (2xi*yi + xi*yj + xj*yi + 2xj*yj) cross
```

穴は負の向きで同じ式へ加算します。重心軸へは平行軸の定理で移します。

```text
Ix  = Ix0  - A*Cy²
Iy  = Iy0  - A*Cx²
Ixy = Ixy0 - A*Cx*Cy
```

大座標での桁落ちを避けるため、外接範囲中心付近へ座標を移してから積分し、総和にはKahanまたはNeumaier補償和を使用します。

主断面二次モーメントは次の対称行列の固有値として求めます。

```text
J = [[ Ix,   -Ixy ],
     [ -Ixy,  Iy  ]]

Imax/min = (Ix + Iy)/2
         ± sqrt(((Ix - Iy)/2)² + Ixy²)
```

### 7.1 重心から最外縁までの距離

ここでいう端部距離は、重心から最寄り境界ではなく、各曲げ方向の最外縁までの距離です。

```text
cTop    = max(y) - Cy
cBottom = Cy - min(y)
cRight  = max(x) - Cx
cLeft   = Cx - min(x)
```

### 7.2 弾性断面係数

```text
ZxTop    = Ix / cTop
ZxBottom = Ix / cBottom
ZyRight  = Iy / cRight
ZyLeft   = Iy / cLeft
```

非対称断面では正負側を1個の値にまとめません。主軸については全境界点を主軸へ投影し、正負側を別々に求める拡張を可能にします。

## 8. UI設計

### 8.1 操作入口

形状作成ツールではなく、選択物へのコマンドとして追加します。

- Toolbar: `断面を作成`, `材料を合成`, `切り抜き`, `角R`
- Command Palette: 上記4操作を検索・実行可能
- Context Menu: 対象選択時だけ同じ操作を表示
- ToolTypeは増やさず、既存の選択・履歴モデルを利用

### 8.2 断面性能パネル

単一の`sectionProfile`選択時に右パネルへ表示します。

- 断面積、重心、`Ix`, `Iy`, `Ixy`
- `Imax`, `Imin`, 主軸角度
- 上下左右の最外縁距離
- 正負側の断面係数
- 表示単位切替
- 計算公差と近似表示
- 接触・離間・極薄部などの警告
- 重心軸／主軸／最外縁表示のON/OFF

重心、軸、最外縁補助線は一時オーバーレイで描き、JSON保存やSVG／PNG／PDF出力へ混入させません。zoom／pan後もCanvas座標変換を使って追従させます。

### 8.3 エラー表示

次の場合は結果を表示せず、対象と理由を明示します。

- 開いた輪郭、自己交差、3個未満の独立点
- 面積が許容値以下、Boolean後に空
- NaN／Infinity、特異変換、ほぼ0のscale
- 曲線近似が頂点上限まで収束しない
- 成立しないR、R適用後の自己交差

次の場合は計算しつつ警告します。

- 離れた複数領域
- 曲線やRを折線近似した断面
- 極端に薄い領域

点／線接触だけの領域、外周へ達する切り抜き、材料領域外にはみ出す切り抜きを個別分類する警告は、初期リリース後の改善候補とします。離れた複数外周については接合条件を確認する警告を表示します。

## 9. 既存コードへの統合

### 9.1 追加した主要ファイル

| ファイル | 責務 |
|---|---|
| `src/domain/section.ts` | 断面型、結果型、エラー型、単位・符号規約 |
| `src/utils/sectionGeometry.ts` | Fabric形状→正規リング、曲線分割、向き・包含正規化 |
| `src/utils/sectionTopology.ts` | 自己交差、外周・穴の包含／交差validation |
| `src/utils/sectionBoolean.ts` | Booleanカーネルadapter、Union／Difference |
| `src/utils/sectionProperties.ts` | Green公式、平行軸、主軸、最外縁、断面係数 |
| `src/utils/sectionShapeFactory.ts` | `SectionProfileData` と複合Fabric Pathの相互変換 |
| `src/utils/sectionCommands.ts` | 断面化、合成、切り抜き、R、履歴transaction |
| `src/utils/sectionFillet.ts` | 凸角列挙、選択角R、最大R・隣接辺・結果位相validation |
| `src/components/SectionOperationsDialog.tsx` | 操作、凸角選択、最大R、R preview、実行前validation |
| `src/components/SectionPropertiesPanel.tsx` | 結果表、単位、警告、overlay設定 |
| `src/hooks/useSectionAnalysis.ts` | 選択・revisionに応じた再計算と古い結果の破棄 |
| `src/workers/sectionAnalysisWorker.ts` | 大規模断面の非同期解析 |
| `src/workers/sectionAnalysisProtocol.ts` | Worker要求・応答型とvalidation |
| `e2e/section-properties.spec.ts` | 代表操作のブラウザE2E |

各純粋関数とComponentの隣に`.test.ts`／`.test.tsx`を配置します。

### 9.2 変更対象

- `src/utils/fabricObjectMetadata.ts`: `sectionProfileData`の永続化
- `src/utils/documentSerializer.ts`: 断面リングと頂点数の専用validation
- `src/utils/canvasCommands.ts`: 既存のtransaction入口を利用して1操作1履歴に統合
- `src/components/PropertyPanel.tsx`: `SectionPropertiesPanel`の表示
- `src/components/Toolbar.tsx`, `ContextMenu.tsx`, `CommandPalette.tsx`: 操作入口
- `src/components/SectionPropertiesPanel.tsx`: 重心・軸overlayと再計算通知
- `src/services/exportService.ts`: 複合Pathの回帰確認
- `src/services/dxfExporter.ts`: 外周・穴をclosed POLYLINEとして出力し、曲線近似を警告
- `src/i18n/ja.ts`, `src/i18n/en.ts`: 操作、結果、単位、警告、Help文言
- `src/App.css`: パネル、結果表、警告、overlay設定のスタイル

SVG／PNG／PDFは複合Pathを既存経路で描画します。DXFは外周と穴を個別のclosed POLYLINEとして出し、受け側で穴の意味が保持されない可能性を警告します。

## 10. 実装フェーズ

### Phase 0: 仕様固定・技術スパイク（当初見積: 1〜2人日）

- [x] CAD内部mm、原点、Y軸、`Ixy`符号、表示単位を固定
- [x] 代表断面（矩形、円環、T／L形、偏心穴、角R）の期待値fixtureを作成
- [x] Booleanを穴、接触、離間、大座標のケースで検証
- [x] 10,000頂点を使うBoolean専用benchmarkを追加
- [x] `polygon-clipping`のライセンス、ブラウザ互換、production bundleへの統合を確認
- [x] MVPと後続フィレットの境界を実装UIで固定

### Phase 1: 数値カーネル（当初見積: 3〜4人日）

- [x] `SectionProfileData`／`SectionProperties`型を追加
- [x] リング向き、包含、退化形状のvalidationを実装
- [x] Green公式、重心軸移動、主軸、最外縁、断面係数を純粋関数で実装
- [x] 補償和と座標シフトを導入
- [x] 既知解・不変量の単体テストを作成

### Phase 2: Fabric変換・Boolean（当初見積: 4〜6人日）

- [x] 矩形、角丸矩形、円、楕円、Polygon、対応Groupをmmリングへ変換
- [x] 回転、非一様scale、反転、親Group変換をbake
- [x] 曲線の適応分割、再帰深さ・頂点上限を実装
- [x] Union／Difference adapterを実装
- [x] 複合Path生成、穴、複数外周を描画
- [x] 失敗時はCanvas・履歴を変更しないことをテスト

### Phase 3: 操作・表示・履歴（当初見積: 4〜6人日）

- [x] 断面化、合成、切り抜きをCanvas transaction化
- [x] 「元図形を保持」を追加
- [x] Section Operations Dialog／Properties Panelを追加
- [x] mm系／cm系換算、近似精度、警告を表示
- [x] 重心、重心軸、主軸、最外縁overlayを追加
- [x] Undo／Redo、clone／copy時の断面metadata保持を実装・検証
- [x] 断面を含むgroup／ungroupの専用統合テストを追加
- [x] 5,000点未満の同期計算と、5,000点以上のdebounce付きWorker処理・revisionによる古い結果の破棄を実装

### Phase 4: 保存・出力・相互運用（当初見積: 2〜4人日）

- [x] JSON、autosave、project、symbolのround-tripを検証
- [x] Fabric metadataのリング数・頂点数・座標・有限値validationを追加
- [x] SVGで複合Pathと穴を保持する回帰テストを追加
- [x] PNG／PDFを実ブラウザで出力し、生成物の形式と出力経路を回帰確認
- [x] DXF closed POLYLINE出力と近似／穴警告を追加
- [x] 日英UI、Help、READMEを更新

### Phase 5: 直線輪郭の選択角R（当初見積: 3〜5人日）

- [x] 厳密な直線輪郭の凸外周頂点だけを列挙・選択するUIを追加
- [x] 直線―直線フィレットの接点・円弧中心を算定
- [x] 各角／選択角の最大R、隣接R競合、結果位相をvalidation
- [x] 選択角とR結果のpreview後に1履歴で確定
- [x] 穴を維持し、未選択角を変更しないことを検証
- [x] 円・既存R・曲線由来Boolean・R適用済み断面を全APIで明示的に拒否
- [x] 凹角、穴角、直線―円弧／円弧―円弧Rを対象外として明示

### Phase 6: 統合QA・性能対策（当初見積: 2〜4人日）

- [x] 数値精度、履歴、保存、SVG／DXFの統合テスト
- [x] 10,000境界頂点の断面性能benchmarkと曲線頂点上限を設定
- [x] 重い計算をWeb Workerへ移し、古いjobを破棄
- [x] Playwrightで断面化／合成→切り抜き→結果→Undo／Redo→JSON再読込を検証
- [x] 最新worktreeで`npm run check`, `npm run test:e2e`, `npm run audit:prod`を最終一括実行

概算:

- 利用可能なMVP（角丸矩形、合成、切り抜き、主要断面性能）: **14〜22人日**
- Polygon頂点フィレットとWorkerを含む計画全体: **19〜31人日**

Boolean依存の選定結果、任意Rの編集UI、DXFでの穴表現により変動します。

## 11. 数値検証計画

### 11.1 既知解

| ケース | 検証内容 |
|---|---|
| 矩形 `b × h` | `A=bh`, `Ix=bh³/12`, `Iy=hb³/12`, 重心中央 |
| 円 `r` | `A=πr²`, `Ix=Iy=πr⁴/4` |
| 同心円環 `R, r` | 外円から内円の面積・二次モーメントを減算 |
| 重なる矩形 | Union結果を重なりのない既知矩形と比較 |
| T形・L形・H形 | 矩形分割と平行軸の定理による独立計算と比較 |
| 偏心穴 | 重心移動と非ゼロ`Ixy`を比較 |
| 角丸矩形 | `A=bh-(4-π)r²`、重心中央、`Ixy=0` |
| 回転断面 | `A`, `Imax`, `Imin`の回転不変性 |

固定fixture例:

- 矩形 200 × 100 mm:
  - `A = 20,000 mm²`
  - `G = (100, 50) mm`
  - `Ix = 16,666,666.6667 mm⁴`
  - `Iy = 66,666,666.6667 mm⁴`
- 円 `r = 50 mm`:
  - `A = 7,853.981634 mm²`
  - `Ix = Iy = 4,908,738.521 mm⁴`
- 円環 `R = 50 mm, r = 30 mm`:
  - `A = 5,026.548246 mm²`
  - `Ix = Iy = 4,272,566.008 mm⁴`

### 11.2 不変量

- 平行移動後も`A`と重心軸断面性能が不変
- 一様倍率`s`で`A → s²A`, `I → s⁴I`, `c → sc`, `Z → s³Z`
- 回転後も`A`, `Imax`, `Imin`が不変
- 鏡像後も`Ix`, `Iy`が維持され、`Ixy`の符号だけが規約どおり反転
- リングの開始頂点や向きを正規化しても同じ結果

### 11.3 UI・永続化

- 1操作が履歴1件になり、失敗操作は履歴を追加しない
- Undo／Redo、保存／再読込、複製後も同じ結果
- zoom／panしても重心・主軸overlayが0.5px以内で追従
- 表示単位や図面縮尺を変更しても内部計算値は変わらない
- E2Eで「2矩形を合成→円で切り抜き→結果表示→Undo／Redo→JSON再読込」を確認

## 12. 受入基準

- [x] 対応する閉図形だけが断面化でき、対象外形状には理由が表示される
- [x] Unionで重複面積を二重計上しない
- [x] Differenceで面積、重心、二次モーメントが正しく減算される
- [x] 直線輪郭の既知解に対する相対誤差が`1e-9`以内
- [x] 円、円環、角Rの面積相対誤差が`1e-5`以内
- [x] 曲線を含む`Ix`, `Iy`の相対誤差が`5e-5`以内
- [x] 重心誤差が`max(0.001 mm, D×1e-6)`以内（`D`: 最大外形寸法）
- [x] 不正・空・退化形状でNaN／Infinityを表示しない
- [x] 近似結果には公差と近似表示が付く
- [x] Undo／Redo、保存・再読込、clone／copy／duplicate後も断面metadataと結果が一致
- [x] 10,000境界頂点をWorkerへ送り、UIスレッド上の同期解析を避ける
- [x] SVG／PNG／PDFで複合Pathを維持し、DXFでは近似・穴の制約を通知する
- [x] lint、typecheck、unit tests、production build、Playwright、dependency auditが成功する

## 13. リリース判断

### MVPリリース条件

- [x] 角丸矩形を含む対応形状から断面を作成できる
- [x] Union／Differenceと主要断面性能が既知解を満たす
- [x] Undo／Redo、保存、再読込、主要exportが成立する
- [x] 数値公差、近似、対象外、接合上の注意がUIで明示される

### 後続リリース条件

- [x] 直線Polygon頂点フィレットの選択、preview、最大R、validationを実装
- [x] Worker化により大きな断面の同期計算をUIスレッドから分離

今回の対象外として残す将来候補:

- 主軸方向の正負側`c`／`Z`、結果表の図面配置
- 一般曲線・凹角・再編集可能なRモデル

## 14. 採用した仕様決定

Phase 0から実装までに、次の内容で確定しました。

1. 「元図形を保持」の既定値はOFFとし、Undoで復元可能にする
2. 重心位置の既定原点は外接範囲左下とする
3. 既定表示はmm系とし、結果パネルでcm系へ切り替え可能にする
4. 凸頂点Rは厳密な直線輪郭だけに限定して初期範囲へ含める
5. 離れた複数領域は計算を許可し、接合条件を確認する警告を表示する

## 15. 最終検証結果

- `npm run check`: ESLint、TypeScript、Vitest、production buildが成功
- Vitest: 32ファイル／192テスト成功（10,000点の断面性能・Boolean benchmarkを含む）
- `npm run test:e2e`: Chromium 8シナリオ成功（断面化、合成、切り抜き、角R、Undo／Redo、JSON再読込、SVG／PNG／PDF出力を含む）
- `npm run audit:prod`: production依存の脆弱性0件
- `git diff --check`: 成功
- 実ブラウザ確認: 角候補、最大R、選択1角preview、R確定後の断面性能、再R対象外理由、ブラウザconsole errorなしを確認
