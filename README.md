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
