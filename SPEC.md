# アプリケーション仕様書

## 概要

このリポジトリに含まれる「ローカル画像ビューワー」は、ブラウザ上でローカルフォルダ内の画像・動画を高速に閲覧するためのシングルページアプリケーションです。File System Access API を利用するため、Chrome などの Chromium 系ブラウザでの利用が想定されています。

## 画面構成

- **index.html** にアプリの UI が定義されています。
- Tailwind CSS CDN を利用し、レスポンシブデザインに対応。
- 主な要素は次の通り。
  - ルートフォルダ選択ボタン (`select-dir-btn`)
  - 上の階層へ戻るボタン (`up-dir-btn`)
  - 現在のフォルダ名表示 (`current-dir-name`)
  - パスコピーボタン (`copy-path-btn`)
  - 一覧表示領域 (`item-list`)
  - 一覧用ツールバー (`list-toolbar`)
    - サムネイルサイズ選択 (`size-select`)
    - 種別フィルタ (`filter-select`)
    - 検索ボックス (`search-input`)
    - ソート切り替え (`toggle-sort-btn`)
    - 再読み込み (`reload-btn`)
    - 全画像一覧表示 (`recursive-btn`)
  - ビューワー (`viewer`)
    - 画像表示領域 (`viewer-pages` 内に左右ページ用コンテナ)
    - 動画プレーヤー (`viewer-video-container`)
    - ビューワーツールバー (`viewer-toolbar`)
      - 前へ/次へボタン、単一表示切替、見開き調整、ページ番号表示、全画面、画像パスコピー、閉じる など

## 対応ファイル形式

- 画像: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`
- 動画: `.mp4`, `.webm`, `.mov`, `.ogg`

## 機能詳細

### フォルダ選択と履歴管理

1. `select-dir-btn` クリックで `window.showDirectoryPicker()` を実行し、ユーザーにディレクトリ選択を促す。
2. 選択したディレクトリは `directoryHistory` 配列に格納し、現在位置を管理。
3. `up-dir-btn` で `directoryHistory` を一つ戻り、親ディレクトリを表示。
4. `copy-path-btn` により、履歴から構成したパス文字列をクリップボードへコピー。

### 一覧表示 (`processDirectory`)

- ディレクトリ内のエントリを走査し、画像・動画・サブディレクトリを取得。
- 結果はキャッシュ (`cachedItems`) に保存。ソート変更時などに再利用。
- アイテムは `sortOrder` (asc/desc) に基づき名前順に並べ替え。
- フィルタ (`filterType`) と検索文字列 (`searchQuery`) を適用し、表示対象を決定。
- サムネイルサイズは `thumbnailSizeIndex` により変更可能。値は `localStorage` に保存。
- アイテム数が多い場合は IntersectionObserver を用いた遅延読み込みを行う。

### アイテムカード (`createItemCard`)

- 画像・動画の場合はサムネイルを表示。動画には再生アイコンを重ねる。
- ディレクトリの場合、直接下の画像を1枚サムネイルとして利用。無い場合は下層ディレクトリを探索して取得を試みる。
- ディレクトリカードには「開く」ボタンを表示し、そのフォルダ内の画像ビューを直接開ける。

### 画像ビューワー

- `openViewer(dirHandle, startIndex)` で指定ディレクトリの画像一覧を取得し、ビューワーを表示。
- 見開き表示/単一表示の切り替えが可能。状態は `localStorage` に保存。
- ページ送りは右から左へ進む仕様。キーボード矢印キーや `prev/next` ボタンで操作。
- `adjustSpread-btn` により見開きの左右ページを入れ替え。
- `fullscreen-btn` でフルスクリーンモードに入ると、マウス停止後2秒でツールバーを自動非表示。
- `copy-image-path-btn` で表示中画像のフルパスをクリップボードへコピー。
- ESC キーまたは `close-viewer-btn` でビューワー終了。全画面時は解除。
- 画像表示では Object URL を利用し、不要になったら `URL.revokeObjectURL` で解放。

### 動画再生

- 画像一覧から動画サムネイルをクリックすると `openVideoPlayer` を実行し、`<video>` 要素で再生。
- 再生中はビューワーツールバーを非表示にし、閉じると Object URL を解放。

### 再帰的表示

- `recursive-btn` クリックで現在ディレクトリ以下の全画像を走査し一覧表示。操作時には確認ダイアログを表示。
- 戻るボタンとしても機能し、通常表示に切り替える。

### その他

- 検索ボックスに文字を入力すると部分一致でアイテムを絞り込み。
- `reload-btn` でディレクトリ・画像キャッシュと外部で変更された設定を再取得。
- `Alt + ←` でビューワー閉鎖または上位ディレクトリへ戻るショートカット。
- Object URL はカードのアンマウント、画像の置き換え、キャッシュの破棄時に所有者が解放。遅れて完了した読み込みも不要になった URL を解放。

## ファイル構成

- `index.html`・`src/main.tsx` – React の起動とアプリのライフサイクル管理。
- `src/App.tsx`・`src/Gallery.tsx`・`src/ViewerPanel.tsx` – ホーム、ツールバー、一覧カード、画像・動画ビューワー。
- `src/appStore.ts` – Zustand の共有状態。一覧モードとお気に入り表示方式はそれぞれ一つの値で管理。
- `src/application.ts` – 画面操作、履歴復元、設定保存と各処理の調整。
- `src/directoryViews.ts` – データ取得と一覧の検索・絞り込み・表示順。古い読み込み結果の破棄。
- `src/virtualGallery.ts` – 仮想スクロールの配置計算。カードの内容は React が描画。
- `src/style.css` – ローカルのスタイルとユーティリティ。外部 CDN への依存はない。
- 画像キャッシュ、Worker、ファイルアクセス、設定保存は独立した TypeScript モジュールとして保持。
- `README.md` – 日本語による簡易説明と機能一覧。

## 動作環境

- File System Access API が利用可能な Chromium 系ブラウザ（Chrome, Edge 等）
- Web 版は Vite で起動・ビルド。Electron 版はビルド済みの画面をローカルで読み込み、外部サーバなしで動作。

## ライセンス

- MIT License
