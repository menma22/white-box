# 再編計画 — Quri 形式への移行

Phase 1 MVP（完成済み・動作中）を、Quri の開発形式——**pnpm monorepo・オニオンアーキテクチャ・契約駆動・TDD・コンポーネント分割・Storybook**——へ再編する計画。**生きた文書**なので、Phase が進むたびに下の「進捗」を更新する。

- 判断の経緯 → [decisions.md](decisions.md) の 012–016
- 現状の構成（移行元） → [architecture.md](architecture.md)
- まひろの決定（2026-08-21 フォーム回答）: バックエンド TS のまま / monorepo 化 / Storybook 導入 / 大きなタスクに分けて進め **最後まで完全に移行しきる**（複数セッション引き継ぎ前提）

---

## ゴール（最終形）

```
white-box/
├── pnpm-workspace.yaml
├── package.json                 # ルート: スクリプトの束ねだけ
├── apps/
│   ├── desktop/                 # バックエンド = Electron メインプロセス（オニオン）
│   │   ├── src/domain/          # session-ops / task-ops。純関数のみ・外部を知らない
│   │   ├── src/app/             # ユースケース。コマンド 1 つ = 関数 1 つ（Port を注入）
│   │   ├── src/infra/           # store(JSON) / windows / tray / shortcuts / power / clock
│   │   ├── src/presentation/    # IPC ルータ（契約で検証して app を呼ぶだけ）+ preload.cjs
│   │   └── tests/               # ユースケース単体テスト（Electron 起動なしで回る）
│   └── renderer/                # フロントエンド = React（Quri learning-app 形式）
│       ├── src/components/ui/   # 1 ファイル 1 部品（Button / Ring / ProgressBar / Chip / Modal …）
│       ├── src/components/layout/
│       ├── src/features/        # session / board / today / history / settings / welcome
│       ├── src/pages/           # 窓 1 つ = 1 ページ（main / start / hud / expire / review / current）
│       ├── src/stores/
│       ├── src/lib/
│       ├── src/stories/         # Storybook（ui / screen）
│       └── tests/
├── packages/
│   ├── contracts/               # 契約: 全コマンドの zod スキーマ + AppState / LiveTick DTO
│   └── core/                    # 両側で使う純粋な時間計算と型（現 shared/engine + types）
├── scripts/                     # pack / icons / e2e / shoot（新構造対応）
└── docs/
```

### 依存の向き（機械で強制する）

```
renderer  →  contracts, core        # これ以外の import は lint で落とす
desktop   →  contracts, core
contracts →  core, zod
core      →  （依存なし）
```

**まひろの要件「OpenAPI のようにバックエンドとフロントエンドがちゃんと分かれている」は、この import 境界の機械強制で担保する。** レンダラから見える世界は contracts（+ 表示用の core）だけ——Quri の FE が ts-client 越しにしか API を知らないのと同じ構図。契約の形式は OpenAPI YAML ではなく **zod の TS スキーマ**（decisions 013。TS 同士なら型を直接共有でき、codegen 工程が不要。IPC は HTTP でないため OpenAPI の語彙が合わない）。

### Quri から移植する開発規約

| Quri の実物 | White Box での形 |
| --- | --- |
| `GIT_WORKFLOW.md` | ほぼそのまま移植（Phase 0） |
| `docs/stories/`（story 駆動・ADR） | `docs/stories/` を新設。機能追加はまず story を書く |
| `tasks/*_handover.md`（セッション引き継ぎ） | `tasks/` を新設。Phase 間・セッション間の引き継ぎに使う |
| オニオン（api/src/{domain,app,infra,presentation}） | apps/desktop に同名の層 |
| learning-app の src 構造（components/features/pages/stores/stories） | apps/renderer に同構造 |
| Storybook 先行 → 確認 → 結線 の開発順序 | Phase 4 以降の UI 変更フロー |
| 契約ファースト（contracts が唯一の合意点） | packages/contracts（zod） |
| TDD | 各 Phase の実装は tdd-implement 準拠。ユースケースはテスト先行 |

---

## 移行の原則

1. **常にグリーン。** どの Phase の完了時点でも `pnpm typecheck && pnpm test && node scripts/e2e.mjs` が通り、アプリが日常使用できる。壊れた状態で Phase をまたがない。
2. **1 Phase = 1 つの大きなタスク = 1 本以上の PR。** Phase の途中でセッションが切れたら `tasks/<日付>_phase<N>_handover.md` を書いてから終える。
3. **移行中に仕様を変えない。** 見た目・挙動は移行前と同一を保つ（先行バグ修正 1 件を除く）。機能の追加・変更はこの計画の外。
4. **各 Phase の完了条件は観測可能な事実で書く**（「〜した」ではなく「〜が通る・〜が落ちる」）。

---

## Phase 一覧

### Phase 0 — 規約の移植と足場づくり

**目的**: 開発の「型」を先に入れる。コードの形を変える前に、作業の仕方を Quri 化する。

- npm → pnpm へ切替、workspace の骨組み（`pnpm-workspace.yaml`）を置く。**ファイル移動はまだしない**
- Quri から `GIT_WORKFLOW.md` を移植・適合。`docs/stories/`・`tasks/` の運用開始（この計画自体の handover もここに置く）
- 先行バグ修正: [WelcomeOverlay.tsx:33](../src/views/WelcomeOverlay.tsx:33) の「昨日」キー手組み（`dayStartHour` 無視）を `shared/engine.ts` の `dayKey()` に置換
- **完了条件**: pnpm で typecheck / test / e2e が全緑。バグ修正のテストが 1 件増えている

### Phase 1 — packages/core と packages/contracts（契約ファースト）

**目的**: 文字列 + `any` の IPC を、型付きの契約に置き換える。ここが「FE と BE がちゃんと分かれる」の心臓部。

