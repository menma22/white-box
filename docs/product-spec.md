# White Box — プロダクト仕様・設計原則・実装ロードマップ（v3）

このリポジトリのマスター文書。何を作るのか、なぜそう作るのか、どの順で作るのかは、すべてここが正。
機能追加で迷ったら §25 の判断基準に戻る。

2026-09-24 の追加仕様: 道標の既存機能を White Box のUIと保存へ統合する。目標の木・問題／問い／改善・構造履歴を保持し、タスクはボード・時間計測と共有する。機能対応と旧データ移行の仕様は [道標の統合](michishirube.md)。成果（Outcome）の追加・達成判定は今回に含めない。

> 公開版にあたり、例として挙げていた実在のプロジェクト名だけ一般名に置き換えている（内容と構造は変えていない）。

---

## 0. このシステムは何なのか

このアプリは、単なるタスク管理アプリでも、Pomodoro でも、時間管理アプリでも、モチベーション維持アプリでもない。

根本的に解決したい問題は、

> **自分が何を目指し、何を重要だと考え、実際に何をして、何にどれだけ時間を使い、どこまで進み、最終的に何を生み出したのかがブラックボックス化してしまうこと。**

目標に向けて何かをやっていても、

- 今、自分は何をしているのか
- 今日は何をしたのか
- 今週何を進めたのか
- 何が止まっているのか
- どのプロジェクトにどれだけ時間を使ったのか
- 自分が重要だと決めたものに、本当に時間を使えているのか
- 数週間・数か月前に自分は何をしていたのか
- 最終的にどんな成果を生み出したのか

が曖昧になる。

そのため、このシステムの最初の中心ループは、

> **タスクを管理する → 今やるタスクを選ぶ → 実行を記録する → 終了時に進捗を確認する → 後から実績を見る → 次に何をやるか判断する**

という閉ループ。

長期的には、

> **目標を持って何かに取り組む人が、自分との約束、実際の行動、そこから生まれた成果を記録し続け、自分がどう歩んできたのかを生涯失わないための実行基盤**

を目指す。

短く言えば、

> **自分との約束を、現実の行動と成果までつなぐアプリ。**

---

## 1. このアプリがユーザーにとってどういう存在であるべきか

### 1-1. 目標に向かって何かをするときの「必需品」

理想的には、

> 「今日は記録しようかな」

ではなく、

> **何か目標に向けて仕事・研究・勉強・開発を始める = このアプリでタスクを Start する**

という関係になる。

コードを書くならエディタを開くように、目標に向けて仕事をするならこのアプリを使う。

一時的な「意識高い人向け習慣アプリ」ではなく、

> **目標を持って何かに取り組む限り、生涯使い続けられる実行基盤**

を長期コンセプトにする。

---

## 2. このシステムが解決する中核問題

本質的な問題は、

> **自分の現在の作業状態と過去の実行履歴が不可視であるため、次に何をすべきか継続的に判断できず、その場で発生した刺激に作業選択を支配されること。**

さらに、

> 自分では「進めているつもり」でも、本当の進捗が分からない。

という問題もある。

だからこのアプリは、

> **真の進捗を、可能な限り低摩擦かつ歪みなく記録する。**

それによって、

> 「うわ、全然進んでないやん」

という現実も見える。その現実が最大の抑止力・コントロール機構になる。

---

## 3. 全体設計原則

### 原則1：実行記録は絶対に残す

何か意味のある仕事を始めたら、

> **何を・いつから・いつまでやったのか**

が残ることは必須。これはこのシステムの最も強い制約。

### 原則2：管理すること自体を仕事にしない

構造化はする。しかし過剰入力は要求しない。例えば、

- タスク分解はできるが強制しない
- Outcome への紐付けはできるが強制しない
- 進捗は更新できるが、無意味な数値変更は強制しない
- Daily Planning は支援するが強制しない
- AI 待ち時間を毎回手入力させない

という設計にする。

---

## 4. 「無駄な摩擦」と「必要な摩擦」を分ける

### 無駄な摩擦

徹底的に減らす。例：

