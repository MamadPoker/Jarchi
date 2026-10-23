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

; Install folder. Whatever folder is picked, Jarchi goes into a "Jarchi" folder in it (E:\ -> E:\Jarchi, E:\Apps ->
; E:\Apps\Jarchi), unless it already is one (E:\Apps\Jarchi), and the field shows that before Install:
; - Browse: NSIS adds InstallDir's last part ("Jarchi") itself, unless the folder picked has that name;
; - typed: Install adds it in the field and stays on the page to show it (Install again to go on);
; - a reinstall starts from the last folder: shown with it from the start.
; A drive itself can be typed (AllowRootDirInstall), so Install stays enabled for E:\, which then becomes E:\Jarchi.
; The page is Jarchi's own, where electron-builder puts its own (package.json leaves that off): its callbacks can't reach
; electron-builder's page, the hidden "all users / only me" page before it takes them.
InstallDir "$LOCALAPPDATA\Programs\Jarchi"
AllowRootDirInstall true

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE jarchiDirPre
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW jarchiDirShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE jarchiDirLeave
  !insertmacro MUI_PAGE_DIRECTORY

  Function jarchiDirPre ; not on updates, like electron-builder's page
    ${IfThen} ${isUpdated} ${|} Abort ${|}
  FunctionEnd
  Function jarchiDirShow
    Call jarchiDir
    SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
  FunctionEnd
  Function jarchiDirLeave ; stays only when "\Jarchi" was added (Browse's own "...\Jarchi\" just goes on)
    Call jarchiDir
    ${If} $0 == 1
      SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
      Abort
    ${EndIf}
  FunctionEnd
  ; $INSTDIR in a "Jarchi" folder: trailing backslashes off (E:\ -> E:), then "\Jarchi" unless it ends with it.
  ; $0 = 1 when it was added.
  Function jarchiDir
    ${Do}
      StrCpy $0 $INSTDIR 1 -1
      ${IfThen} $0 != "\" ${|} ${ExitDo} ${|}
      StrCpy $INSTDIR $INSTDIR -1
    ${Loop}
    StrCpy $0 $INSTDIR "" -7
    ${If} $0 != "\Jarchi"
      StrCpy $INSTDIR "$INSTDIR\Jarchi"
      StrCpy $0 1
    ${Else}
      StrCpy $0 0
    ${EndIf}
  FunctionEnd
!macroend

; Uninstall: the user's data (%APPDATA%\Jarchi: settings, uploads, Kick / Twitch logins, the panel's own choices) is
; deleted only when they say so. Updates and reinstalls run this uninstaller too, but as "updated" or silent: the data
; always stays then. Jarchi's own Uninstall button (Settings) has asked already and passes the answer: --keep-app-data,
; or electron-builder's --delete-app-data (it deletes the data further down). The downloaded updates
; (electron-updater's cache) go either way.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\jarchi-updater"
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--keep-app-data" $R1
    ${if} ${Errors}
      ClearErrors
      ${GetOptions} $R0 "--delete-app-data" $R1
      ${if} ${Errors}
        MessageBox MB_YESNO|MB_ICONQUESTION "$(jarchiKeep)" /SD IDYES IDYES jarchiKeep
        RMDir /r "$APPDATA\${APP_FILENAME}"
        jarchiKeep:
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
