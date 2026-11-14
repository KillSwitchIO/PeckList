; PeckList's Windows installer (PL-132): the server as a Windows service and the command line on PATH,
; one unsigned installer per release, pecklist-setup-<version>-x64.exe. Built in CI under Wine by
; scripts/ci/windows-installer.sh, which passes the defines below from the release's portable files.
;
;   C:\Program Files\PeckList          the server (replaced on upgrade)
;   C:\Program Files\PeckList\bin      pecklist.exe (the command line, the arm64 build on Windows on
;                                      ARM) and pecklist-server.cmd (maintenance), on PATH
;   C:\ProgramData\PeckList            database, snapshots, logs, settings (kept on upgrade and uninstall)
;
; Silent installs (winget, scripts): /VERYSILENT /SUPPRESSMSGBOXES /NORESTART, plus /PORT=9000 and
; /OPENFIREWALL on a first install, /COMPONENTS="cli" for the command line alone. The exit code is 0,
; or 10 when the files went in but the service did not start (setup-service.log says why).

#ifndef AppVersion
  #error Pass /DAppVersion=<version> (scripts/ci/windows-installer.sh)
#endif
#ifndef NumericVersion
  #define NumericVersion "0.0.0.0"
#endif
#ifndef ServerDir
  #error Pass /DServerDir=<the unpacked pecklist-server-win-x64 folder>
#endif
#ifndef CliX64
  #error Pass /DCliX64=<pecklist.exe for win-x64>
#endif
#ifndef CliArm64
  #error Pass /DCliArm64=<pecklist.exe for win-arm64>
#endif