- 毎回プロジェクト名を入力
- 毎セッション長文を書く
- タスクを必ず細分化
- Start まで何画面も開く
- AI 待ちを逐一登録
- どうでもいい項目を大量入力

### 必要な摩擦

消してはいけない。例：

- 今から何をやるか決める
- 終了時に本当にどこまで進んだか確認する
- 放置タスクを今後どうするか判断する
- 大切な Goal を本当にやめるのか考える

設計原則として、

> **無駄な摩擦は徹底的に消す。必要な摩擦からは逃がさない。**

を採用する。

---

## 5. ユーザーを責めない。しかし自己欺瞞を許さない

このアプリは、

> 「もっと頑張れ」「3日もサボっています」

と叱るアプリではない。代わりに、

> あなたはこれを High Priority に設定した。しかし3日間進捗がない。今後どうしますか？

と現実を提示する。選択肢として、

- 今やる
- Priority を変更
- Blocked にする
- Inbox へ戻す
- やめる

などを出す。重要なのは、

> **「重要」と言いながら永遠に何もしない曖昧な状態を許さないこと。**

---

## 6. Priority は命令ではなく判断材料

システムは、Slack / Dependency / External Block / Aging / Project Priority / Weekly Priority / Context / Estimated Effort などを使って判断材料を出す。しかし、

> **最終的に何をやるかを決めるのは人間。**

自動推薦はあってよい。自動強制はしない。

---

## 7. タスク粒度は人間に委ねる

「5分以下まで分解」「30分以内になるまで分解」などの固定ルールは採用しない。基準は、

> **そのタスクを見たとき、自分が次に何をすればよいか分かるか。**

分かるなら、それ以上分解しなくていい。例えば「論文を進める」は曖昧なので分解した方がよい。一方、「バックエンドの PR を完成させる」を見て、自分が何をすればよいか完全に理解しているなら、それでよい。API 追加、Schema 修正、Test 追加まで全部書く必要はない。

### Task Tree

分解したい場合は、

```
バックエンド PR
├ API
├ Schema
└ Test
```

のように Tree 化できる。しかし分解は任意。

> **Task Tree は分解を可能にするものであって、分解を義務化するものではない。**

---

## 8. 計画と時間割を混同しない

Planning 自体は必要。ただし、

> 火曜 14:00〜16:00 論文

のような、自分だけで自由に実行できる仕事の詳細 Time Blocking は基本的に採用しない。外部制約で時刻が固定されている、

> 14:00 定例ミーティング

などは予定として扱ってよい。原則：

> **When is flexible. What is constrained.**
> **Plan outcomes / commitments, not every hour.**

---

## 9. 「仕事の構造」と「時間の構造」を分離する

ここは非常に重要な設計原則。

仕事の構造：

> Direction → Outcome →（必要なら Milestone）→ Task → Subtask

時間の構造：

> Year → Month → Week → Day → Now

これらを一対一に対応させない。以前の「Week = Outcome」という考え方は撤回。Outcome は複数 Week かかってもよい。Week には、その時点で適切な粒度の親タスク・タスク群・Milestone 的なまとまりなどを置ける。

---

## 10. Planning の抽象度

長期ほど抽象的。実行時点に近づくほど具体化する。

| 層 | 置くもの |
| --- | --- |
| Year | 大きな方向 |
| Month | 到達状態 |
| Week | 今週進めるまとまり |
| Day | 必要なら今日 Focus する対象 |
| Task | 人間が実行できる仕事 |

セッションのさらに細かい仕事内容まで事前に全部書く必要はない。

> **遠い未来ほど抽象的。実行時点に近づくほど具体的。**

---

## 11. Gamification の中核思想

このアプリの Gamification は、「タスクをやったから 100XP」のような外部報酬中心にしない。目指すのは、

> **目標を進め、タスクをこなし、成果が生まれていくこと自体が楽しくなる設計。**

つまり、

> **現実そのものをゲームとして気持ちよく見せる。**

### 11-1. Progress Visualization

主役は、Task Tree が進む／プロジェクトが前進する／Outcome が Achieved になる／Artifact が増える／自分の History が積み上がる、という現実の進歩。

