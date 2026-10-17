# 開発ガイド

開発環境の準備、ビルド、整形・検証の手順をまとめます。機能と使い方は [README.md](README.md)、設計と依存関係は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。

## 開発環境

Node.js と npm を使用します。CI のコード品質チェックは Windows・Node.js 24 で実行しています。

```powershell
npm ci
npm run desktop:dev     # デスクトップ版を開発起動
npm run dev             # Web版を開発起動
```

## ビルド

```powershell
npm run build           # Web版をdist/へ出力
npm run preview         # ビルド済みWeb版を確認
npm run desktop:pack    # Windowsの展開版を生成
npm run desktop:build   # Windowsのインストーラーとポータブル版を生成
```

デスクトップ版の生成物は `release/` に出力されます。Windows で出力フォルダーのリネームに失敗する問題を避けるため、パッケージ化は一時フォルダーで行い、生成物を `release/` にコピーします。

## 整形と静的解析

```powershell
npm run format          # Prettierで整形
npm run format:check    # 整形差分の検査
npm run lint            # ESLint。警告も失敗として扱う
npm run lint:fix        # ESLintの自動修正
npm run check           # 整形・lint・型チェック・ビルド・単体テスト
```

Prettier はスペース2文字、JavaScript のシングルクォート、セミコロンあり、折り返し幅100文字、LF改行に統一します。生成物と `package-lock.json` は整形対象から除外します。

`.gitattributes` でテキストファイルのチェックアウト時の改行を LF に固定しています。Windows の `core.autocrlf=true` 環境でも、CI とローカルで同じ改行を使います。`.editorconfig` は編集時、Prettier は整形時の LF を指定します。

ESLint は flat config と `typescript-eslint` の型情報を使う推奨ルール、React Hooks の推奨ルールを利用します。ブラウザー・Electron/Node.js・テストの実行環境を分け、TypeScript の解析範囲は `tsconfig.eslint.json` で指定しています。Hooks のルールは例外なしで適用し、テストでは非同期 API のモックと spy の検証に合わせて一部のルールを調整しています。CI でも `npm run check` を実行します。

GitHub Pages へのデプロイは、`check.yml` の `check` ジョブが成功した後に `deploy.yml` を呼び出して実行します。対象は main への push と、main を選んだ `Check code quality` ワークフローの手動実行です。チェックが失敗・キャンセルされた場合や、プルリクエスト・main 以外のブランチではデプロイしません。

## テスト

ブラウザーテストの初回実行前に、Chromium をインストールします。

```powershell
npx playwright install chromium
```

```powershell
npm test                 # 単体・統合テスト
npm run test:typecheck   # テストコードの型チェック
npm run test:e2e         # Chromiumでの操作テスト
npm run test:desktop     # Electronでの操作テスト
npm run test:coverage    # 単体・統合テストのカバレッジ
```

操作テストは Vite を自動で起動し、テスト用ファイルを使います。Electron の操作テストは開発版と `dist/` のビルド済み画面を確認するため、先に `npm run build` を実行してください。カバレッジ表示には Chromium・Electron の操作テストは含まれません。

Provider の状態分離・起動終了の再実行・古いサムネイル結果の破棄は単体テスト、実際のスクロール・ナビゲーション・設定保存は操作テストで確認します。

## 変更時の確認

- 実装を変更したら `npm run check` を実行します。画面操作・スクロール・ナビゲーションなどに影響する変更はブラウザーの操作テスト、デスクトップ固有の変更は Electron の操作テストも実行します。
- ドキュメントのみの変更では `npm run format:check` と、リンク先・記載コマンドの確認を行います。
- 機能・使い方の変更は README、責務・依存関係の変更は ARCHITECTURE、開発手順の変更はこの文書へ反映します。
