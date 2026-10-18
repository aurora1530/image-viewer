# 開発ガイド

開発環境の準備、ビルド、整形・検証の手順をまとめます。機能と使い方は [README.md](README.md)、設計と依存関係は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。

## 開発環境

Node.js 24 と npm を使用します。CI のコード品質チェックも Windows・Node.js 24 で実行しています。

```powershell
npm ci
npm run desktop:dev     # デスクトップ版を開発起動
npm run dev             # Web版を開発起動
```

`npm ci` の `prepare` スクリプトで Husky の Git フックを有効にします。既に依存関係をインストール済みの場合も、フック導入後に一度 `npm ci` を実行してください。

## ビルド

```powershell
npm run build           # Web版をdist/へ出力
npm run preview         # ビルド済みWeb版を確認
npm run desktop:pack    # Windowsの展開版を生成
npm run desktop:build   # Windowsのインストーラーとポータブル版を生成
```

デスクトップ版の生成物は、ビルドごとに新しい `release/builds/<日時と識別子>/` に出力されます。Windows x64を対象とし、その中に展開版の `win-unpacked/` と、バージョンを含まない `image-viewer-windows-x64-setup.exe`・`image-viewer-windows-x64-portable.exe` を生成します。完了時に出力先と実行ファイルのパスを表示します。`npm run desktop:smoke` は最新の完成済みビルドを自動で選びます。

パッケージ化は毎回新しい一時フォルダーで行い、生成物も新しい保存先へコピーします。過去の展開版・インストーラーは削除・上書きしないため、VS Codeや前回のアプリが `app.asar` を開いていてもビルドできます。以前の `release/win-unpacked/` や `release/` 直下のインストーラーは更新しません。過去の生成物は自動削除しないため、不要になったビルドのフォルダーは後で削除してください。バージョン更新やGitHubへのアップロードは行いません。

正式リリース用の `--release` では、CIのアップロードに必要な配布ファイルを従来どおり `release/` 直下にもコピーします。これは新規チェックアウトで動くReleaseワークフロー向けの動作です。

## リリース

GitHub Actions の `Release` をmainで手動実行し、`patch`（修正）・`minor`（互換性のある機能追加）・`major`（互換性を壊す変更）を選びます。GitHub CLIをインストールして `gh auth login` 済みなら、ローカルから同じ処理を開始できます。

```powershell
npm run release -- patch
npm run release -- minor
npm run release -- major
```

初回の1.0.0だけは `npm run release -- initial`、またはActionsで `initial` を選びます。バージョンを増やすコミットは作成せず、その時点のリモートmainに `v1.0.0` タグを付けます。バージョン付きタグが既に存在する場合や、packageとlockfileが1.0.0で一致しない場合は拒否します。初回公開後は通常の `patch`・`minor`・`major` を使ってください。

このコマンドはローカルの変更を送信せず、リモートmainをリリースします。必要な変更は先にPRをマージしてください。`package.json`とlockfileのバージョン更新コミット・`vX.Y.Z`タグを作成し、そのコミットを固定して検証します。`prepare` ジョブだけは専用GitHub Appのトークンでmainとタグを直接pushし、PR必須・check必須のrulesetをbypassします。以降の検証・公開・配信は通常の `GITHUB_TOKEN` を使用します。追加のPATや有料の署名サービスは使用しません。

Windowsの検証後、Windows x64のNSISインストーラー・Portable版と、macOS arm64/x64それぞれのDMG・ZIPを生成します。全ビルドが成功してからGitHub Releaseを公開し、同じコミットから生成・検証済みのWeb成果物をPagesへ配信します。Releaseのファイル名にはバージョンを含め、Windowsの更新用 `latest.yml` と `.blockmap` も添付します。

失敗した場合は新規実行ではなく、その実行の `Re-run all jobs` を使うと同じタグ・バージョンで再試行できます。実行IDをタグに記録しているため、mainが進んでいても同じソースを利用します。公開済みReleaseのファイルは再アップロードせず、新しい正式版がある場合は古い版の再公開・Web配信を拒否します。Release公開とPages配信は別処理なので、Pagesだけ失敗した場合も再実行してください。

GitHub PagesのSourceは `GitHub Actions` に設定してください。デスクトップの自動更新はpublicリポジトリのGitHub Releasesを参照します。アプリにGitHubトークンは同梱しません。標準のGitHub-hosted runnersを使い、privateリポジトリではActionsの無料枠・利用上限を確認してください。

Windowsは未署名のためSmartScreenの警告が出る場合があります。macOSは無料のad-hoc署名でビルドし、公証・自動更新は行いません。OSのセキュリティ設定によって初回起動時の許可操作が必要です。証明書の購入やApple Developer Programへの登録は不要です。

### アプリ側のバージョン表示と更新

ヘッダーのバージョンをクリックすると、その版のGitHub Releaseを開きます。設定の「バージョンと更新」から、最新リリースのダウンロードと更新状態を確認できます。

Web版は起動時・10分ごとに配信バージョンを確認し、新版があるとヘッダーに「更新あり（設定）」を表示します。設定の「再読み込みして更新」で切り替えます。