### 11-2. 架空 Reward を主役にしない

XP / Coin / Badge を完全否定はしない。しかし、

> 本当の成果より XP を稼ぐことの方が嬉しい

状態には絶対にしない。最適化対象は **実世界の Progress**。

---

## 12. 自分との比較を中心にする

このアプリの主要評価軸は「他人より何時間働いたか」ではない。

> **自分が重要だと決めたことと、自分が実際にやったことの差**

を見る。モチベーションの主要源泉は、自分自身の内側に置く。

---

## 13. 大切な Goal / Outcome は大切に扱う

Goal や Outcome は単なる Todo ではない。ユーザーが「これは自分にとって重要」と決めたもの。だから、長期間進捗がなければ、

> この Goal は High Priority ですが、○週間進捗がありません。

と浮上させる。Priority を下げたり閉じるときも、「本当に変更しますか？」と一度考えさせてもよい。

ただし「絶対に続けろ」とはしない。本当にもう重要ではないなら、

> **自覚的に閉じる**

ことも正しい意思決定。

---

## 14. 過去を消さない

長期的には、成功・停滞・Block・やり直し・タスク追加・方針転換・Outcome 中止も含めて、自分の意思決定 History として残す。例えば、

> 「失敗したから消した」

ではなく、

> 「この日、この Goal を追わないことを自分で決めた」

という記録にする。

---

## 15. 休むことも意思決定

このシステムは労働時間最大化装置ではない。Rest Day に仕事0分なら「最悪の日」とは評価しない。むしろ、

> 休むと決めたなら、ちゃんと休む

ことも自分との約束。

---

## 16. プラットフォーム・技術的前提

| 項目 | 決定 |
| --- | --- |
| OS | Windows 限定 |
| プロジェクト | 完全新規 |
| アプリ形態 | Desktop App |
| UI | Web 技術ベースでよい |
| 保存 | 完全 Local |
| Login | MVP 不要 |
| Cloud | MVP 不要 |
| 外部 Deploy | 不要 |
| 利用対象 | まず自分自身 |
| 基本利用 | PC 作業中心 |

ブラウザアプリは採用しない。理由：Windows Startup / Background 常駐 / Global Shortcut / Always-on-top Popup / ブラウザを閉じても Timer 継続 / 将来の Windows Activity 取得、が必要だから。

---

## 17. 基本データ構造

### Project

仕事のまとまり。タスクは基本プロジェクトに紐づく。ただし Unlinked Task も許可する。

### Task

実際に行う仕事。親子構造可能。粒度は人間依存。

### Session

仕事をしていた時間のまとまり（例：14:00〜14:50）。タスクそのものとは別 Object。

### Task Segment

Session 内でタスクが切り替わった場合の区間。

```
Session 14:00–14:50
  14:00–14:28 Task A
  14:28–14:50 Task B
```

ただし「Task A 終了 → Session 終了 → Task B で新 Session」でもよい。両方許可する。基本的に、同一瞬間の Foreground Task は1つ。

### Outcome【後続】

> **それ自体で意味があり、検証可能で、それ自体が一定の成果として認められる結果・状態。**

### Success Criteria【後続】

Outcome とは別に、**何が成立したら Achieved なのか** を定義。

### Milestone【候補・未確定】

Outcome と Task の中間概念として有用。ただし正式 Object 化は未確定。

### Habit【後続】

Task とは別。Task は「完了する」、Habit は「繰り返す」。Outcome / Project / Task を `Supports` する形でリンク可能。必須ではない。

### Artifact【後続】

成果物（GitHub Repository / PR / Release / Paper / Document / Slide / Video / Website / Image）。

---

## 18. MVP の定義

MVP は非常に絞る。目的：

> **今日から実際に使えて、自分が何をどれだけやったのか確実に残せて、タスクを軽く管理できる状態。**

MVP の中心：

> **Task Management + Execution Tracking**

Planning OS までは作らない。

---

## Phase 1 — MVP

