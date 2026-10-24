!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "WinVer.nsh"
!include "nsDialogs.nsh"

; The compiler bundle calls Persian "Farsi". Generate builder messages only for
; English and supply complete Persian translations here, without cache patches
; or silent English fallbacks in the scope/upgrade/uninstall pages.
!macroundef addLangs
!macro addLangs
  !insertmacro MUI_LANGUAGE "English"
  !ifdef MULTIUSER_INSTALLMODEPAGE
    !define MULTIUSER_TEXT_INSTALLMODE_TITLE "انتخاب کاربران"
    !define MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "برنامه برای کدام کاربران نصب شود؟"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_TOP "نصب فقط برای کاربر فعلی یا همهٔ کاربران این سیستم را انتخاب کنید. $(^ClickNext)"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "نصب برای همهٔ کاربران این سیستم"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "نصب فقط برای من"
  !endif
  !insertmacro MUI_LANGUAGE "Farsi"
  !define LANG_PERSIAN ${LANG_FARSI}
!macroend

Var SCLogHandle
!ifndef BUILD_UNINSTALLER
  Var SCFailure
  Var SCMessage
  Var SCProbeDirectory
  !define MUI_CUSTOMFUNCTION_ABORT SCCancel
!endif

!macro SCLog TEXT
  ClearErrors
  FileOpen $SCLogHandle "$TEMP\ShatootConnect-Setup.log" a
  ${IfNot} ${Errors}
    FileSeek $SCLogHandle 0 END
    FileWrite $SCLogHandle "${VERSION}: ${TEXT}$\r$\n"
    FileClose $SCLogHandle
  ${EndIf}
!macroend