Windowsのインストール版は起動時・4時間ごと・設定の「更新を確認」でGitHub Releasesの新版を確認します。バックグラウンドでダウンロード後、「再起動して更新」で設定の保存を完了してから更新します。保存に失敗した場合は更新せず、アプリを開いたままにします。ネットワークに接続できなくても通常の閲覧は続けられます。

Windows Portable版・展開版・開発起動、およびmacOS版は手動更新です。最新リリースからダウンロードして置き換えます。

## 整形と静的解析

```powershell
npm run format          # Prettierで整形
npm run format:check    # 整形差分の検査
npm run lint            # ESLint。警告も失敗として扱う
npm run lint:fix        # ESLintの自動修正
npm run check           # 整形・lint・型チェック・ビルド・単体テスト
npm run check:staged    # コミット対象の自動整形とlint
```

Prettier はスペース2文字、JavaScript のシングルクォート、セミコロンあり、折り返し幅100文字、LF改行に統一します。生成物と `package-lock.json` は整形対象から除外します。

`.gitattributes` でテキストファイルのチェックアウト時の改行を LF に固定しています。Windows の `core.autocrlf=true` 環境でも、CI とローカルで同じ改行を使います。`.editorconfig` は編集時、Prettier は整形時の LF を指定します。

`git commit` 時は Husky の `pre-commit` フックから lint-staged を実行します。ステージ済みの JavaScript・TypeScript を Prettier で自動整形し、ESLint で検証します。JSON・CSS・HTML・Markdown・YAML などは整形だけを行います。成功すると整形結果もコミットに含まれ、失敗するとコミットを中止します。`.codex/rules/default.rules` など対象外のファイルや、削除だけのコミットでは整形・lint を実行しません。型チェック・ビルド・テストを含む全件チェックはコミット時には実行せず、CI の `npm run check` で行います。

チェック中は未ステージの変更と未追跡ファイルを一時退避し、終了後に復元します。一部の行だけをステージしたファイルも、コミット対象の内容で整形・検証します。チェック失敗時は整形前の状態へ戻します。フックを無効にした場合や実行環境の違いによる失敗も検出できるよう、CI のチェックは継続します。

ESLint は flat config と `typescript-eslint` の型情報を使う推奨ルール、React Hooks の推奨ルールを利用します。ブラウザー・Electron/Node.js・テストの実行環境を分け、TypeScript の解析範囲は `tsconfig.eslint.json` で指定しています。Hooks のルールは例外なしで適用し、テストでは非同期 API のモックと spy の検証に合わせて一部のルールを調整しています。CI でも `npm run check` を実行します。

main以外のブランチへのpush・プルリクエストでは `check.yml` の検証だけを実行します。PRの必須チェックで検証するため、マージ後のmainへのpushでは `check.yml` を実行しません。手動実行とリリース時の検証は引き続き利用できます。GitHub Pagesへの配信は `release.yml` から `deploy.yml` を呼び出したときだけ行い、mainへのpushではWeb版は更新しません。

## テスト

ブラウザーテストの初回実行前に、Chromium をインストールします。

```powershell
npx playwright install chromium
```

```powershell
npm test                 # 単体・統合テスト
npm run test:release      # バージョン更新・タグ再利用のローカルGitテスト
npm run test:desktop-build # 出力先の分離・Windowsでのファイルロック回帰テスト
npm run test:typecheck   # テストコードの型チェック
npm run test:e2e         # Chromiumでの操作テスト
npm run test:desktop     # Electronでの操作テスト
npm run test:coverage    # 単体・統合テストのカバレッジ
```

操作テストは Vite を自動で起動し、テスト用ファイルを使います。Electron の操作テストは開発版と `dist/` のビルド済み画面を確認するため、先に `npm run build` を実行してください。カバレッジ表示には Chromium・Electron の操作テストは含まれません。

単体・統合テストは Vitest の `pool: 'vmThreads'` を使用します。ファイルごとに独立した VM コンテキストと `window` を保ちながら、jsdom 環境の作成コストを抑えます。

CIの操作テストは失敗時にブラウザーのワーカーを作り直して1回だけ再試行します。再試行でも失敗した場合はリリースを停止します。失敗した試行のトレース・スクリーンショットは `test-results/` に保存し、Releaseワークフローの `verify-browser-diagnostics-<実行回数>`・`verify-desktop-diagnostics-<実行回数>` アーティファクトから7日間取得できます。次のテスト実行が結果を上書きする前に、各プロジェクトの診断を個別に保存します。ローカルでは自動再試行しません。

Provider の状態分離・起動終了の再実行・古いサムネイル結果の破棄は単体テスト、実際のスクロール・ナビゲーション・設定保存は操作テストで確認します。

## 変更時の確認

- 実装を変更したら `npm run check` を実行します。画面操作・スクロール・ナビゲーションなどに影響する変更はブラウザーの操作テスト、デスクトップ固有の変更は Electron の操作テストも実行します。
- ドキュメントのみの変更では `npm run format:check` と、リンク先・記載コマンドの確認を行います。
- 機能・使い方の変更は README、責務・依存関係の変更は ARCHITECTURE、開発手順の変更はこの文書へ反映します。
