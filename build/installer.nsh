; Jarchi's additions to electron-builder's NSIS installer (package.json build.nsis; this file is found by its name).
; The installer is in English only: electron-builder asks NSIS for "Persian", but NSIS calls that language "Farsi", so
; a Persian installer doesn't build. The uninstall question below has a Persian half instead.

; The last page's checkbox
!define MUI_FINISHPAGE_RUN_TEXT "Launch Jarchi"

; Always for this Windows user only (no "all users / only me" page): no admin rights needed, so updates never ask either.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Uninstall: the user's data (%APPDATA%\Jarchi: settings, uploads, Kick / Twitch logins, the panel's own choices) is
; deleted only when they say so. Updates and reinstalls run this uninstaller too, but as "updated" or silent: the data
; always stays then. The downloaded updates (electron-updater's cache) go either way.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\jarchi-updater"
    MessageBox MB_YESNO|MB_ICONQUESTION "Keep your Jarchi settings, uploads and logins?$\r$\nYes: they stay on this PC for when you install Jarchi again. No: they are deleted too.$\r$\n$\r$\nتنظیمات، فایل‌های آپلودشده و حساب‌های وصل‌شدهٔ Jarchi نگه داشته شوند؟$\r$\nبله: روی این کامپیوتر می‌مانند تا اگر دوباره Jarchi را نصب کردید، سر جایشان باشند. خیر: آن‌ها هم پاک می‌شوند." /SD IDYES IDYES jarchiKeep
    RMDir /r "$APPDATA\${APP_FILENAME}"
    jarchiKeep:
  ${endIf}
!macroend
