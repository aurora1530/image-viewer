# ローカル画像ビューワー

ローカルのフォルダから画像を高速で閲覧できるWebアプリケーションです。

## 機能

- **フォルダ選択**: File System Access APIを使用してローカルフォルダを直接選択
- **画像表示**: JPG、PNG、GIF、WebP、BMPなどの画像形式をサポート
- **動画再生**: MP4、WebM、MOV、OGGなどの動画形式をサポート
- **見開き表示**: 単一表示と見開き表示の切り替え
- **サムネイル表示**: 4段階のサムネイルサイズ調整
- **サムネイル設定保存**: 選択したサムネイルサイズを次回起動時も保持
- **ソート機能**: ファイル名の昇順・降順ソート
- **キャッシュ機能**: 一度読み込んだフォルダの内容を保持し、ソート変更時の再読み込みを高速化
- **再帰一覧**: サブディレクトリを含めて全画像を表示
- **検索フィルタ**: ディレクトリ名・ファイル名での部分一致検索
- **キーボード操作**: 矢印キーでのページ送り、Escキーでの終了
- **全画面表示**: フルスクリーン表示に対応
- **フォルダ階層**: 上の階層への移動とパスのコピー

## 使用方法

1. ブラウザで `index.html` を開きます
2. 「ルートフォルダを選択」ボタンをクリックしてフォルダを選択
3. 画像やフォルダのサムネイルをクリックして閲覧を開始
4. 必要に応じて「全画像一覧」ボタンを押すと、サブディレクトリも含めた画像を確認ダイアログ後にまとめて表示できます

## デスクトップ(Electron)版

`desktop` ディレクトリに Electron 版を同梱しています。ブラウザ版と同等機能を Windows 11 上でスタンドアロン実行できます。

### 前提条件

- Node.js (推奨: LTS 最新)

### セットアップ & 起動

```bash
cd desktop
npm install
npm run dev  # 開発モード (DevTools 有効化オプション付きで起動したい場合は main.js で openDevTools コメント解除)
```

または通常起動:

```bash
npm start
```

### パッケージング (簡易)

`electron-packager` を利用:

```bash
npm run pack
```

`dist/image-viewer-win32-x64/` 配下に実行ファイルが生成されます。

### ビルド (installer など)

`electron-builder` を利用した高度なビルド:

```bash
npm run dist
```

設定をカスタムしたい場合は `desktop/package.json` に `build` セクションを追加してください。

### ブラウザ版との違い

- File System Access API の代わりに `dialog.showOpenDialog` + Node.js FS を preload 経由でラップ
- それ以外の UI / 操作はほぼ同一

### 既知の注意点

- 大量ファイル読み込み時は初回走査がブラウザ版より速い/遅い環境差が出る場合があります (SSD 推奨)
- HEIC の MIME 判定は簡易的です。必要に応じて heic 変換ライブラリ導入を検討してください。

### キーボード操作

- `←` / `→`: ページ送り（右から左へ読み進め）
- `Escape`: ビューワーを閉じる
- `Alt + ←`: 上の階層に戻る

## 対応ブラウザ

- Google Chrome（推奨）
- Microsoft Edge
- その他のChromium系ブラウザ

※ File System Access APIが必要なため、Firefox、Safariなどは非対応です。

## 技術仕様

- HTML5 + CSS3 + JavaScript（ES6+）
- Tailwind CSS（CDN版）
- File System Access API
- スタイルシート(`style.css`)とスクリプト(`script.js`)を分割

- レスポンシブデザイン対応

## ライセンス

MIT License
