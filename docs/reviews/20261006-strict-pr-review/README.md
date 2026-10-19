# 全オープンPRの厳密レビュー（2026-10-06）

元の4PRには、保存・復旧・同時編集で記録や入力を損なう経路があり、そのままの承認はできない。修正版は必要な変更をPR #24へ集約し、617テスト、ソース版13本・隔離配布版12本の実Electron検証を通過した。過去の間欠的なnative終了停止の根因は未確定であり、修正版全体の無欠陥や無条件のリリース承認を主張しない。

製品の最終測定対象は `125026f7088487a429170f6276786a13f0e40c4c`、QAは `130016c83ce352598283ca8378362dad3c1821b0`。QAだけの後続修正と製品コードの一致を確認した。後続コミットは文書と監査証拠の提出だけを扱う。マージ・日常利用EXEへの反映・利用者DBの変更は行っていない。

## 確認する順序

- [最終検証記録](../../qa/20261006_strict-pr-review.json): 実行結果、コードと配布物の識別情報、制約。
- [#21 保存・依存・復旧](pr-21.md): DB拒否・rollback・取込・heartbeat・backup・待ち入力の指摘と証拠。
- [#22 実績・時間境界・履歴](pr-22.md): DST、日境界、長い履歴、合計保持の検算。
- [#23 見積・警告・編集](pr-23.md): 任意入力、タイトル、移動・失敗の保持。
- [#24 計画・文脈・終了](pr-24.md): 競合、操作凍結、窓の識別と表示、書出・検証器の安全性。
- [独立した安全性レビュー](final-safety-review.md)と[コメントレビュー](comments.md): 追加の再現と審査範囲。
- [変更ファイル一覧](changes.md): 修正・テスト・文書・監査成果物への入口。

## 対象を固定する

Repositoryは `menma22/white-box`。開始時と提出前のAPIでオープンPRを確認し、以下4本を対象にした。積み重なった差分と、最終状態の振る舞いを両方確認する。

| PR | 比較base | original head |
| --- | --- | --- |
| [#21](https://github.com/menma22/white-box/pull/21) | `743fc25ae2aeb377dec4658520f6f12d0ba59733` | `48cc55f7a33147e0c3fd7ab946d7cd9324faeb0e` |
| [#22](https://github.com/menma22/white-box/pull/22) | `48cc55f7a33147e0c3fd7ab946d7cd9324faeb0e` | `c9c19782365353094a3842b05b76b5373fb69031` |
| [#23](https://github.com/menma22/white-box/pull/23) | `c9c19782365353094a3842b05b76b5373fb69031` | `123666b1c94224ffaa62b8e415dfca1e891fafdb` |
| [#24](https://github.com/menma22/white-box/pull/24) | `123666b1c94224ffaa62b8e415dfca1e891fafdb` | `779df6e566a77d0c4fef4c8ef575d885e565f799` |

修正先は `codex/phase-2-completion`。#21〜#23のoriginal headは変更していないため、それぞれ単体を修正済み・独立リリース可能とは扱わない。台帳は導入PRと既存の欠陥、実測と静的到達、追加の保護判断を区別する。

## 記録・入力を守る修正

- 読込不能なDBを空データに置換せず、原本と退避コピーを保持して起動を中止する。取込前にレコードと開閉状態を検証し、通常の保存失敗をDBと実行時状態で巻き戻す。
- 生存時刻の途中書込で復旧用の成功記録を壊さない。終了時は最新の時刻を保存できなければ終了を取り消して計測と窓を維持する。合成データの故障注入では、既知の実作業30分が0分へ減る旧挙動を再現し、修正後の30分保持を確認した。
- 日次backupの整理を自分の正しい日付形式の通常ファイルに限定する。取込前・破損退避の名前衝突で以前の復旧版を上書きしない。書出先から管理ファイルと復旧用の場所を保護する。
- 複数窓で同じTask名・文脈・Noteを保存しても黙って置換しない。両方の文章を保持して本人の選択を待つ。保存・操作の待機中は入力を固定し、失敗時は画面と下書きを保持する。
- 待ち理由と、登録に失敗した外部待ちの入力も保持する。深い正常な階層・依存を再帰の限界で拒否せず、循環と新しい不正参照を拒否する。
- 未来の開始時刻を保存して次回起動不能になる経路、取込中の整理時間の実作業加算、DST境界、長い履歴の停止を修正する。月表示を変えても全期間合計は保持する。
- 古いclose予約を新しい窓へ送らず、Main/Currentの読込完了後の実表示を守る。実画面で見つかった重複React keyと、入力固定解除前のfocus失敗も修正する。
- 終了検証器はportだけで相手を信用せず、同じ接続上で起動PID・生成時刻・ページを照合する。検証による他profileへの誤書込を防ぐ。

各修正の再現条件・回帰・対象行は担当台帳に残す。履歴上の件数や失敗を新しい成功結果で上書きしない。

## 検証結果

| 確認 | 最終結果 |
| --- | --- |
| 型検査 / lint / pack / Storybook | 全体exit 0 |
| Vitest | 61ファイル617件成功、失敗0 |
| 所有PID判定のNodeテスト | 14件成功、失敗0 |
| ソース版の実Electron | 13スクリプト成功。製品一致の全体実行へ、後続QAのNote・基本検証を差し替えた構成 |
| 隔離配布版の実Electron | 12スクリプト成功。終了専用scriptはソース版のみ |
| 主要な実画面条件 | ソース/配布とも計画79、警告65、依存62、実績54 |
| 終了専用の実Electron | 観測器付き11、観測器なし7、複数窓11条件が成功。DB全体・再起動・所有PID不在を確認 |
| 配布物の照合 | アプリの864ファイル、うち本体・preload等135ファイル。欠落・余分・バイト不一致0 |
| 実ピクセル | 保存失敗入力、Task/Note競合、940×620の週・月別履歴を目視確認 |

最初のVitestは480件が通っても、Node形式のテスト混入で全体exit 1だった。テスト探索を正式な配置へ限定し、Nodeテストを別コマンドで実行した。旧v1のsettings省略を一時的に拒否した互換性不足も元のテストで発見して修正した。sandboxのchild-process起動拒否は製品失敗と分け、許可された実行で測定した。

全スクリプト成功は、全終了が同じ厳密さで測定されたという意味ではない。共通QAの一部は従来のcleanup経路を使う。計画・警告・終了専用の自然終了と、他のscriptのexit/PID不在を[スクリプト別証拠](evidence/final-source-publication.json)・[配布版証拠](evidence/final-package-publication.json)で区別する。

## 目的ごとの網羅

全変更単位を一次要件から導いた目的へ割り当てた。追加・削除・metadataを数え、欠落・重複・stale fingerprintを機械検算した。削除した保証の行き先も確認した。

| 固定差分 | 単位数 | 証拠 |
| --- | --- | --- |
| 元の4PR | 8,460（追加7,914 / 削除477 / metadata69） | 各PR台帳のinventoryと割当 |
| original #24 head → `e620a26a` | 1,915（追加1,683 / 削除219 / metadata13） | [inventory](evidence/repair-inventory.json) / [割当](evidence/repair-assignments.json) |
| `e620a26a` → `97e583d5` | 1,098（追加1,028 / 削除68 / metadata2） | [inventory](evidence/post-repair-inventory.json) / [割当](evidence/post-repair-assignments.json) |
| `97e583d5` → `125026f7` | 61（追加56 / 削除5） | [inventory](evidence/checkpoint-repair-inventory.json) / [割当](evidence/checkpoint-repair-assignments.json) |
| QA `125026f7` → `15eea5d1` → `130016c8` | 2 + 18（全体追加17 / 削除3） | [Note待機](evidence/notes-readiness-assignments.json) / [CDP要求](evidence/cdp-repair-assignments.json) |

この網羅率は「全行の目的を追跡できた」証拠であり、意味の正しさは故障注入・独立計算・実Store/IPC/DOM・再起動の証拠で別に判定する。提出用の文書と監査ファイルは製品測定範囲から分け、リンク・JSON・件数・識別情報を検算する。公開ログはUTF-8/LF化とcheckoutパスの正規化を行うため、原ログと公開コピーのハッシュを[対応表](evidence/log-transforms.json)で区別する。

## 残る制約

- 修正途中のTask Priorityは、業務61条件成功後のrestart終了で15秒timeoutとなり、所有アプリを強制cleanupした。観測器付きの同じ操作3追試は6起動とも自然終了したが、うち1追試は撮影timeoutで全体失敗。同じデータのquit検証と最終版は成功しても、元のnative終了停止の根因解決とは断定しない。
- 撮影timeoutの回では、Mainの読込完了通知が届いてもnative visible=falseだった。これは独立に修正・回帰した。Current再表示のCDP接続timeoutと、古いclose予約の競合も因果を混ぜない。
- 配布版Noteの戻り操作で一度timeoutを観測した。診断の同じ操作は22条件成功し、別の遷移でNote消失後にもinertが残ることを実測した。QAは入力受付・描画を待つよう補強し、元の戻りshortcutを保持して22条件が成功したが、元のtimeout原因を特定したとは扱わない。基本QAの未完了CDP要求によるNode exit13は実関数の対照9条件で再現・修正した。
- Windowsのnativeファイル選択操作はアクセス拒否により未確認。実保存先と実Storeを使う回帰は、ダイアログ応答だけを制御した検証である。物理的なタイトルバーの×操作も、native closeイベント経路の検証と区別する。
- 停電時のOS/ディスク耐久性、保存に成功していない最新heartbeat以後の実作業、全旧EXEによる新項目の保持は保証しない。
- 日常利用DBは読み取り専用で形式と読取前後のbytes一致を確認した。内容・件数・個別ファイルの識別情報は公開しない。検証は隔離profileと合成データで行った。

## 引き継ぎ

作業checkoutは `.review-worktrees/white-box/phase-2-effort-slack-aging-and-risk`、branchは `codex/phase-2-completion`。ディレクトリ名とbranch名は異なる。repository rootの古いmainと、既存の未追跡 `artifactreview/phase2-contextual-ux-review.md` は維持する。

検証を再実行する前に [正式な手順](../../verification.md) を読む。UIは `scripts/run-ui-e2e.ps1` のMutexで直列実行し、測定中にbuildを変えない。Windows shellはrepository rootで `login:false` から起動して対象checkoutへ移動する。以前のnative停止が再発したら、所有PID・保存応答・全窓・終了イベントのlive記録を採取してから原因を判定する。強制終了や検証条件削除で成功へ変えない。
