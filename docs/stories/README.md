# docs/stories — story 駆動開発の置き場

機能追加・仕様変更は、実装より先にここへ **story** を 1 ファイル書く（Quri の docs/stories/ と同じ流儀）。
再編（rebuild-plan / rebuild-sessions）はこの仕組みの外——再編完了後の機能開発から適用する。

## 命名

```
YYYYMMDD_story_<短い英語スラッグ>.md      例: 20260901_story_weekly-review.md
YYYYMMDD_adr_<短い英語スラッグ>.md        設計判断だけを残すとき（ADR）
```

## story の必須項目

1. **目的** — 誰の何の問題を解くか（仕様書 [product-spec.md](../product-spec.md) のどの節に基づくか）
2. **受け入れ基準** — 観測可能な形で列挙（`- [ ]` チェックリスト。「〜が表示される」「〜が保存される」）
3. **やらないこと** — スコープ外の明示
4. **設計メモ** — 触る層（contracts / desktop / renderer）と影響範囲

## 流れ

story を書く → まひろが受け入れ基準を確認 → ブランチを切る（1 story = 1 PR、[GIT_WORKFLOW.md](../../GIT_WORKFLOW.md)）→ UI があれば story 先行（Storybook）→ 契約 → 実装 → ゲート → PR。
完了した story は受け入れ基準にチェックを入れて残す（消さない。何を約束して何を果たしたかの記録）。

## 週間カレンダーの版

前回の検証時点（[d18e596](https://github.com/menma22/white-box/commit/d18e596270410772faacf21e5ebc0d1f0c9d3310)）の本文を保持する。

- [v2 — 第2回修正と現在の検証](20261011_story_weekly-calendar-v2.md)
- [旧本文 — d18e596時点の履歴](20261011_story_weekly-calendar.md)

## 道標の枝の編集

- [v4 — 枝の付け替え・中継目標の要件と検証根拠](20261017_story_goal-branches-v4.md)
- [v3 — 終了観測の上限を訂正](20261017_story_goal-branches-v3.md)
- [v2 — 操作・保存の検証と先行する終了観測](20261017_story_goal-branches-v2.md)
- [v1 — 実装前の受け入れ基準](20261017_story_goal-branches-v1.md)
