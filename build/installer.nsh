!macro customInstall
  ; Only installed copies may replace themselves through electron-updater.
  FileOpen $0 "$INSTDIR\resources\nsis-installed" w
  FileWrite $0 "installed"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\resources\nsis-installed"
!macroend
