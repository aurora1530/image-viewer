# アプリケーションアイコン

透明背景の元画像を`design/app-icon/source.png`に配置し、リポジトリのルートで生成します。Python 3とPillowが必要です。

```powershell
python -m pip install Pillow==10.1.0
python scripts/generate-icons.py
```

元画像と生成物を一緒にコミットしてください。通常のnpmビルドは生成済みファイルを使用します。

| 生成先                        | 用途                                             |
| ----------------------------- | ------------------------------------------------ |
| `build/icon.png`              | Electronウィンドウ（1024px）                     |
| `build/icon.ico`              | Windows実行ファイル・ショートカット（16〜256px） |
| `build/icon.icns`             | macOSアプリ・Dock（最大1024px）                  |
| `public/favicon.ico`          | Web favicon（16・32・48px）                      |
| `public/favicon-32.png`       | PNG favicon（32px）                              |
| `public/apple-touch-icon.png` | ホーム画面追加用（背景付き180px）                |

生成時に透明余白を切り詰め、1024px四方の中央へ最大辺880pxで配置します。ホーム画面追加用だけ背景色`#1c1c1e`を付けます。