!macro customHeader
  CRCCheck force
  ShowInstDetails show
  ShowUninstDetails show
  LangString chooseInstallationOptions ${LANG_PERSIAN} "انتخاب نوع نصب"
  LangString chooseUninstallationOptions ${LANG_PERSIAN} "انتخاب نوع حذف"
  LangString whichInstallationShouldBeRemoved ${LANG_PERSIAN} "کدام نصب حذف شود؟"
  LangString whoShouldThisApplicationBeInstalledFor ${LANG_PERSIAN} "برنامه برای کدام کاربران نصب شود؟"
  LangString selectUserMode ${LANG_PERSIAN} "نصب برای کاربر فعلی یا همهٔ کاربران این سیستم را انتخاب کنید."
  LangString whichInstallationRemove ${LANG_PERSIAN} "برنامه برای کاربر فعلی و همهٔ کاربران نصب است. کدام نصب حذف شود؟"
  LangString freshInstallForAll ${LANG_PERSIAN} "نصب جدید برای همهٔ کاربران؛ دسترسی مدیر لازم است."
  LangString freshInstallForCurrent ${LANG_PERSIAN} "نصب جدید فقط برای کاربر فعلی."
  LangString onlyForMe ${LANG_PERSIAN} "فقط برای &من"
  LangString forAll ${LANG_PERSIAN} "برای &همهٔ کاربران این سیستم"
  LangString loginWithAdminAccount ${LANG_PERSIAN} "برای ادامه با حساب دارای دسترسی مدیر وارد شوید."
  LangString perUserInstallExists ${LANG_PERSIAN} "برنامه از قبل برای کاربر فعلی نصب است."
  LangString perUserInstall ${LANG_PERSIAN} "یک نصب برای کاربر فعلی وجود دارد."
  LangString perMachineInstallExists ${LANG_PERSIAN} "برنامه از قبل برای همهٔ کاربران نصب است."
  LangString perMachineInstall ${LANG_PERSIAN} "یک نصب برای همهٔ کاربران وجود دارد."
  LangString reinstallUpgrade ${LANG_PERSIAN} "نصب مجدد یا ارتقا انجام می‌شود."
  LangString uninstall ${LANG_PERSIAN} "برنامه حذف می‌شود."
  LangString win7Required ${LANG_PERSIAN} "ویندوز ۱۰ یا جدیدتر لازم است."
  LangString x64WinRequired ${LANG_PERSIAN} "نسخهٔ ۶۴ بیتی ویندوز لازم است."
  LangString appRunning ${LANG_PERSIAN} "برنامه باز است؛ ابتدا آن را ببندید."
  LangString appCannotBeClosed ${LANG_PERSIAN} "برنامه را ببندید و دوباره تلاش کنید."
  LangString installing ${LANG_PERSIAN} "در حال نصب؛ لطفاً منتظر بمانید…"
  LangString areYouSureToUninstall ${LANG_PERSIAN} "آیا Shatoot Connect حذف شود؟"
  LangString decompressionFailed ${LANG_PERSIAN} "استخراج فایل‌ها انجام نشد. فضای دیسک و دسترسی‌ها را بررسی کنید و نصب را دوباره اجرا کنید."
  LangString uninstallFailed ${LANG_PERSIAN} "حذف نسخهٔ قبلی انجام نشد. برنامه را ببندید و دوباره تلاش کنید."
  LangString appClosing ${LANG_PERSIAN} "در حال بستن برنامه…"
  LangString SCWelcome ${LANG_ENGLISH} "Install Shatoot Connect"
  LangString SCWelcome ${LANG_PERSIAN} "نصب Shatoot Connect"
  LangString SCWelcomeBody ${LANG_ENGLISH} "Fast remote desktop for Windows.$\r$\n$\r$\nSetup works offline. Your saved computers, encrypted passwords and connection settings are kept during upgrades.$\r$\n$\r$\nOpen application/chat windows must be closed. Background instances close automatically."
  LangString SCWelcomeBody ${LANG_PERSIAN} "ارتباط و کنترل از راه دور ویندوز.$\r$\n$\r$\nنصب بدون اینترنت انجام می‌شود. هنگام ارتقا، سیستم‌های ذخیره‌شده، رمزهای رمزنگاری‌شده و تنظیمات اتصال حفظ می‌شوند.$\r$\n$\r$\nپنجره‌های باز برنامه و چت را ببندید. برنامهٔ پس‌زمینه خودکار بسته می‌شود."
  LangString SCReviewTitle ${LANG_ENGLISH} "Ready to install"
  LangString SCReviewTitle ${LANG_PERSIAN} "آمادهٔ نصب"
  LangString SCReviewBody ${LANG_ENGLISH} "Review the destination. Use Back to change it."
  LangString SCReviewBody ${LANG_PERSIAN} "مسیر نصب را بررسی کنید. برای تغییر، به مرحلهٔ قبل برگردید."
  LangString SCReview ${LANG_ENGLISH} "Shatoot Connect ${VERSION}$\r$\n$\r$\nDestination:$\r$\n$INSTDIR$\r$\n$\r$\nPersonal settings and encrypted passwords are kept, including when uninstalling. Remote access permissions are configured inside the app."
  LangString SCReview ${LANG_PERSIAN} "Shatoot Connect ${VERSION}$\r$\n$\r$\nمسیر نصب:$\r$\n$INSTDIR$\r$\n$\r$\nتنظیمات شخصی و رمزهای رمزنگاری‌شده حتی هنگام حذف برنامه حفظ می‌شوند. مجوزهای اتصال از داخل برنامه تنظیم می‌شوند."
  LangString SCWindows ${LANG_ENGLISH} "Windows 10/11 or Windows Server 2016 or later (64-bit) is required."
  LangString SCWindows ${LANG_PERSIAN} "ویندوز ۱۰ یا ۱۱، یا ویندوز سرور ۲۰۱۶ به بعد، نسخهٔ ۶۴ بیتی لازم است."
  LangString SCFolder ${LANG_ENGLISH} "Choose a dedicated local folder named Shatoot Connect. System folders, network paths, junctions and folders containing other files cannot be used."
  LangString SCFolder ${LANG_PERSIAN} "یک پوشهٔ محلی اختصاصی با نام Shatoot Connect انتخاب کنید. پوشه‌های سیستمی، شبکه‌ای، پیوندی و پوشه‌های دارای فایل‌های دیگر قابل استفاده نیستند."
  LangString SCWrite ${LANG_ENGLISH} "Setup cannot write to the destination or temporary folder. Choose a writable folder, check security software, or select installation for all users with administrator access."
  LangString SCWrite ${LANG_PERSIAN} "امکان نوشتن در مسیر نصب یا پوشهٔ موقت وجود ندارد. مسیر قابل‌نوشتن انتخاب کنید، نرم‌افزار امنیتی را بررسی کنید، یا نصب برای همهٔ کاربران با دسترسی مدیر را انتخاب کنید."
  LangString SCSpace ${LANG_ENGLISH} "There is not enough free space for installation and temporary extraction. Free disk space on the destination and temporary drives, then retry."
  LangString SCSpace ${LANG_PERSIAN} "فضای آزاد برای نصب و استخراج فایل‌های موقت کافی نیست. در درایو نصب و درایو پوشهٔ موقت فضا آزاد کنید و دوباره تلاش کنید."
  LangString SCDowngrade ${LANG_ENGLISH} "A newer version is installed. Use the latest installer. To downgrade deliberately, uninstall the newer version first; personal settings will be kept."
  LangString SCDowngrade ${LANG_PERSIAN} "نسخهٔ جدیدتری نصب است. از نصب‌کنندهٔ جدید استفاده کنید. برای بازگشت عمدی به نسخهٔ قدیمی، ابتدا نسخهٔ جدید را حذف کنید؛ تنظیمات شخصی حفظ می‌شوند."
  LangString SCRunning ${LANG_ENGLISH} "Shatoot Connect is running. Close it on this computer and select Retry. An active remote session must be disconnected first."
  LangString SCRunning ${LANG_PERSIAN} "برنامهٔ Shatoot Connect باز است. ابتدا اتصال فعال را قطع کنید، برنامه را در این سیستم ببندید و «تلاش مجدد» را بزنید."
  LangString SCProcess ${LANG_ENGLISH} "Windows could not check whether Shatoot Connect is running. Restart Windows and retry."
  LangString SCProcess ${LANG_PERSIAN} "بررسی باز بودن برنامه توسط ویندوز انجام نشد. ویندوز را راه‌اندازی مجدد کنید و دوباره تلاش کنید."
  LangString SCCorrupt ${LANG_ENGLISH} "An installed file is missing or damaged. Check disk space and security software, then run this installer again."
  LangString SCCorrupt ${LANG_PERSIAN} "یکی از فایل‌های نصب‌شده ناقص یا آسیب‌دیده است. فضای دیسک و نرم‌افزار امنیتی را بررسی کنید و نصب را دوباره انجام دهید."
  LangString SCError ${LANG_ENGLISH} "Setup did not complete."
  LangString SCError ${LANG_PERSIAN} "نصب کامل نشد."
  LangString SCPrevious ${LANG_ENGLISH} "The previous version could not be removed. Close the app and any program using its files, check permissions, and retry. Your personal settings are kept."
  LangString SCPrevious ${LANG_PERSIAN} "حذف نسخهٔ قبلی انجام نشد. برنامه و هر نرم‌افزاری که فایل‌های آن را باز کرده ببندید، دسترسی‌ها را بررسی کنید و دوباره تلاش کنید. تنظیمات شخصی حفظ می‌شوند."
  LangString SCRegistration ${LANG_ENGLISH} "Windows could not register the installation or its uninstaller. Check your account permissions and security software, then run Setup again."
  LangString SCRegistration ${LANG_PERSIAN} "ثبت نصب یا برنامهٔ حذف در ویندوز انجام نشد. دسترسی حساب کاربری و نرم‌افزار امنیتی را بررسی کنید و نصب را دوباره اجرا کنید."
  LangString SCRemoveFailed ${LANG_ENGLISH} "Some application files are in use or cannot be changed. Close programs using these files and select Retry. Removal has stopped and the application files have been restored."
  LangString SCRemoveFailed ${LANG_PERSIAN} "بعضی فایل‌های برنامه باز هستند یا امکان تغییرشان وجود ندارد. برنامه‌های استفاده‌کننده را ببندید و «تلاش مجدد» را بزنید. حذف متوقف شد و فایل‌های برنامه برگردانده شدند."
  LangString SCLogLocation ${LANG_ENGLISH} "Diagnostic log: $TEMP\ShatootConnect-Setup.log"
  LangString SCLogLocation ${LANG_PERSIAN} "مسیر جزئیات خطا: $TEMP\ShatootConnect-Setup.log"
