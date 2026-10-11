# Googleカレンダー連携の設定 v1

版: v1 / 2026-10-12。White BoxのGoogleカレンダー機能を接続するための手順。

## 初回設定

Googleアカウントへのアクセス許可は、自分のブラウザで行う。GoogleのパスワードをWhite Boxへ入力する必要はない。

1. [Google Cloud Console](https://console.cloud.google.com/)で、この連携用のプロジェクトを選ぶか作成する。
2. [APIライブラリ](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)で **Google Calendar API** を有効にする。
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview)でアプリ名と連絡先を設定する。個人のGoogleアカウントを使う場合は外部向けのAudienceを選び、Testingの間は自分のアカウントをテストユーザーへ追加する。
4. ClientsでOAuthクライアントを作り、種類を **Desktop app（デスクトップアプリ）** にする。Web application用のクライアントを使わない。
5. White Boxの **設定 → Googleカレンダー** でClient IDとClient secretを入力して保存する。この2つはGoogle側で作成したクライアントの設定値で、Googleアカウントのパスワードではない。
6. **Googleアカウントを接続** から通常のブラウザを開き、使いたいGoogleアカウントを選んでアクセスを許可する。認証後はWhite Boxへ戻る。
7. 表示したいカレンダーを選ぶ。Googleへの予定追加は、書込権限のあるカレンダーを選んで実行する。

必要なアクセス範囲は、アカウントの表示、購読カレンダー一覧の読取、カレンダー予定の読取・作成。Google側の権限画面は予定の編集・削除も含む表現になるが、この機能は既存のGoogle予定を編集・削除しない。[Googleのアクセス範囲一覧](https://developers.google.com/workspace/calendar/api/auth)

## 日々の使い方

週画面と今日の予定欄でGoogleの予定を確認できる。Google予定を作業の実績時間へ加算することはない。予定追加時は、保存先がWhite BoxかGoogleかを確認する。

アプリを終了している間は同期処理も停止する。次の起動時に再取得する。通信できない間は取得済みの予定を表示し、最終同期とエラーを確認できる。再試行で接続が回復すれば表示も更新される。

連携解除はWhite Box側の接続を停止する。Googleの予定は消えない。Googleアカウント側の許可も取り消したい場合は、[Googleアカウントの接続管理](https://myaccount.google.com/connections)からWhite Box用クライアントのアクセスを解除する。

## 接続できないとき

- `access_denied`: Google側でキャンセルしたか、テストユーザーに登録されていない可能性がある。使っているアカウントとAudienceの設定を確認する。
- `redirect_uri_mismatch`: Desktop app用のクライアントであることを確認する。認証にはアプリがその都度起動するloopbackのポートを使う。
- 権限不足・API無効: Google Calendar APIが有効か、認証時に予定への許可を与えたかを確認する。
- 更新許可が失効した場合は、再接続してアクセスを許可する。**外部向けアプリがTesting状態の場合、今回のCalendar権限を含む更新トークンは7日で失効する**。長期運用する場合はGoogle側のAudienceと公開・検証条件を確認する。Productionへの変更だけで全アプリの検証要件がなくなるわけではない。[GoogleのAudience仕様](https://support.google.com/cloud/answer/15549945?hl=en)

ローカル認証の方式と前提は、[GoogleのデスクトップOAuth仕様](https://developers.google.com/identity/protocols/oauth2/native-app)を参照。
