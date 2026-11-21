; Inno Setup script for the Windows installer. The release workflow builds it:
;   iscc installer\DoormanTrainer.iss /DVersion=0.1.0 /DSource=<staging dir> /O<out dir>
; <staging dir> holds what `modlock publish --to archive` puts in its zip
; (modlock.exe and mod\). Installs just for the current user: no admin prompt.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Source
  #define Source "..\stage"
#endif

[Setup]
AppId={{6C1E2B57-3D9A-4F0E-9B7C-D0A2F1E4C8B3}
AppName=Doorman Trainer
AppVersion={#Version}
AppVerName=Doorman Trainer {#Version}
AppPublisher=BeeeFX
AppPublisherURL=https://github.com/BeeeFX/DoormanTrainer
AppSupportURL=https://github.com/BeeeFX/DoormanTrainer/issues
AppUpdatesURL=https://github.com/BeeeFX/DoormanTrainer/releases
DefaultDirName={autopf}\Doorman Trainer
DefaultGroupName=Doorman Trainer
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=DoormanTrainer-win-Setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\icon.ico
UninstallDisplayName=Doorman Trainer
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Put a shortcut on the desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Source}\modlock.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Source}\mod\*"; DestDir: "{app}\mod"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Doorman Trainer.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; A new version replaces the old mod build entirely.
Type: filesandordirs; Name: "{app}\mod"

[Icons]
Name: "{autoprograms}\Doorman Trainer"; Filename: "{app}\Doorman Trainer.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Comment: "Start Deadlock in Doorman Trainer"
Name: "{autodesktop}\Doorman Trainer"; Filename: "{app}\Doorman Trainer.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Comment: "Start Deadlock in Doorman Trainer"; Tasks: desktopicon

[Run]
Filename: "{app}\Doorman Trainer.cmd"; WorkingDir: "{app}"; Description: "Start Deadlock in Doorman Trainer now"; Flags: postinstall nowait skipifsilent unchecked shellexec