!macroend

!macro preInit
  ; English is the default even on Persian Windows; the selector can change it.
  StrCpy $LANGUAGE 1033
  !ifndef BUILD_UNINSTALLER
    SetErrorLevel 1603
    ${IfNot} ${AtLeastWin10}
    ${OrIfNot} ${RunningX64}
      !insertmacro SCLog "Unsupported Windows version or architecture."
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "$(SCWindows)" /SD IDOK
      ${EndIf}
      SetErrorLevel 10
      Quit
    ${EndIf}
  !endif
!macroend

; Close verified background instances; visible application/chat windows remain open.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\ShatootConnect-CloseBackground.ps1 "${PROJECT_DIR}\build\installer-close.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ShatootConnect-CloseBackground.ps1"'
  Pop $R1
  Pop $R2
  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 603
      ${Break}
    ${EndIf}
    ${If} $R0 == 0
      !insertmacro SCLog "Application is running; installation/uninstallation blocked."
      ${If} ${Silent}
        SetErrorLevel 1618
        Quit
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(SCRunning)" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 1618
      Quit
    ${Else}
      !insertmacro SCLog "Process enumeration failed: $R0"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "$(SCProcess)" /SD IDOK
      ${EndIf}
      SetErrorLevel 1603
      Quit
    ${EndIf}
  ${Loop}