- `shared/types.ts` + `shared/engine.ts` → `packages/core` へ
- `packages/contracts` 新設: 全 33 コマンドを zod で定義（コマンド名 → 引数スキーマ / 返り値スキーマの対応表 + `AppState` / `LiveTick` の配信スキーマ）
- レンダラの `bridge.ts` を型付きクライアントに置換（例: `client.session.start({ taskId, minutes })`）。メイン側の受け口は契約で validate してから処理へ渡す
- TDD: 契約の round-trip テスト（parse → validate）。既存 e2e 維持
- **完了条件**: `call('文字列')` が全滅・`any` 0 件。契約の引数名を 1 つ変えると両側の typecheck が落ちることを実証してから戻す

### Phase 2 — バックエンドのオニオン化（apps/desktop）

**目的**: [electron/main.ts](../electron/main.ts) の 33 ケース switch（270 行）を層に分解し、全ユースケースを Electron 起動なしでテスト可能にする。

- `apps/desktop` 新設。electron/ の中身を分解:
  - **domain**: `session-ops` + `mutations` を `task-ops` として純関数化（Database を受けて新しい値を返す形へ統一——現状は Session だけ純関数で Task/Project は破壊的変更、という割れを解消）
  - **app**: switch の case 1 つ = ユースケース関数 1 つ。`StorePort` / `WindowPort` / `ClockPort` / `TickerPort` を引数で注入
  - **infra**: store / windows / tray / shortcuts / power の実装
  - **presentation**: IPC ルータ（契約 validate → app 呼び出しのみ）+ preload
- `main.ts` は組み立て（依存注入）と起動だけに痩せる
- TDD: 全ユースケースの単体テスト（fake の Port を渡す）。`session:start` → `pause` → `switchTask` → `end` の全系が Electron なしで回る
- **完了条件**: main.ts が結線のみ（目安 100 行前後）。ユースケーステスト新設。e2e の 19 チェック維持

### Phase 3 — フロントエンドの feature 分割（apps/renderer）

**目的**: `src/` を Quri learning-app 形式に再編し、表示ロジックの重複を統合する。

- `src/` → `apps/renderer`。`features/`（session / board / today / history / settings / welcome）へ再配置。`ui/primitives.tsx`（260 行 9 部品）を `components/ui/` の 1 ファイル 1 部品に分解
- 重複の統合: 「（削除されたタスク）」7 箇所・残り時間の符号付き表記 3 箇所・Ctrl 表記 3 箇所 → `lib/` の関数 1 つずつへ
- `app.css`（2,163 行）を feature 単位に分割（tokens.css の規律は維持）
- `lib/selectors.ts` のテスト新設
- import 境界の機械強制を導入（eslint の import ルール）: renderer → contracts / core のみ
- **完了条件**: 全 6 窓の表示が移行前と一致（shoot.cjs のスクショで比較）。境界違反の import を書くと lint が落ちる

### Phase 4 — Storybook 導入

**目的**: 「story 先行 → まひろ確認 → 結線」の Quri 開発順序を使える状態にする。

- `apps/renderer` に Storybook（learning-app と同じ `src/stories/{ui,screen}` 配置）
- 主要部品（Ring / ProgressBar / Card / SessionRow / HUD / 満了ポップアップ等）の状態網羅 story
- **story には結果の状態を渡すだけ。タイマー等の機構を story 側に写さない**（本体と二重実装になり黙ってずれるため。fixture.ts の規律と同じ）
- **完了条件**: `pnpm storybook` で全 ui 部品と主要画面が確認できる

### Phase 5 — 配布と仕上げ

**目的**: 新構造で配布物を作れることを実機で証明し、文書を現実に同期する。

- `scripts/`（pack / e2e / shoot / icons）を新構造対応
- [architecture.md](architecture.md) 全面改訂・[progress.md](progress.md) 更新・CLAUDE.local.md の「壊してはいけないもの」を新構造の言葉に更新
- **完了条件**: 実 exe ビルド（`WHITEBOX_EXE` 経路の e2e）が通り、配布物の起動を実機で確認済み

---

## 進捗

| Phase | 状態 | PR | 備考 |
| --- | --- | --- | --- |
| 計画 | **この文書** | — | 2026-08-21 起草 |
| 0 規約と足場 | **完了**（2026-08-21） | feat/rearchitecture | pnpm 化・規約移植・dayKey バグ修正。詳細は [plans/rebuild-sessions.md](plans/rebuild-sessions.md) S1 |
| 1 core + contracts | **完了**（2026-08-21） | feat/rearchitecture | packages/core + packages/contracts（zod 33 コマンド）。IPC 両端が契約型付き・any 0 件・e2e 21 チェック |
| 2 desktop オニオン化 | **完了**（2026-08-21） | feat/rearchitecture | domain/app/infra/presentation の 4 層。全 33 ユースケースが Electron 起動なしでテスト可能に |
| 3 renderer 分割 | **前半完了**（2026-08-21） | feat/rearchitecture | S4 完了（構造移動・部品分割・重複統合・テスト）。後半 S5（CSS 分割・境界 lint・スクショ全比較）が残り |
| 4 Storybook | 未着手 | — | |
| 5 配布と仕上げ | 未着手 | — | |

## セッション引き継ぎの決まり

1. 新しいセッションはまずこの文書と直近の `tasks/*_handover.md` を読む
2. Phase を進めたら上の表を更新する（生きた文書）
3. Phase の途中で終えるときは `tasks/<日付>_phase<N>_handover.md` に「どこまで・次の一手・注意」を書く
4. 各 Phase の完了ゲートは常に `pnpm typecheck && pnpm test && node scripts/e2e.mjs`