| # | 項目 | 内容 |
| --- | --- | --- |
| 1-1 | Windows Desktop 基盤 | Background 常駐 / 起動時自動起動 / Local persistence / Global Shortcut / Always-on-top Popup |
| 1-2 | Project 管理 | 作成・編集・削除・タスクとの紐付け。Unlinked Task も許可 |
| 1-3 | Task Kanban | Inbox（実行するとコミットしていない。Aging 対象外）/ Todo / Doing / Done |
| 1-4 | Task Tree | 任意分解。強制しない |
| 1-5 | Task Progress | 0〜100%。終了レビューで更新可能。毎セッション必ず変更する必要はない |
| 1-6 | Start UI | Global Shortcut → 最前面。既存タスクから選択。緊急・突発タスクはその場で作成可 |
| 1-7 | Session Duration | 「今から何分仕事するか」。既定 50 分。変更可能、義務ではない |
| 1-8 | Session Start | 開始時刻・タスク・プロジェクト・設定 Duration を保存 |
| 1-9 | Pause | RUNNING 中にショートカットまたはボタン。Timer 停止 |
| 1-10 | Pause UI | 小型 UI に Resume / End。× で閉じられる。停止中に同じショートカットで**確認なしで即 Resume** |
| 1-11 | End | 途中終了可能。基本操作は RUNNING → Pause → End。End すると Review へ |
| 1-12 | Timer 満了 Popup | 最前面の小型専用 UI。End / Extend（既定 +15分）/ Break（既定5分、時間変更可）。休憩終了後は通知し、明示的に再開するまで停止を維持 |
| 1-13 | Next Task 導線 | 満了 Popup に Next Task。現在タスク Review → 次タスク選択 → Start まで滑らかにつなぐ |
| 1-14 | Current Work 画面 | 別ショートカットで即表示。Current Task と Other Tasks の2区画 |
| 1-15 | Current Work からの操作 | タスク切替 / 分解 / 新規作成 / 緊急追加 / 編集 |
| 1-16 | Task 切替 | Session 途中で変更でき、切替時刻を Task Segment として保存 |
| 1-17 | 1 Task = 1 Session 運用 | 途中切替を使わない運用も可能。どちらも強制しない |
| 1-18 | Session Event Log | Session 中の変更時刻を内部記録。すべて UI 表示する必要はない |
| 1-19 | 終了 Review | End または満了後に大きめ UI。長文を書かせる場所ではない |
| 1-20 | Review 内容 | 実際にやったタスク / Progress / Done か / Session 中に追加されたタスク / 情報の補正 |
| 1-21 | Session 永続保存 | Start / End / Actual Focus Time / Pause Time / Project / Task / Segment / Progress 変更 |
| 1-22 | 過去 Session 編集 | MVP から対応。「タスク選択間違えた」を直せないと記録自体が嫌になるため |
| 1-23 | Session 削除 | 可能。ただし必ず確認。長期的には Soft Delete / Audit Log 化を検討 |
| 1-24 | 最低限 Today 表示 | 今日の総 Tracked Work と Session 一覧。高度な Dashboard は Phase 2 |
| 1-25 | Welcome 画面 | その日初めて PC を使い始めたときに一度。Todo / 重要タスク / Warning / 整理への導線 / 今日を考える小さな余白 |
| 1-26 | Welcome の後続拡張 | 自分へのメッセージ、忘れたくない言葉、Reminder、名言など（構想） |

### MVP 完成条件

```
PC 起動 → タスクを見る → ショートカット → タスク選択 → Start
  → Pause / Resume / End → Progress 確認 → 履歴保存 → 今日どれだけやったか確認
```

これが**ストレスなく成立すること**。そして、

> **一度ここで機能追加を止めて日常投入する。**

実際の使用で見つかった問題を Phase 2 以降へ反映する。これは重要な開発原則。

---

## Phase 2 — Task Control / 可視化強化