!macroend

!ifndef BUILD_UNINSTALLER
  !tempfile SC_HASH_DEFINES
  !system 'node "${PROJECT_DIR}\build\installer-integrity.cjs" "${PROJECT_DIR}\release\win-unpacked" "${SC_HASH_DEFINES}"' = 0
  !include "${SC_HASH_DEFINES}"
  !delfile "${SC_HASH_DEFINES}"
  !undef SC_HASH_DEFINES

  ; The stock handler displays a modal error even during /S. Fail closed instead
  ; of continuing over an uninstaller that could not run or returned an error.
  !macro customUnInstallCheck
    ${If} ${Errors}
    ${OrIf} $R0 != 0
      StrCpy $SCFailure 1603
      StrCpy $SCMessage "$(SCPrevious)"
      !insertmacro SCLog "Previous uninstall failed: $R0"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "$SCMessage$\r$\n$\r$\n$(SCLogLocation)" /SD IDOK
      ${EndIf}
      SetErrorLevel 1603
      Quit
    ${EndIf}
    Return
  !macroend

  !macro customUnInstallCheckCurrentUser
    !insertmacro customUnInstallCheck
  !macroend

  !macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "$(SCWelcome)"
    !define MUI_WELCOMEPAGE_TEXT "$(SCWelcomeBody)"
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  !macro customPageAfterChangeDir
    Page custom SCReviewCreate SCReviewLeave
  !macroend

  Function SCCleanupProbeDirectory
    ${If} $SCProbeDirectory != ""
      ; Non-recursive: this can remove only the empty folder created by preflight.
      RMDir "$SCProbeDirectory"
      StrCpy $SCProbeDirectory ""
    ${EndIf}
  FunctionEnd

  Function SCPreflight
    Call SCCleanupProbeDirectory
    StrCpy $SCFailure 11
    StrCpy $SCMessage "$(SCFolder)"
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 != "${APP_FILENAME}"
      Return
    ${EndIf}
    StrCpy $0 $INSTDIR 2
    ${If} $0 == "\\"
      Return
    ${EndIf}
    ; Reject a final-folder junction instead of installing through it.
    System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
    ${If} $0 != -1
      IntOp $0 $0 & 0x400
      ${If} $0 != 0
        Return
      ${EndIf}
    ${EndIf}
    StrLen $0 "$WINDIR\"
    StrCpy $1 $INSTDIR $0
    ${If} $1 == "$WINDIR\"
      Return
    ${EndIf}
    ; Refuse to adopt a nonempty unrelated folder: uninstall removes its contents.
    ${IfNot} ${FileExists} "$INSTDIR\${PRODUCT_FILENAME}.exe"
    ${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
      FindFirst $1 $2 "$INSTDIR\*"
      ${DoWhile} $2 != ""
        ${If} $2 != "."
        ${AndIf} $2 != ".."
          FindClose $1
          Return
        ${EndIf}
        FindNext $1 $2
      ${Loop}
      FindClose $1
    ${EndIf}
    ReadRegStr $0 SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" DisplayVersion
    ${If} $0 != ""
      ${VersionCompare} "${VERSION}" "$0" $1
      ${If} $1 == 2
        StrCpy $SCFailure 16
        StrCpy $SCMessage "$(SCDowngrade)"
        Return
      ${EndIf}
    ${EndIf}

    StrCpy $SCFailure 12
    StrCpy $SCMessage "$(SCWrite)"
    ${IfNot} ${FileExists} "$INSTDIR\*"
      StrCpy $SCProbeDirectory "$INSTDIR"
    ${EndIf}
    ClearErrors
    CreateDirectory "$INSTDIR"
    ${If} ${Errors}
      Return
    ${EndIf}
    GetTempFileName $0 "$INSTDIR"
    ${If} ${Errors}
      Return
    ${EndIf}
    FileOpen $1 "$0" w
    FileWrite $1 "Shatoot Connect setup write test"
    FileClose $1
    ${If} ${Errors}
      Delete "$0"
      Return
    ${EndIf}
    Delete "$0"
    ClearErrors
    GetTempFileName $0 "$TEMP"
    ${If} ${Errors}
      Return
    ${EndIf}
    Delete "$0"

    StrCpy $SCFailure 13
    StrCpy $SCMessage "$(SCSpace)"
    ${GetRoot} "$INSTDIR" $1
    ${GetRoot} "$TEMP" $2
    ; Reserve space for the payload, extraction, installer cache and an upgrade.
    IntOp $3 ${SC_PAYLOAD_MB} + 128
    IntOp $4 ${SC_PAYLOAD_MB} * 2
    IntOp $4 $4 + 128
    ${If} $1 == $2
      IntOp $3 $3 + $4
      StrCpy $4 $3
    ${EndIf}
    ClearErrors
    ${DriveSpace} "$1\" "/D=F /S=M" $0
    ${If} ${Errors}
    ${OrIf} $0 < $3
      Return
    ${EndIf}
    ${DriveSpace} "$2\" "/D=F /S=M" $0
    ${If} ${Errors}
    ${OrIf} $0 < $4
      Return
    ${EndIf}
    StrCpy $SCFailure 0
    StrCpy $SCMessage ""
    !insertmacro SCLog "Preflight passed: $INSTDIR"
  FunctionEnd

  Function SCReviewCreate
    Call instFilesPre
    !insertmacro MUI_HEADER_TEXT "$(SCReviewTitle)" "$(SCReviewBody)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      SetErrorLevel 1603
      Quit
    ${EndIf}
    nsDialogs::SetRTL $(^RTL)
    ${NSD_CreateLabel} 0 0 100% 100% "$(SCReview)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function SCReviewLeave
    Call SCPreflight
    ${If} $SCFailure != 0
      !insertmacro SCLog "Preflight failed: $SCFailure; $INSTDIR"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$SCMessage$\r$\n$\r$\n$(SCLogLocation)" /SD IDOK
      Abort
    ${EndIf}
    StrCpy $SCFailure 1603
  FunctionEnd

  !macro customInit
    SetErrorLevel 1603
    StrCpy $SCFailure 1603
    !insertmacro SCLog "Setup started."
    ${If} ${Silent}
      Call instFilesPre
      Call SCPreflight
      ${If} $SCFailure != 0
        !insertmacro SCLog "Preflight failed: $SCFailure; $INSTDIR"
        Call SCCleanupProbeDirectory
        SetErrorLevel $SCFailure
        Quit
      ${EndIf}
      StrCpy $SCFailure 1603
    ${EndIf}
  !macroend

  ; ZIP extraction reports failures instead of falling back to unchecked writes.
  ; Hash every packaged file before registering a successful installation.
  !macro customFiles_x64
    !insertmacro SCVerifyPayload
  !macroend

  !macro customInstall
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 != "$INSTDIR"
    ${OrIfNot} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      StrCpy $SCFailure 17
      StrCpy $SCMessage "$(SCRegistration)"
      Abort
    ${EndIf}
    StrCpy $SCProbeDirectory ""
    SetErrorLevel 0
    !insertmacro SCLog "Payload verified; installation complete: $INSTDIR"
  !macroend

  Function .onInstFailed
    Call SCCleanupProbeDirectory
    !insertmacro SCLog "Installation failed: $SCFailure; $INSTDIR"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$(SCError)$\r$\n$SCMessage$\r$\n$\r$\n$(SCLogLocation)" /SD IDOK
    ${EndIf}
    SetErrorLevel $SCFailure
  FunctionEnd

  Function SCCancel
    Call SCCleanupProbeDirectory
    !insertmacro SCLog "Setup cancelled."
  FunctionEnd
!else
  ; Use the template's atomic move/restore for ordinary uninstall as well as
  ; upgrades. A locked file must not leave half an app and a success exit code.
  !macro customRemoveFiles
    scRemoveRetry:
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${If} $R0 != 0
      Push ""
      Call un.restoreFiles
      Pop $R0
      !insertmacro SCLog "Removal blocked; previous application files restored."
      ${IfNot} ${Silent}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(SCRemoveFailed)" /SD IDCANCEL IDRETRY scRemoveRetry
      ${EndIf}
      Abort
    ${EndIf}
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
  !macroend

  !macro customUnInit
    SetErrorLevel 1603
    !insertmacro SCLog "Uninstall started; personal settings retained."
  !macroend

  Function un.onUninstSuccess
    !insertmacro SCLog "Uninstall complete; personal settings retained."
    SetErrorLevel 0
  FunctionEnd

  Function un.onUninstFailed
    !insertmacro SCLog "Uninstall failed; check file permissions and running processes."
    SetErrorLevel 1603
  FunctionEnd
!endif
