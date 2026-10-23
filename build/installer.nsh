; Jarchi's additions to electron-builder's NSIS installer (package.json build.nsis; this file is found by its name, and so
; are the pictures next to it: installerSidebar.bmp on Welcome and Finish, 164x314, and installerHeader.bmp on the other
; pages, 150x57. The installer's and uninstaller's icon is package.json build.win.icon).

; Languages: English and Persian, from a list at the start with the Windows language picked (package.json
; installerLanguages + displayLanguageSelector). electron-builder asks NSIS for "Persian", but NSIS's own files call it
; "Farsi", so MUI2's MUI_LANGUAGE is swapped for one that loads Farsi then. The list shows both languages whatever the
; Windows codepage.
!include "MUI2.nsh"
!macroundef MUI_LANGUAGE
!macro MUI_LANGUAGE NAME
  !if "${NAME}" == "Persian"
    ; The five texts NSIS's Farsi file lacks (the "all users / only me" page, never shown here); missing, NSIS warns.
    !define MULTIUSER_TEXT_INSTALLMODE_TITLE "انتخاب کاربران"
    !define MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "انتخاب کنید $(^NameDA) برای کدام کاربران نصب شود."
    !define MULTIUSER_INNERTEXT_INSTALLMODE_TOP "انتخاب کنید $(^NameDA) فقط برای شما نصب شود یا برای همهٔ کاربران این کامپیوتر. $(^ClickNext)"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "نصب برای همهٔ کاربران این کامپیوتر"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "نصب فقط برای من"
    !insertmacro MUI_LANGUAGEEX "${NSISDIR}\Contrib\Language files" "Farsi"
  !else
    !insertmacro MUI_LANGUAGEEX "${NSISDIR}\Contrib\Language files" "${NAME}"
  !endif
!macroend
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_LANGDLL_WINDOWTITLE "Jarchi"
!define MUI_LANGDLL_INFO "Please select a language.$\r$\nلطفاً زبان را انتخاب کنید."

; 1033 = English, 1065 = Persian
LangString jarchiWelcome 1033 "Jarchi: all-in-one stream alerts for Kick and Twitch.$\r$\n$\r$\n$_CLICK"
LangString jarchiWelcome 1065 "Jarchi: همهٔ الرت‌های استریم Kick و Twitch در یک برنامه.$\r$\n$\r$\n$_CLICK"
LangString jarchiLaunch 1033 "Launch Jarchi"
LangString jarchiLaunch 1065 "اجرای Jarchi"
LangString jarchiKeep 1033 "Keep your Jarchi settings, uploads and logins?$\r$\n$\r$\nYes: they stay on this PC for when you install Jarchi again.$\r$\nNo: they are deleted too."
LangString jarchiKeep 1065 "تنظیمات، فایل‌های آپلودشده و حساب‌های وصل‌شدهٔ Jarchi نگه داشته شوند؟$\r$\n$\r$\nبله: روی این کامپیوتر می‌مانند تا اگر دوباره Jarchi را نصب کردید، سر جایشان باشند.$\r$\nخیر: آن‌ها هم پاک می‌شوند."

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "$(jarchiWelcome)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The last page's checkbox
!define MUI_FINISHPAGE_RUN_TEXT "$(jarchiLaunch)"

; Always for this Windows user only (no "all users / only me" page): no admin rights needed, so updates never ask either.
; The default folder is the usual one for that (%LOCALAPPDATA%\Programs\Jarchi).
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Whatever folder is picked, Jarchi goes into a "Jarchi" folder in it (E:\ -> E:\Jarchi, E:\Apps -> E:\Apps\Jarchi),
; unless it already is one (E:\Apps\Jarchi). Runs as the files are about to be copied: in place of electron-builder's
; own check (instFilesPre: only when "Jarchi" is nowhere in the path), which still runs after it, finding nothing to do.
!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE jarchiInstDir
  Function jarchiInstDir
    ${Do}
      StrCpy $0 $INSTDIR 1 -1
      ${IfThen} $0 != "\" ${|} ${ExitDo} ${|}
      StrCpy $INSTDIR $INSTDIR -1
    ${Loop}
    StrCpy $0 $INSTDIR "" -7
    ${IfThen} $0 != "\Jarchi" ${|} StrCpy $INSTDIR "$INSTDIR\Jarchi" ${|}
    Call instFilesPre
  FunctionEnd
!macroend

; Uninstall: the user's data (%APPDATA%\Jarchi: settings, uploads, Kick / Twitch logins, the panel's own choices) is
; deleted only when they say so. Updates and reinstalls run this uninstaller too, but as "updated" or silent: the data
; always stays then. The downloaded updates (electron-updater's cache) go either way.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\jarchi-updater"
    MessageBox MB_YESNO|MB_ICONQUESTION "$(jarchiKeep)" /SD IDYES IDYES jarchiKeep
    RMDir /r "$APPDATA\${APP_FILENAME}"
    jarchiKeep:
  ${endIf}
!macroend
