; Compile on Windows with Inno Setup 6.
; This is a per-user online installer, not an offline runtime bundle.

[Setup]
AppId=BMG.CLIP-V3.Preview
AppName=BMG.CLIP-V3 Preview
AppVersion=3.0.0
AppVerName=BMG.CLIP-V3 Preview
VersionInfoDescription=BMG.CLIP-V3 Windows Setup
DefaultDirName={localappdata}\Programs\BMG.CLIP-V3-Preview
DefaultGroupName=BMG.CLIP-V3 Preview
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\installer-output
OutputBaseFilename=BMG.CLIP-V3-Setup
SetupIconFile=..\..\BMG.CLIP-V3-yellow.ico
UninstallDisplayIcon={app}\BMG.CLIP-V3-yellow.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Files]
Source: "..\..\app\*"; DestDir: "{app}\app"; Excludes: "__pycache__\*,*.pyc"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\web\dist\*"; DestDir: "{app}\web\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Launch.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Setup.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\BMG.CLIP-V3.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Stop BMG.CLIP-V3.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\BMG.CLIP-V3-yellow.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\BMG.CLIP-V3 Preview"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\BMG.CLIP-V3.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\BMG.CLIP-V3-yellow.ico"
Name: "{autodesktop}\Stop BMG.CLIP-V3 Preview"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Stop BMG.CLIP-V3.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\BMG.CLIP-V3-yellow.ico"
Name: "{autoprograms}\BMG.CLIP-V3 Preview\BMG.CLIP-V3"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\BMG.CLIP-V3.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\BMG.CLIP-V3-yellow.ico"
Name: "{autoprograms}\BMG.CLIP-V3 Preview\Stop BMG.CLIP-V3"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Stop BMG.CLIP-V3.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\BMG.CLIP-V3 Preview\Finish setup"; Filename: "{app}\Setup.cmd"; WorkingDir: "{app}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\BMG.CLIP-V3.vbs"""; WorkingDir: "{app}"; Description: "Open BMG.CLIP-V3"; Flags: postinstall nowait skipifsilent; Check: DependenciesReady

[Code]
var
  DependenciesInstalled: Boolean;

function DependenciesReady: Boolean;
begin
  Result := DependenciesInstalled;
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This preview installer adds BMG.CLIP-V3 and desktop shortcuts for your Windows account.' + #13#10#13#10 +
    'Internet access is required for Python packages and first-use models/fonts. Missing Python or FFmpeg will be installed only after you confirm their setup prompts.' + #13#10#13#10 +
    'Keep the setup console open until it finishes. This is an unsigned preview installer.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  Started: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    Started := Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\Setup.ps1') + '" -InstallerMode',
      ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ExitCode);
    DependenciesInstalled := Started and (ExitCode = 0);
    if not DependenciesInstalled then
      MsgBox('The app files were installed, but dependency setup did not finish.' + #13#10#13#10 +
        'Use "Finish setup" in the BMG.CLIP-V3 Preview Start Menu folder to retry. The setup log is in the installed app folder.',
        mbError, MB_OK);
  end;
end;
