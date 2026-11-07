; NYX Browser installer for Windows. Built by build-win.sh with makensis.
; Installs for the current user only (no admin rights), always into %LOCALAPPDATA%\Programs\NYX Browser:
; there's no folder choice, because install and uninstall remove the whole folder.
; Defines from build-win.sh: VERSION, SRC (prepared app folder), OUT (installer path), ICON.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APP "NYX Browser"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NYXBrowser"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
BrandingText "${APP} ${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\nyx.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить ${APP}"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Section "Install"
  ; A running browser keeps firefox.exe locked: replacing it half-way would break the install.
  ${If} ${FileExists} "$INSTDIR\firefox.exe"
    ClearErrors
    Delete "$INSTDIR\firefox.exe"
    ${If} ${Errors}
      MessageBox MB_ICONEXCLAMATION|MB_OK "Закрой ${APP} и запусти установку снова."
      Abort
    ${EndIf}
    ; Files of the previous version go, so nothing stale stays next to the new ones.
    RMDir /r "$INSTDIR"
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\nyx.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\nyx.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "NYX"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\nyx.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; Tabs, passwords and settings live in %APPDATA%\NYX and stay: reinstalling brings them back.
Section "Uninstall"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
