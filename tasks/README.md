# tasks — セッション引き継ぎの置き場

セッションを跨ぐ作業の handover をここに置く（Quri の tasks/ と同じ流儀）。
再編中は [docs/plans/rebuild-sessions.md](../docs/plans/rebuild-sessions.md) の S1〜S7 が作業単位で、**セッションの途中で終えるときは必ず handover を書いてから終わる**。

## 命名

```
YYYYMMDD_S<N>_handover.md         再編セッションの引き継ぎ（例: 20260821_S2_handover.md）
YYYYMMDD_<件名>_handover.md       再編以外の作業の引き継ぎ
```

## handover の必須項目

1. **どこまで終わったか** — 完了タスク ID（T〜）とコミットハッシュ
2. **次の一手** — 次セッションが最初にやること（具体的なファイルとコマンド）
3. **注意** — ハマった点・未解決の違和感・触ってはいけない箇所
4. **ゲートの状態** — `pnpm typecheck && pnpm test && node scripts/e2e.mjs` の最後の結果

新しいセッションは、[rebuild-sessions.md](../docs/plans/rebuild-sessions.md) の状態表 → 直近の handover の順に読んでから着手する。