[Setup]
; Never change the AppId: upgrades find the installed copy by it.
AppId={{530B9A5D-13F1-4119-8162-394E031D1A11}
AppName=PeckList
AppVersion={#AppVersion}
AppVerName=PeckList {#AppVersion}
AppPublisher=PeckList
AppPublisherURL=https://pecklist.com
AppSupportURL=https://docs.pecklist.com
AppUpdatesURL=https://gitlab.com/killswitch10/pecklist/-/releases
VersionInfoVersion={#NumericVersion}
DefaultDirName={autopf}\PeckList
DisableDirPage=auto
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes
; The service is stopped before the files go in (PrepareToInstall), so nothing needs closing.
CloseApplications=no
RestartIfNeededByRun=no
WizardStyle=modern
SetupIconFile=pecklist.ico
UninstallDisplayIcon={app}\bin\pecklist.exe
UninstallDisplayName=PeckList
Compression=lzma2/max
SolidCompression=yes
OutputBaseFilename=pecklist-setup-x64
SetupLogging=yes

[Types]
Name: "full"; Description: "Server and command line"
Name: "cli"; Description: "Command line only"
Name: "custom"; Description: "Custom"; Flags: iscustom

[Components]
Name: "server"; Description: "Server (Windows service)"; Types: full custom
Name: "cli"; Description: "Command line (adds pecklist to PATH)"; Types: full cli custom

[Files]
; The portable server folder, minus its own install scripts: the installer looks after the service.
Source: "{#ServerDir}\*"; DestDir: "{app}"; Excludes: "examples\*.ps1"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#CliX64}"; DestDir: "{app}\bin"; DestName: "pecklist.exe"; Components: cli; Check: not IsArm64; Flags: ignoreversion
Source: "{#CliArm64}"; DestDir: "{app}\bin"; DestName: "pecklist.exe"; Components: cli; Check: IsArm64; Flags: ignoreversion
Source: "pecklist-server.cmd"; DestDir: "{app}\bin"; Components: server; Flags: ignoreversion
Source: "setup-service.ps1"; DestDir: "{app}\setup"; Components: server; Flags: ignoreversion
Source: "remove-service.ps1"; DestDir: "{app}\setup"; Components: server; Flags: ignoreversion
; examples\windows\lock-folder.ps1 (windows-installer.sh puts it here): for setup-service.ps1, and
; from Setup's temporary folder for the program folder's lock, before anything is in it.
Source: "lock-folder.ps1"; DestDir: "{app}\setup"; Components: server; Flags: ignoreversion
Source: "lock-folder.ps1"; Flags: dontcopy

[InstallDelete]
; The web app's files carry hashes in their names: last version's are of no use.
Type: filesandordirs; Name: "{app}\wwwroot"; Components: server

[Registry]
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}\bin"; Check: NeedsAddPath(ExpandConstant('{app}\bin'))

[Run]
Filename: "{code:ServiceAddress}"; Description: "Open PeckList"; Flags: postinstall shellexec nowait skipifsilent unchecked; Components: server; Check: ServiceStarted

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup\remove-service.ps1"""; RunOnceId: "RemoveService"; Flags: runhidden waituntilterminated; Check: FileExists(ExpandConstant('{app}\setup\remove-service.ps1'))

[Code]
const
  ServiceKey = 'SYSTEM\CurrentControlSet\Services\PeckList';
  EnvironmentKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{530B9A5D-13F1-4119-8162-394E031D1A11}_is1';
  ServiceFailed = 10;

var
  ServerPage: TInputQueryWizardPage;
  FirewallBox: TNewCheckBox;
  Started: Boolean;
  SetupFailed: Boolean;
  AdminPassword: String;

function HasSwitch(Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/' + Name) = 0 then Result := True;
end;

function ServiceExisted: Boolean;
begin
  Result := RegKeyExists(HKLM, ServiceKey);
end;

{ The port a first install asks for (the page, or /PORT=); 0 on an upgrade, which keeps the old one. }
function ChosenPort: Integer;
begin
  if ServiceExisted and (ExpandConstant('{param:PORT|}') = '') then
    Result := 0
  else if WizardSilent then
    Result := StrToIntDef(ExpandConstant('{param:PORT|8080}'), 8080)
  else
    Result := StrToIntDef(Trim(ServerPage.Values[0]), 8080);
end;

{ Where to open PeckList on this computer: the port asked for, or the service's first address
  (ASPNETCORE_URLS, http or https, as setup-service.ps1 left it). }
function ServiceAddress(Param: String): String;
var
  Env, Urls, Scheme: String;
  At, Colon, Port: Integer;
begin
  Result := 'http://localhost:8080';
  if ChosenPort > 0 then
  begin
    Result := 'http://localhost:' + IntToStr(ChosenPort);
    exit;
  end;
  if not RegQueryMultiStringValue(HKLM, ServiceKey, 'Environment', Env) then exit;
  Env := #0 + Env + #0;
  At := Pos(#0 + 'ASPNETCORE_URLS=', Env);
  if At = 0 then exit;
  Urls := Copy(Env, At + Length(#0 + 'ASPNETCORE_URLS='), Length(Env));
  Urls := Copy(Urls, 1, Pos(#0, Urls) - 1);
  if Pos(';', Urls) > 0 then Urls := Copy(Urls, 1, Pos(';', Urls) - 1);
  Urls := Trim(Urls);
  if (Length(Urls) > 0) and (Urls[Length(Urls)] = '/') then Urls := Copy(Urls, 1, Length(Urls) - 1);
  Scheme := 'http';
  if Pos('https://', Lowercase(Urls)) = 1 then Scheme := 'https';
  Colon := 0;
  for At := 1 to Length(Urls) do
    if Urls[At] = ':' then Colon := At;
  Port := StrToIntDef(Copy(Urls, Colon + 1, Length(Urls)), 0);
  if (Port > 0) and (Port < 65536) then Result := Scheme + '://localhost:' + IntToStr(Port);
end;

{ lock-folder.ps1 (examples\windows), run from Setup's own temporary folder, with what it said
  copied into Setup's log. Returns its exit code (-1 if it could not run). }
function RunLockFolder(Params: String): Integer;
var
  Report: String;
  Lines: TArrayOfString;
  I: Integer;
begin
  ExtractTemporaryFile('lock-folder.ps1');
  Report := ExpandConstant('{tmp}\lock-folder.txt');
  DeleteFile(Report);
  if not Exec(ExpandConstant('{cmd}'), '/c powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\lock-folder.ps1') + '" ' + Params + ' > "' + Report + '" 2>&1', '', SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := -1;
  if LoadStringsFromFile(Report, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do Log('lock-folder: ' + Lines[I]);
end;

{ The program folder: administrators and SYSTEM may change it, users may run it. Under Program Files
  that is so already; anywhere else (/DIR=, winget --location) it would inherit what users may
  write, and it holds the service's program, bin\ on the system PATH and the scripts uninstall runs
  elevated. Links in it are removed first, then the owner, no entry anyone else added, the list. }
function LockProgramFolder: Boolean;
begin
  ForceDirectories(ExpandConstant('{app}'));
  Result := RunLockFolder('-Path "' + ExpandConstant('{app}') + '" -Grant "*S-1-5-32-544:(OI)(CI)F,*S-1-5-18:(OI)(CI)F,*S-1-5-32-545:(OI)(CI)RX"') = 0;
end;

function ServiceStarted: Boolean;
begin
  Result := Started;
end;

function NeedsAddPath(Folder: String): Boolean;
var
  Path: String;
begin
  if not RegQueryStringValue(HKLM, EnvironmentKey, 'Path', Path) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(Folder) + ';', ';' + Uppercase(Path) + ';') = 0;
end;

procedure RemovePath(Folder: String);
var
  Path: String;
  At: Integer;
begin
  if not RegQueryStringValue(HKLM, EnvironmentKey, 'Path', Path) then exit;
  At := Pos(';' + Uppercase(Folder) + ';', ';' + Uppercase(Path) + ';');
  if At = 0 then exit;
  { At is in ';' + Path + ';': first in the list, take the folder and the ';' after it, else the ';' before it. }
  if At = 1 then Delete(Path, 1, Length(Folder) + 1) else Delete(Path, At - 1, Length(Folder) + 1);
  if (Length(Path) > 0) and (Path[1] = ';') then Delete(Path, 1, 1);
  RegWriteExpandStringValue(HKLM, EnvironmentKey, 'Path', Path);
end;

{ /PORT= must be a port: checked before anything happens, rather than becoming 8080 or a service
  that never answers. }
function InitializeSetup: Boolean;
var
  Given: String;
  Port: Integer;
begin
  Result := True;
  Given := ExpandConstant('{param:PORT|}');
  if Given = '' then exit;
  Port := StrToIntDef(Given, 0);
  if (Port < 1) or (Port > 65535) then
  begin
    Log('/PORT=' + Given + ' is not a port (1 to 65535).');
    SuppressibleMsgBox('/PORT=' + Given + ' is not a port: give a number from 1 to 65535.', mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectComponents, 'Server', 'Where the server listens',
    'PeckList answers on this port, on every address of this computer. Settings can be changed later in C:\ProgramData\PeckList\pecklist.conf.');
  ServerPage.Add('Port:', False);
  ServerPage.Values[0] := ExpandConstant('{param:PORT|8080}');
  FirewallBox := TNewCheckBox.Create(ServerPage);
  FirewallBox.Parent := ServerPage.Surface;
  FirewallBox.Top := ServerPage.Edits[0].Top + ServerPage.Edits[0].Height + ScaleY(16);
  FirewallBox.Width := ServerPage.SurfaceWidth;
  FirewallBox.Height := ScaleY(20);
  FirewallBox.Caption := 'Allow the port through Windows Defender Firewall (private networks)';
  FirewallBox.Checked := HasSwitch('OPENFIREWALL');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ServerPage.ID) and ((not WizardIsComponentSelected('server')) or ServiceExisted);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    Port := StrToIntDef(Trim(ServerPage.Values[0]), 0);
    if (Port < 1) or (Port > 65535) then
    begin
      MsgBox('The port must be a number from 1 to 65535.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Stop a running service first, so its files can be replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  { A first install into a folder someone other than an administrator made and filled: what they put
    there (a DLL next to pecklist.exe) would stay after the lock. }
  if (not RegKeyExists(HKLM, UninstallKey)) and
    (RunLockFolder('-Check -Path "' + ExpandConstant('{app}') + '"') = 3) then
  begin
    Result := ExpandConstant('{app}') + ' already has files in it that someone other than an administrator put there. ' +
      'Choose another folder, or empty that one, and run the installer again.';
    exit;
  end;
  if ServiceExisted then
    Exec('powershell.exe', '-NoProfile -Command "$s = Get-Service PeckList -ErrorAction SilentlyContinue; ' +
      'if ($s -and $s.Status -ne ''Stopped'') { Stop-Service PeckList -Force; $s.WaitForStatus(''Stopped'', [TimeSpan]::FromSeconds(60)) }"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function FirstLine(FileName: String): String;
var
  Lines: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(FileName, Lines) and (GetArrayLength(Lines) > 0) then Result := Trim(Lines[0]);
end;

procedure SetUpService;
var
  Params, LogFile, PasswordFile, Before: String;
  Code: Integer;
begin
  { What the password file said before: the last page shows the password only when this install
    wrote a new one (a new database). An upgrade keeps the file, and its password is usually changed
    by then. }
  Before := FirstLine(ExpandConstant('{commonappdata}\PeckList\first-admin-password.txt'));
  LogFile := ExpandConstant('{commonappdata}\PeckList\setup-service.log');
  PasswordFile := ExpandConstant('{commonappdata}\PeckList\first-admin-password.txt');
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\setup\setup-service.ps1') + '"' +
    ' -Program "' + ExpandConstant('{app}') + '" -Port ' + IntToStr(ChosenPort) +
    ' -PasswordFile "' + PasswordFile + '" -Log "' + LogFile + '"';
  if (not ServiceExisted) and ((WizardSilent and HasSwitch('OPENFIREWALL')) or ((not WizardSilent) and FirewallBox.Checked)) then
    Params := Params + ' -OpenFirewall';
  WizardForm.StatusLabel.Caption := 'Starting the PeckList service...';
  Started := Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  SetupFailed := not Started;
  if Started then
  begin
    AdminPassword := FirstLine(PasswordFile);
    if AdminPassword = Before then AdminPassword := '';
  end
  else
  begin
    Log('setup-service.ps1 failed with ' + IntToStr(Code) + '; see ' + LogFile);
    if not WizardSilent then
      MsgBox('PeckList is installed, but its service did not start. What went wrong is in ' + LogFile +
        ' and in Event Viewer > Windows Logs > Application.', mbError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  { Locked before the files go in, so none sits in a folder others may write, and again after. }
  if ((CurStep = ssInstall) or (CurStep = ssPostInstall)) and not SetupFailed and not LockProgramFolder then
  begin
    SetupFailed := True;
    if not WizardSilent then
      MsgBox('Could not set the permissions on ' + ExpandConstant('{app}') + ', so the PeckList service was not set up. ' +
        'Install into C:\Program Files, or check the folder, and run the installer again.', mbError, MB_OK);
  end;
  if (CurStep = ssPostInstall) and not SetupFailed and WizardIsComponentSelected('server') then SetUpService;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Text: String;
begin
  if (CurPageID = wpFinished) and Started then
  begin
    Text := 'PeckList is running at ' + ServiceAddress('') + '.';
    if AdminPassword <> '' then
      Text := Text + #13#10#13#10 + 'Sign in as admin with this password, then choose your own:' + #13#10#13#10 +
        '    ' + AdminPassword + #13#10#13#10 +
        'It is also in C:\ProgramData\PeckList\first-admin-password.txt (administrators only), and stops working once you change it.';
    WizardForm.FinishedLabel.Caption := Text;
    WizardForm.FinishedLabel.AutoSize := True;
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := 0;
  if SetupFailed then Result := ServiceFailed;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then RemovePath(ExpandConstant('{app}\bin'));
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{commonappdata}\PeckList');
    { A silent uninstall always keeps the data. }
    if DirExists(Data) and (not UninstallSilent) and
      (MsgBox('PeckList is removed. Also delete its data (the database, snapshots, logs and settings in ' + Data + ')?' + #13#10#13#10 +
        'Choose No to keep it for a later install.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
      { rd removes a junction or link inside without following it. }
      Exec(ExpandConstant('{cmd}'), '/c rd /s /q "' + Data + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
