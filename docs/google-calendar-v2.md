# Googleカレンダー連携の設定 v2

版: v2 / 2026-10-12。前版: [v1](google-calendar-v1.md)。画面のボタン名、同期間隔、取得済み予定の保持範囲、ログイン中止の説明を実装に合わせた。

## 初回設定

Googleアカウントへのアクセス許可は、自分のブラウザで行う。GoogleのパスワードをWhite Boxへ入力する必要はない。

1. [Google Cloud Console](https://console.cloud.google.com/)で、この連携用のプロジェクトを選ぶか作成する。
2. [APIライブラリ](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)で **Google Calendar API** を有効にする。
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview)でアプリ名と連絡先を設定する。個人のGoogleアカウントを使う場合は外部向けのAudienceを選び、Testingの間は自分をテストユーザーへ追加する。
4. ClientsでOAuthクライアントを作り、種類を **Desktop app（デスクトップアプリ）** にする。
5. White Boxの **設定 → Google カレンダー** でClient IDとClient secretを入力し、**接続設定を保存** を押す。この2つはGoogle側のクライアント設定値で、Googleアカウントのパスワードではない。
6. **Google に接続** から通常のブラウザを開き、使いたいアカウントを選んでアクセスを許可する。認証後はWhite Boxへ戻る。待機をやめるときは **ログインを中止** を押す。
7. **表示するカレンダー** で対象を選ぶ。Googleへの予定追加は、書込権限のあるカレンダーへ保存する。

必要なアクセス範囲は、アカウントの表示、購読カレンダー一覧の読取、予定の読取・作成。Google側の権限画面は予定の編集・削除も含む表現になるが、この機能は既存のGoogle予定を編集・削除しない。[Googleのアクセス範囲一覧](https://developers.google.com/workspace/calendar/api/auth)

## 日々の使い方

週画面と今日のGoogle予定欄に、時刻付き・終日・繰返しの予定が表示される。Google予定は作業の実績時間へ加算しない。追加するときは **Google に予定をつくる** から保存先・タイトル・開始・終了を指定し、**Google に保存** を押す。繰返し・終日の新規登録はGoogle側で行う。

アプリ起動中は約3分ごと、表示期間の変更時、スリープからの復帰時に取得する。**再同期** でも更新できる。取得対象は最後に表示した期間で、全履歴を端末へ複製する機能ではない。

通信に失敗した場合、その起動中に取得した予定を残し、最終同期とエラーを表示する。取得済み予定はメモリ内に保持するため、終了後には残らない。次の起動時に再取得する。アプリ終了中の同期は停止する。

保存時の通信が途切れると、Google側には作成済みの場合がある。入力を残した **同じ予定を再試行** で結果を確認できる。同じ入力の再試行は同じ予定IDを使う。入力を破棄して別の予定として作り直すと、重複する可能性がある。

**この端末の接続を解除** はWhite Box側の接続を停止する。Googleの予定は消えない。Googleアカウント側の許可も取り消す場合は、[Googleアカウントの接続管理](https://myaccount.google.com/connections)からこの連携用クライアントのアクセスを解除する。

接続設定と更新トークンはOSの資格情報保護を使って暗号化し、通常の作業記録DBとは別に保存する。画面には保存済みの秘密情報を戻さない。OSの安全な保存機能を使えない場合は接続設定を保存しない。

## 接続できないとき

- 認証が許可されない場合は、ブラウザ側でのキャンセル、使っているアカウント、Audienceのテストユーザー設定を確認する。
- `redirect_uri_mismatch` がブラウザに表示された場合は、Desktop app用のクライアントであることを確認する。認証にはアプリがその都度起動するloopbackのポートを使う。
- 権限不足・API無効の場合は、Google Calendar APIが有効か、認証時に予定への許可を与えたかを確認する。
- 更新許可が失効した場合は、接続を解除して **Google に接続** から再認証する。**外部向けアプリがTesting状態の場合、今回のCalendar権限を含む更新トークンは7日で失効する**。長期運用する場合はGoogle側のAudienceと公開・検証条件を確認する。Productionへの変更だけで全アプリの検証要件がなくなるわけではない。[GoogleのAudience仕様](https://support.google.com/cloud/answer/15549945?hl=en)

ローカル認証の方式と前提は、[GoogleのデスクトップOAuth仕様](https://developers.google.com/identity/protocols/oauth2/native-app)を参照。