- **Today View**: 今日の総作業時間 / Project 別時間 / Task 別時間 / Timeline / Session 履歴 / Task 進捗
- **Week View**: 基本は実績画面。日ごとの作業時間、Project 別・Task 別時間、何をしたか、Weekly Metrics。予定表中心にはしない
- **最近の作業時間推移**: 折れ線等で直感的に見る
- **Blocked**: Progress とは別軸（例：70% / Blocked）
- **Dependency Blocked**: 別タスクが終了しないと進めない。タスク同士をリンク
- **External Blocked**: 外部の人・組織・出来事待ち。**通常タスクの山に埋もれない専用 UI** を持つ。最低限「誰待ち・何待ち・いつから」
- **External Blocked Follow-up**: 一定期間後に「確認しますか？」と Follow-up Action を浮上。Follow-up Date / 最終連絡日 / 次に確認する日
- **Hard Dependency**: A が終わるまで B を開始できない
- **Recommended Order**: A → B が推奨。強制ではない
- **Slack**: Deadline そのものではなく余裕時間（Deadline − Remaining Effort − Safety Buffer）
- **Estimated Effort**: 「あとどれくらいかかりそうか」を任意入力。Session Duration とは別
- **Aging**: Todo で長期間放置されたタスクを徐々に浮上。Inbox は対象外
- **Warning Escalation**: Normal → Warning → High Risk → Overdue。「やっていない = 怠け」とは判定しない
- **Warning 表示場所**: Welcome / Task Board / Today / Week など、通常必ず見る場所
- **Project Priority**: プロジェクト自体の重要度
- **Weekly Time Budget**: 一週間全体から睡眠・食事・固定時間を引いた利用可能時間を出し、プロジェクトごとに資源配分（Minimum / Maximum / Range / 上限なし、既定配分の再利用）
- **Fixed Work**: 外部要因で時刻が確定している Work Task のみ事前登録
- **Task Notes / Problems**【後続寄り】: Notes / Problems / Decisions / Next Context / 再開時に覚えておくこと

---

## Phase 3 — Outcome / Planning System

- **Outcome** 正式導入、**Success Criteria** の定義
- **Outcome Validation**: 単なる作業ではないか / 検証可能か / 成果として意味があるか
- **Outcome と Task**: リンク可能。ただし必須ではない（Unlinked Task を正式に許可）
- **Outcome 達成は自動化しない**: 「Task 全部 Done = Achieved」とはしない。人間が明示的に判断する。全部 Done なのに未達成なら、まだ必要なタスクが存在するので言語化する
- **Goal / Outcome 停滞の浮上**
- **Planning 時間軸**: Year / Month / Week / Day / Task
- **Weekly に置くもの**: Weekly Outcome 専用にはしない。親タスク・タスク群・Milestone 的まとまり
- **Daily Planning**: 強制しない。Welcome で考える機会は作れる
- **Task Decomposition Session**: タスクを考える時間そのものも仕事として計測可能
- **Weekly Review**: 週終了時にアプリ側から能動的に聞く。長文入力は必須にしない

---

## Phase 4 — Habit / Life Context / Special Mode

- **Habit**: Task とは別 Object。Outcome / Project / Task を Support できる。リンクは任意。Target Duration を持てる
- **Rest Day**: 正式な概念。タスクとして保存せず Day Type / Context として扱う。仕事0分でも「悪い日」とは評価しない
- **Special Event / Exceptional Day**: 評価対象から除外可能
- **Special Sprint / 合宿**: 期間中だけ Priority / Outcome / Resource Allocation を変更できる構想

---

## Phase 5 — Artifact / Personal History / Gamification

- **Artifact**: タスクや Outcome を終えた結果、実世界に何が残ったかを保存し、Project / Outcome へ紐づける
- **Personal History**: Project → Outcome → Task → Session → Decision → Artifact を時系列で辿る
- **生涯の成果台帳**: 自分が人生で何を作ったのかを一覧可能にする
- **Gamification = Progress Visualization**: Tree が完成していく / Project が進む / Outcome が達成される / Artifact が増える / History が積み上がる、それ自体を楽しいものにする
- **Achievement History**: 数字を目的にはしない
- **Reward / Reward Memory**: 「この Outcome を達成したら旅行」など。写真を残す構想
- **XP / Badge**: 未確定。導入してもよいが主役にはしない

---

## Phase 6 — Social / Network

