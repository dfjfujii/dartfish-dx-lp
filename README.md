# Dartfish DX・SSH向けランディングページ

GitHub + Cloudflare Pagesで公開するための静的Webサイトです。
HTML、CSS、JavaScriptのみで動作し、外部ライブラリは使用していません。

## ファイル構成

```text
dartfish-dx-lp/
├── index.html
├── css/style.css
├── js/script.js
├── images/
├── robots.txt
├── _headers
└── README.md
```

## GitHubへのアップロード

1. ZIPを解凍します。
2. GitHubの `dartfish-dx-lp` リポジトリを開きます。
3. `uploading an existing file` をクリックします。
4. 解凍したフォルダの「中身」をすべてドラッグ＆ドロップします。
5. 画面下の `Commit changes` をクリックします。

※ `dartfish-dx-lp` フォルダそのものではなく、`index.html` がリポジトリの一番上に見える状態でアップロードしてください。

## 画像の差し替え

画像ファイルを、同じファイル名で上書きするとHTMLを変更せずに差し替えできます。
推奨形式はWebPです。

| 表示箇所 | ファイル名 |
|---|---|
| ファーストビュー | `images/hero-classroom.webp` |
| ファーストビューの分析画面 | `images/product-tagging.webp` |
| 学習の流れ：データ収集 | `images/flow-collect.webp` |
| 学習の流れ：分析と測定 | `images/flow-analyze.webp` |
| 学習の流れ：可視化 | `images/flow-visualize.webp` |
| 学習の流れ：考察・発表 | `images/flow-present.webp` |
| 比較合成 | `images/feature-compare.webp` |
| 角度・距離・速度の測定 | `images/feature-measure.webp` |
| プレイリストと統計 | `images/feature-playlist.webp` |
| 3Dアナライザー | `images/feature-3d.webp` |
| DXハイスクール活用 | `images/dx-use.webp` |
| SSH活用 | `images/ssh-use.webp` |
| 導入支援 | `images/support-classroom.webp` |

画像を同じ名前で置き換えたあと、GitHubで `Commit changes` を押すと、Cloudflare Pagesへ自動反映されます。

## CTAリンク

「資料を請求する」「活用方法を相談する」は、次のURLに設定しています。

`https://www.dartfish.co.jp/contactus/?dfbpv=1`

変更する場合は、`index.html` 内のこのURLを検索して一括置換してください。

## 注意

- `images/feature-3d.webp` は、実画面を入手するまでの機能イメージです。正式な製品画面への差し替えを推奨します。
- 公開前に、使用画像の権利・掲載許可をご確認ください。

## 教育・学校向け問い合わせフォーム

LP内のフォームは `functions/api/contact.js`（Cloudflare Pages Functions）で処理します。
通知先や差出人名はコードへ固定せず、Cloudflare Pagesの環境変数で変更できます。

### 必要な環境変数

Cloudflareダッシュボードの対象Pagesプロジェクトで、次の値をProductionへ設定します。

| 変数名 | 用途 | 初期値・設定例 |
|---|---|---|
| `CONTACT_TO_EMAIL` | 管理者通知の送信先 | `school@dartfish.co.jp` |
| `CONTACT_FROM_EMAIL` | 管理者通知の送信元 | `school@dartfish.co.jp` |
| `CONTACT_FROM_NAME` | メールに表示する差出人名 | `ダートフィッシュ・ジャパン 教育・学校向け窓口` |
| `TURNSTILE_SITE_KEY` | Turnstileの公開サイトキー | Cloudflareで発行した値 |
| `TURNSTILE_SECRET_KEY` | Turnstileの秘密キー | Cloudflareで発行した値（暗号化推奨） |
| `HETEML_MAIL_RELAY_URL` | hetemlメール中継のURL | `https://www.dartfish.co.jp/dx-school-contact/relay.php` |
| `HETEML_MAIL_RELAY_SECRET` | Cloudflareと中継処理だけが共有する署名キー | 32文字以上のランダム値（Secretとして保存） |
| `TEAMS_WEBHOOK_URL` | Teams専用チャンネルへの通知先 | Teams Workflowsで発行したURL（Secretとして保存） |

初回設定では上表の値をCloudflareへ登録してください。メールアドレスを将来変更するときは、コードを編集せず環境変数だけ変更して再デプロイします。

### KV（連続送信・重複送信対策）

1. CloudflareでKV名前空間を1つ作成します（例：`dartfish-contact-rate-limit`）。
2. PagesプロジェクトのBindingsで、変数名 `CONTACT_RATE_LIMIT_KV` として接続します。
3. ProductionとPreviewの両方でテストする場合は、それぞれにBindingを設定します。

同じ送信元から10分間に3回を超える送信と、同じメールアドレス・学校名・本文による1時間以内の重複送信を拒否します。

### Turnstile

1. Cloudflare Turnstileでウィジェットを作成します。
2. 許可するホスト名に本番のPagesドメインと独自ドメインを登録します。
3. サイトキーを `TURNSTILE_SITE_KEY`、秘密キーを `TURNSTILE_SECRET_KEY` に設定します。

画面表示だけでなく、Pages FunctionがCloudflareのSiteverify APIで毎回検証します。

### メール送信（heteml）

1. hetemlの `/web/dartfish.co.jp/dx-school-contact/relay.php` にメール中継処理を配置します。
2. 公開フォルダ外の `/web/.dartfish-contact-relay.php` に署名キーを保存します。
3. 同じ署名キーをCloudflareの `HETEML_MAIL_RELAY_SECRET` にSecretとして設定します。
4. `HETEML_MAIL_RELAY_URL` に中継処理のHTTPS URLを設定します。

Pages Functionはメール本文を署名付きで中継処理へ渡します。中継処理は署名の有効期限、送信元ドメイン、管理者通知の送信先、二重送信を再検証してから、hetemlのsendmailで送信します。

管理者通知のReply-Toには問い合わせ者のメールアドレスを設定します。問い合わせ者への自動返信は行わず、送信完了はブラウザの完了画面で案内します。

### Teams通知

Teamsの「教育・学校向けお問い合わせ」チャンネルへ、管理者通知と同じ問い合わせ内容を投稿します。
Teams Workflowsで発行したWebhook URLを、Cloudflareの `TEAMS_WEBHOOK_URL` にSecretとして設定します。

Teams通知は補助通知として扱います。Teams側が一時的に停止していても、管理者メールの送信とフォームの完了画面は正常に動作します。

### 実装済みの迷惑送信対策

- Turnstileのサーバー側検証（トークン期限・再利用対策を含む）
- 人には見えないハニーポット
- ページ表示から3秒未満、または2時間超の送信拒否
- IP単位の短時間連続送信制限
- 同一内容の重複送信制限
- 本文等にURLが3件以上含まれる投稿の拒否
- 必須項目、文字数、メール形式のサーバー側再検証
- メール本文のHTMLエスケープ
- Cloudflareとheteml間のHMAC署名検証（5分で期限切れ）
- heteml側の送信元ドメイン・管理者送信先制限
- heteml側の24時間二重送信防止
- APIキーと秘密キーをGitHubへ保存しない構成

### 公開前の確認

Cloudflareの環境変数・KVとhetemlメール中継を設定してから、実際のメールアドレスで次を確認します。

1. フォーム送信後に完了画面へ移動する。
2. `CONTACT_TO_EMAIL` に管理者通知が届く。
3. 問い合わせ者への自動返信が送られない。
4. 同じ内容を再送すると拒否される。
5. 短時間に4回送信すると4回目が拒否される。
