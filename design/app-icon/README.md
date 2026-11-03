# アプリケーションアイコン

`source.png` から Web・Windows・macOS 用のアイコンを生成します。
通常の npm ビルドでは、生成済みのアイコンを使用します。

## 元画像

図柄の周囲が透明な PNG を `design/app-icon/source.png` に配置します。
生成時に透明部分を切り詰め、図柄を1024×1024pxの中央に配置します。図柄の最大辺は880pxです。
アルファ値が8以下の画素は透明として扱います。

## 生成手順

Python 3 と Pillow が必要です。リポジトリのルートで実行してください。

```powershell
python -m pip install Pillow==10.1.0
python scripts/generate-icons.py
```

以下のファイルを上書きします。元画像を変更した場合は、生成したファイルも一緒にコミットしてください。

| ファイル                      | 用途                                              |
| ----------------------------- | ------------------------------------------------- |
| `build/icon.png`              | 1024px、Electron ウィンドウ用                     |
| `build/icon.ico`              | Windows 実行ファイル・ショートカット用、16〜256px |
| `build/icon.icns`             | macOS アプリ・Dock 用、最大1024px                 |
| `public/favicon.ico`          | Web favicon、16・32・48px                         |
| `public/favicon-32.png`       | Web favicon の PNG 版、32px                       |
| `public/apple-touch-icon.png` | ホーム画面追加用、背景付き180px                   |

ホーム画面追加用の PNG には `#1c1c1e` の背景を付けます。それ以外は透明背景です。