- **基本思想**: Comparison ではなく Connection / Learning
- **Default Private**（絶対原則）: Task / Project / Goal には未公開製品・研究・仕事・顧客・個人的目標が含まれる
- **個別公開**: 本人が選んだものだけ（Outcome / Task Tree / Artifact / Project / Progress History）
- **Similar People Discovery / Task Decomposition Learning / Role Model 探索**
- **Mentor 構想**: DM 過多・負担・Spam の問題があるため要検討
- **Feed 思想**: 受動的に大量に見せる方向は避け、能動的な探索を優先
- **Ranking**: 未確定。採用する場合も Opt-in / 非表示可能 / Main Experience にしない / 単純作業時間ランキングにしない
- **友達との日次作業時間比較**: 現時点では基本不採用（不要な比較・落ち込み・自己評価の歪み・Attention の移動）

---

## Phase 7 — External / AI Integration

- **Google Calendar**: Session 実績を Calendar へ追加。既存予定を上書きしない
- **Windows Activity / Untracked Time**: App usage / Website / PC activity を取得し、Tracked Work との差を分析
- **Reality Check**: 申告と実際の乖離を発見
- **AI Session Integration**: Claude Code / Codex / AI Agent 等の Session とタスクを自動リンク
- **AI Waiting は手動入力しない**: 細切れに頻発し入力負荷が高すぎるため不採用。将来的に AI Session 側から自動観測
- **AI Task Recommendation**: 「次はこれをやる可能性が高い」。優先度は低め。人間が最終決定
- **Smart Progress**: 「論文10本読む」から `7 / 10` 型の Progress を提案

---

## 19. 長期データ保全【重要要件・詳細未確定】

「生涯使う」を本当に目指すなら、Local 保存だけでは不十分になる。将来的に検討必須：Backup / Export / Import / DB Migration / PC 移行 / Disaster Recovery。MVP では不要だが、長期コンセプト上、必ず解決する必要がある。

## 20. Local-first と将来 Social の関係

MVP は完全 Local で確定。Social 機能を実装するなら Account / Server / Cloud が必要になる。有力思想は、

> **Local-first を維持し、Social を有効化した人だけ Optional Cloud / Account を使う。**

ただしこれはまだ正式決定ではない。

## 21. 過去削除と「過去を消さない」の整合

MVP は「Session 削除可能 + 確認」。長期は Soft Delete / Audit Log の方向が思想と整合する。「操作として削除できる」と「歴史として完全消滅させない」を将来的に両立できる。

---

## 22. 検討して不採用・撤回したもの

1. Browser App（Desktop 機能が必要）
2. iOS-first（Windows-first）
3. Cloud / Login を MVP から入れる（Local Only）
4. 詳細 Time Blocking（External Fixed Work のみ例外）
5. Planning を MVP に入れる（まず Execution Tracking）
6. Week = Outcome（Week は時間軸）
7. Weekly Outcome しか置けない（Task / 親 Task / Milestone 等も置ける）
8. 全 Task Done = Outcome 自動 Achieved（人間が明示確認）
9. 固定 Task 粒度（人間依存）
10. Task は必ず Outcome へ Link（Unlinked Task 許可）
11. 終了 Tag 中心（Progress / Done / Blocked 中心）
12. Switched を Task Status にする（実行履歴として持つ）
13. Continue ボタン（満了 Popup は End / Extend）
14. 24時間すべて Tracking（Meaningful Work 中心。Untracked は後で自動取得）
15. Rest Day を Task 化（Day Context）
16. 同一瞬間に Foreground Task 複数（Foreground は1つ）
17. AI Waiting 手動入力
18. 架空 Reward 中心 Gamification
19. 友達との作業時間比較を Social の中心にする
20. Ranking 完全否定（撤回。現在は未決定）

---

## 23. まだ完全には決まっていない項目

