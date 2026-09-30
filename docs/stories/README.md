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
