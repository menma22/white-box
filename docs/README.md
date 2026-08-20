# 文書の地図

読む順に並べてある。目的から引くなら下の表を使う。

| # | 文書 | 何が書いてあるか |
| --- | --- | --- |
| 1 | [product-spec.md](product-spec.md) | **マスター文書。** 何を作るのか、なぜそう作るのか、どの順で作るのか。機能追加で迷ったらここへ戻る |
| 2 | [progress.md](progress.md) | **現在地。** どこまで実装したか、次に何をするか、実使用で出た課題。状態が変わったら更新する |
| 3 | [architecture.md](architecture.md) | 実装の構成。どこに何があり、なぜそう分けたか |
| 4 | [design-language.md](design-language.md) | 見た目の決まり。色・形・書体・時間の見せ方・言葉づかい |
| 5 | [verification.md](verification.md) | 何をどう検証するか。**検証器そのものが嘘をつく落とし穴**も含む |
| 6 | [packaging.md](packaging.md) | 配布物の作り方と、デスクトップ・タスクバーへの置き方 |
| 7 | [decisions.md](decisions.md) | 決めたことと、**採らなかった選択肢** |

使い方は [ルートの README](../README.md)、コードを触る前の前提は [CLAUDE.local.md](../CLAUDE.local.md)。

---

## 目的から引く

| こうしたい | 見る文書 |
| --- | --- |
| この機能を入れるべきか判断したい | product-spec.md §25 の判断基準 |
| 今どこまで進んでいるか知りたい | progress.md |
| 使っていて困ったことを残したい | progress.md の「実使用で出た課題」 |
| コードのどこを触ればいいか知りたい | architecture.md |
| 画面を作る・色を足す | design-language.md |
| 変更が壊れていないか確かめたい | verification.md |
| 新しいバージョンを配りたい | packaging.md |
| 「なぜこうなっているのか」を知りたい | decisions.md → 無ければ architecture.md |

## 書くときの決まり

- **仕様が変わったら product-spec.md を直す。** 他の文書に書き足して済ませない
- **判断したら decisions.md に1件足す。** 採らなかった選択肢も書く
- **同じことを2箇所に書かない。** 片方が必ず腐る。リンクで繋ぐ
- **腐りやすい数字（件数・サイズ・所要時間）は書かない。** 測り方を書く