**技術**: Global Shortcut キー / Current Work Shortcut / Start と Pause を同じショートカットにするか / Windows Startup 具体方式
**Session UX**: Next Task を満了 Popup へ正式採用するか / Task Segment と 1Task=1Session のどちらを推奨するか / End 操作の最終ボタン構成
**Task Control**: Estimated Effort 形式 / Slack 詳細計算式 / Safety Buffer / Priority Algorithm / Priority Weight / Dependency UI / Hard Dependency と Recommended Order の表示 / Task Notes 具体形式
**Planning**: Milestone を正式 Object 化するか / Goal・Direction・Outcome の正式名称 / Year・Month UI / Weekly に配置する Object の UX / Weekly Review の時刻と詳細
**Welcome**: 詳細コンテンツ / 自分への Message 等の設定方式
**History / Data**: Audit Log / Soft Delete / Backup / Export / Import / DB Migration / PC 移行
**Gamification**: Progress Visualization 具体 UI / XP 有無 / Badge 有無 / Reward UX / Scoring そのものを導入するか
**Social**: Ranking 採用可否と指標 / Feed 有無 / Mentor Request / 公開粒度 / Account・Cloud 設計 / Local-first との共存
**Integration**: Google Calendar 最終表示方式 / Windows Activity 取得方法 / AI Session linking 方式

一部は Phase 1 の実装時に暫定的に決めている。何をどう決めたかは [decisions.md](decisions.md) を参照。

---

## 24. 実装順

```
Phase 1  Windows Desktop 基盤 → Local 保存 → Project → Task / Kanban → Task Tree → Progress
         → Global Shortcut → Start UI → Session Timer → Pause / Resume → End / Extend
         → Current Work → Session 内 Task 操作 → Task 切替 / Segment → Event Log
         → End Review → Session 保存 → Session 編集 / 削除 → Welcome → 最低限 Today 表示
         ★ ここで必ず日常使用

Phase 2  Today View → Week View → Time Trend → Blocked → External Blocked → Follow-up
         → Hard Dependency → Recommended Order → Slack → Estimated Effort → Aging
         → Warning Escalation → Project Priority → Weekly Time Budget → Fixed Work → Task Notes

Phase 3  Outcome → Success Criteria → Outcome Validation → Task Link
         → Outcome Achievement Review → Goal 停滞検知 → Year / Month / Week Planning
         → Weekly Review → Task Planning Session

Phase 4  Habit → Habit Link → Habit Target → Rest Day → Special Event → Special Sprint

Phase 5  Artifact → Artifact Link → Personal History → Progress Visualization
         → Achievement History → Reward → Optional Badge / XP 検討

Phase 6  Default Private → 個別 Public → Similar People Discovery → Task Tree Sharing
         → Role Model Discovery → Ranking 検討 → Mentor 検討

Phase 7  Google Calendar → Windows Activity → Untracked Analysis → Reality Check
         → AI Session Integration → Smart Progress → Task Recommendation
```

現在どこまで進んでいるかは [progress.md](progress.md) を参照。

---

## 25. 最終的な設計思想（機能追加で迷ったときの判断基準）

> **目標に向かって何かをするなら、自然にこのアプリを使う。**
>
> **真の進捗を、低摩擦で記録する。**
>
> **自分が重要だと決めたことと、実際の行動の差を見えなくしない。**
>
> **ユーザーを責めない。しかし曖昧な逃避を放置しない。**
>
> **やるならやる。やらないなら、その判断も明示する。**
>
> **無駄な摩擦は消す。必要な摩擦からは逃がさない。**
>
> **タスクの粒度は人間に委ねる。**
>
> **Priority は判断材料。最終判断は人間。**
>
> **計画は未来の時間割ではなく、進む方向と資源配分を定めるために使う。**
>
> **仕事の階層と時間の階層を分離する。**
>
> **休むことも自分との約束として扱う。**
>
> **他人との比較ではなく、自分自身の絶対軸を中心にする。**
>
> **Social は比較より、学習・探索・接続を中心にする。**
>
> **現実の Progress そのものを Gamification する。**
>
> **架空ポイントではなく、Task・Outcome・Artifact が前進すること自体を楽しくする。**
>
> **Goal は大切なものとして扱い、忘れさせない。**
>
> **成功だけでなく、停滞・方針転換・やめた判断も人生の History として残す。**
>
> **最終的には、自分が何を大切にし、何を選び、何をし、何を生み出したかを、生涯失わない実行基盤にする。**
