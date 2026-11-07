# 開発ガイド

## 開発・ビルド

Node.js 24とnpmを使用します。`npm ci`で依存関係とHuskyのGitフックを導入します。

```powershell
npm ci
npm run desktop:dev     # Electron版を起動
npm run dev             # Web版を起動
npm run build           # Web版をdist/へ出力
npm run preview         # ビルド済みWeb版を確認
npm run desktop:pack    # Windows x64の展開版
npm run desktop:build   # Windows x64のインストーラー・Portable版
npm run desktop:smoke   # 最新の完成済みビルドを確認
```

デスクトップの出力先は毎回新しい`release/builds/<日時と識別子>/`です。過去の生成物は上書き・自動削除しません。正式リリースの`--release`では配布ファイルを`release/`直下にもコピーします。

アイコンの変更は[生成手順](design/app-icon/README.md)を参照してください。通常のビルドにPythonは不要です。

## 整形・検証

```powershell
npm run format           # Prettierで整形
npm run format:check     # 整形差分を検査
npm run lint             # ESLint（警告も失敗）
npm run lint:fix         # ESLintの自動修正
npm run check            # 整形・lint・型検査・ビルド・単体/配布関連テスト
npm run check:staged     # ステージ済みファイルの整形・lint
```

整形規則はPrettier、改行はLFです。コミット時はHuskyから`check:staged`を実行し、整形結果を含めます。失敗時はコミットを中止します。未ステージ変更は一時退避・復元し、全件検証はCIの`check`で行います。

型安全性の規則は[AGENTS.md](AGENTS.md)に従います。`test:type-policy`は`check`にも含まれます。依存型の宣言衝突を避けるため`skipLibCheck`を使用しています。

### テスト

操作テストの初回実行前に`npx playwright install chromium`を実行してください。

```powershell
npm test                  # 単体・統合
npm run test:release      # リリース候補・公開・巻き戻し
npm run test:desktop-build # 出力先の分離・ファイルロック
npm run test:type-policy  # 型安全性ルール
npm run test:typecheck    # テストコードの型検査
npm run test:e2e          # Chromiumの操作テスト
npm run test:desktop      # Electronの操作テスト（先にnpm run build）
npm run test:coverage     # 単体・統合のカバレッジ
```

操作テストはViteを自動起動します。通常は画面を表示しません。表示して調査する場合はChromiumで`--headed`を指定し、Electronでは次を使います（`desktop:smoke`も同様）。OSのフォーカス確認には表示モードが必要です。

```powershell
$env:IMAGE_VIEWER_TEST_SHOW_WINDOW = '1'
try { npm run test:desktop } finally { Remove-Item Env:IMAGE_VIEWER_TEST_SHOW_WINDOW }
```

同じ作業ディレクトリでは`check` → `test:e2e` → `test:desktop`の順に実行し、並行実行しないでください。成果物・開発サーバー・`test-results/`が競合します。

失敗時は再実行前に診断を保存し、初回の失敗と再実行の結果を分けて報告してください。部分的な再実行の成功を全件成功とは扱いません。CIの操作テストは1回再試行し、Releaseの診断アーティファクトは7日間保存します。ローカルでは自動再試行しません。

### 変更時の確認

- 実装変更: `npm run check`。画面操作への影響があれば`test:e2e`、デスクトップ固有なら`test:desktop`も実行。
- 文書のみ: `npm run format:check`とリンク先・記載コマンドの確認。
- 文書更新先: 機能・使い方は[README](README.md)、責務・依存方向は[ARCHITECTURE](ARCHITECTURE.md)、開発手順はこの文書。

## リリース

必要な変更をmainへマージし、GitHub Actionsの`Release`をmainで手動実行します。GitHub CLIで認証済みなら次でも開始できます。ローカルの変更は送信されません。

```powershell
npm run release -- patch  # 修正
npm run release -- minor  # 互換性のある機能追加
npm run release -- major  # 互換性を壊す変更
```

`initial`は未公開の1.0.0専用です（既存のバージョンタグがなく、packageとlockfileが1.0.0で一致する場合のみ）。

1. 実行開始時のmainからバージョン更新コミット・タグをローカルに作り、Git bundleで同一候補を検証・ビルドする。
2. 全ビルド成功後、mainとタグをatomic pushする。mainが進んでいれば失敗する。
3. Windows x64（NSIS・Portable）とmacOS arm64/x64（DMG・ZIP）をReleaseへ公開し、検証済みWeb成果物をPagesへ配信する。Windowsの更新メタデータも添付する。

### 設定・失敗時の対応

- 公開・巻き戻し用のGitHub Appにmain更新・タグ操作のruleset bypassを許可する。Release公開・Pages配信は`GITHUB_TOKEN`を使用。
- PagesのSourceは`GitHub Actions`に設定する。通常のmainへのpushでは配信しない。品質CIはPRの作成・追加コミットのpush・再オープン、および手動実行で動く。PR作成前のpushでは動かない。
- 検証・ビルド失敗ではリモートを変更しない。公開・配信の失敗やキャンセルではRelease・タグを削除し、後続コミットがなければmainを戻す。
- 自動復旧失敗時はジョブログを確認して手動復旧する。配信済みPagesは自動では戻らない。
- 再試行は`Re-run all jobs`で同一候補を使う。mainが進んだ場合は新規実行する。公開済みファイルは再アップロードせず、新版公開後の旧版の再公開・配信は拒否する。

Windowsは未署名、macOSはad-hoc署名で公証なしのため、初回起動時にOSの許可操作が必要な場合があります。更新方法は[README](README.md#更新)を参照してください。
