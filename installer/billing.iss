; Billing Software installer (Inno Setup 6.3 or newer).
; Build:  powershell installer\build.ps1   then   ISCC.exe /DAppVersion=0.2.0 installer\billing.iss
; The GitHub Actions workflow .github/workflows/release.yml does both automatically.

#define AppName "Billing Software"
#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#define ServiceName "BillingSoftware"
#define FirewallRule "Billing Software"

[Setup]
AppId={{8F0C3B52-6B1E-4D0B-9B64-5C2E1F7A9D31}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Akshat Shah
AppPublisherURL=https://github.com/Akshat-Shah04/billing-software
AppSupportURL=https://github.com/Akshat-Shah04/billing-software/issues
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=BillingSoftware-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
SetupIconFile=assets\billing.ico
WizardImageFile=assets\wizard-100.bmp,assets\wizard-125.bmp,assets\wizard-150.bmp,assets\wizard-175.bmp,assets\wizard-200.bmp
WizardSmallImageFile=assets\wizard-small-100.bmp,assets\wizard-small-125.bmp,assets\wizard-small-150.bmp,assets\wizard-small-175.bmp,assets\wizard-small-200.bmp
PrivilegesRequired=admin
; One setup file for every Windows 10 and 11 PC: 64-bit Intel/AMD, ARM (Snapdragon) and 32-bit.
; The matching Node.js is chosen in [Files] below. 64-bit and ARM PCs install into "Program Files".
ArchitecturesInstallIn64BitMode=x64compatible or arm64
; Windows 10 version 1607 (Anniversary Update) or newer, which includes .NET Framework 4.6.2 for the service wrapper.
MinVersion=10.0.14393
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\billing.ico
VersionInfoDescription={#AppName} Setup
CloseApplications=no
SetupLogging=yes
InfoBeforeFile=info-before.txt
InfoAfterFile=info-after.txt
DisableReadyPage=no

[Messages]
WindowsVersionNotSupported=Billing Software needs Windows 10 (version 1607 or newer) or Windows 11. Please update Windows first: Settings > Update & Security > Windows Update.
WelcomeLabel2=This wizard will install [name/ver] on this computer.%n%nBilling Software runs here as a background Windows service. Everyone in the office then uses it from a web browser, so nothing needs to be installed on their computers.%n%nThe next page explains exactly what will be installed and changed. It is recommended that you close other programs before continuing.

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut that opens Billing Software"; GroupDescription: "Shortcuts:"

[Dirs]
Name: "{commonappdata}\BillingSoftware"
Name: "{commonappdata}\BillingSoftware\logs"

[InstallDelete]
; Remove files from an older version before copying the new ones.
Type: filesandordirs; Name: "{app}\server\dist"
Type: filesandordirs; Name: "{app}\server\node_modules"
Type: filesandordirs; Name: "{app}\server\assets"
Type: filesandordirs; Name: "{app}\client\dist"
Type: filesandordirs; Name: "{app}\node"

[Files]
; Exactly one Node.js is installed, the one that runs natively on this PC.
Source: "staging\node\arm64\*"; DestDir: "{app}\node"; Check: UseNodeArm64; Flags: ignoreversion
Source: "staging\node\x64\*"; DestDir: "{app}\node"; Check: UseNodeX64; Flags: ignoreversion
Source: "staging\node\x86\*"; DestDir: "{app}\node"; Check: UseNodeX86; Flags: ignoreversion
Source: "staging\server\*"; DestDir: "{app}\server"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "staging\client\*"; DestDir: "{app}\client"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "staging\service\*"; DestDir: "{app}\service"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "tools\*"; DestDir: "{app}\tools"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "assets\billing.ico"; DestDir: "{app}"; Flags: ignoreversion

[INI]
Filename: "{app}\Billing Software.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{code:GetPort}"
Filename: "{app}\Billing Software.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\billing.ico"
Filename: "{app}\Billing Software.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"

[Icons]
Name: "{group}\Open Billing Software"; Filename: "{app}\Billing Software.url"; IconFilename: "{app}\billing.ico"
Name: "{group}\Backups folder"; Filename: "{commonappdata}\BillingSoftware\backups"
Name: "{group}\Log files"; Filename: "{commonappdata}\BillingSoftware\logs"
Name: "{group}\Uninstall Billing Software"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Billing Software"; Filename: "{app}\Billing Software.url"; IconFilename: "{app}\billing.ico"; Tasks: desktopicon

[Run]
Filename: "http://localhost:{code:GetPort}"; Description: "Open Billing Software now"; Flags: postinstall shellexec skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\Billing Software.url"
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\service"
Type: dirifempty; Name: "{app}"

[Code]
var
  PortPage: TInputQueryWizardPage;
  ClientDirPage: TInputDirWizardPage;
  AdminPage: TInputQueryWizardPage;
  ExistingData: Boolean;

// ---- Which Node.js to install ----
function UseNodeArm64: Boolean;
begin
  Result := IsArm64;
end;

function UseNodeX64: Boolean;
begin
  Result := IsWin64 and not IsArm64;
end;

function UseNodeX86: Boolean;
begin
  Result := not IsWin64;
end;

function DataDir: String;
begin
  Result := ExpandConstant('{commonappdata}\BillingSoftware');
end;

function RunHidden(const FileName, Params, WorkDir: String): Integer;
var
  ResultCode: Integer;
begin
  if not Exec(FileName, Params, WorkDir, SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    ResultCode := -1;
  Result := ResultCode;
end;

// True when another program is already listening on this TCP port. Reads netstat's numeric columns only,
// because the state words ("LISTENING") are translated on non-English Windows.
function PortInUse(Port: Integer): Boolean;
var
  Tmp: String;
  Lines: TArrayOfString;
  I, Code: Integer;
begin
  Result := False;
  Tmp := ExpandConstant('{tmp}\netstat.txt');
  if not Exec(ExpandConstant('{cmd}'), '/C netstat -ano -p TCP > "' + Tmp + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) then Exit;
  if not LoadStringsFromFile(Tmp, Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
    // A listening socket has this port as its local address and ":0" as its remote address.
    if (Pos(':' + IntToStr(Port) + ' ', Lines[I]) > 0) and (Pos(':0 ', Lines[I]) > 0) then
    begin
      Result := True;
      Exit;
    end;
end;

// Waits until the server answers on /api/health (the first start creates the database, which takes a few seconds).
function WaitForServer(Port: String; Seconds: Integer): Boolean;
var
  Http: Variant;
  I: Integer;
begin
  Result := False;
  for I := 1 to Seconds do
  begin
    try
      Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
      Http.SetTimeouts(1000, 1000, 1000, 2000);
      Http.Open('GET', 'http://127.0.0.1:' + Port + '/api/health', False);
      Http.Send('');
      if Http.Status = 200 then
      begin
        Result := True;
        Exit;
      end;
    except
    end;
    Sleep(1000);
  end;
end;

function SavedPort: String;
var
  Saved: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(DataDir + '\port.txt', Saved) then Result := Trim(String(Saved));
end;

function GetPort(Param: String): String;
begin
  Result := Trim(PortPage.Values[0]);
end;

function XmlEscape(S: String): String;
begin
  StringChangeEx(S, '&', '&amp;', True);
  Result := S;
end;

function Slashes(S: String): String;
begin
  StringChangeEx(S, '\', '/', True);
  Result := S;
end;

function IsSafeUsernameChar(C: Char): Boolean;
begin
  Result := ((C >= 'a') and (C <= 'z')) or ((C >= '0') and (C <= '9')) or (C = '.') or (C = '_') or (C = '-');
end;

function GetClientDir: String;
begin
  Result := RemoveBackslashUnlessRoot(Trim(ClientDirPage.Values[0]));
end;

procedure InitializeWizard;
var
  Saved, SavedDir: AnsiString;
begin
  ExistingData := DirExists(DataDir + '\db');

  PortPage := CreateInputQueryPage(wpSelectTasks,
    'Network settings',
    'Choose the port other computers will use to reach Billing Software',
    'Staff open Billing Software in a web browser using this computer''s name followed by a port number, ' +
    'for example http://OFFICE-PC:4000.' + #13#10 + #13#10 +
    'Keep 4000 unless another program on this computer already uses it. A number between 1024 and 65535 is best. ' +
    'The installer will allow this port through Windows Firewall for private and domain networks only.');
  PortPage.Add('Port number:', False);
  PortPage.Values[0] := '4000';
  if LoadStringFromFile(DataDir + '\port.txt', Saved) then
    if StrToIntDef(Trim(String(Saved)), 0) > 0 then
      PortPage.Values[0] := Trim(String(Saved));

  ClientDirPage := CreateInputDirPage(PortPage.ID,
    'Client folders',
    'Where should each client''s folder be kept?',
    'Billing Software keeps a folder for every client, named after the client. Each folder holds the client''s ' +
    'details and a printable copy of every bill, and is updated automatically whenever something changes. ' +
    'It is a second, human-readable copy of your records that you can open, copy to a USB drive or send to the client.' + #13#10 + #13#10 +
    'Choose a folder on this computer. The default is visible to everyone who uses this computer. ' +
    'To choose a different folder, click Browse. Folders are never deleted by Billing Software or by the uninstaller.',
    False, '');
  ClientDirPage.Add('');
  ClientDirPage.Values[0] := ExpandConstant('{commondocs}\Billing Software Client Files');
  if LoadStringFromFile(DataDir + '\client-files-dir.txt', SavedDir) then
    if Trim(String(SavedDir)) <> '' then
      ClientDirPage.Values[0] := Trim(String(SavedDir));

  AdminPage := CreateInputQueryPage(ClientDirPage.ID,
    'Administrator account',
    'Create the first administrator login',
    'The administrator can create accounts for the rest of the staff and change the organisation settings.' + #13#10 + #13#10 +
    'Username: 3 to 30 characters, lowercase letters, numbers, dot, dash or underscore.' + #13#10 +
    'Password: at least 8 characters, keyboard characters only. Write it down and keep it safe, ' +
    'because there is no "forgot password" option for the administrator.');
  AdminPage.Add('Full name:', False);
  AdminPage.Add('Username:', False);
  AdminPage.Add('Password:', True);
  AdminPage.Add('Confirm password:', True);
  AdminPage.Values[1] := 'admin';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // On an upgrade the administrator already exists in the kept database.
  Result := (PageID = AdminPage.ID) and ExistingData;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port, I: Integer;
  User, Pass: String;
begin
  Result := True;

  if CurPageID = PortPage.ID then
  begin
    Port := StrToIntDef(Trim(PortPage.Values[0]), 0);
    if (Port < 1) or (Port > 65535) then
    begin
      MsgBox('Please enter a port number between 1 and 65535 (for example 4000).', mbError, MB_OK);
      Result := False;
    end
    // On an upgrade the old Billing Software service is still using its own port, which is fine.
    else if (IntToStr(Port) <> SavedPort) and PortInUse(Port) then
    begin
      if MsgBox('Another program on this computer is already using port ' + IntToStr(Port) + '.' + #13#10 + #13#10 +
                'Billing Software would not be able to start on it. Choose another number, for example 4100 or 8040.' + #13#10 + #13#10 +
                'Use port ' + IntToStr(Port) + ' anyway?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDNO then
        Result := False;
    end;
  end;

  if CurPageID = ClientDirPage.ID then
  begin
    if (Trim(ClientDirPage.Values[0]) = '') or (Length(ExtractFilePath(AddBackslash(GetClientDir))) < 4) then
    begin
      MsgBox('Please choose a folder, not just a drive (for example C:\Users\Public\Documents\Billing Software Client Files).', mbError, MB_OK);
      Result := False;
    end
    else if not ForceDirectories(GetClientDir) then
    begin
      MsgBox('That folder could not be created. Please choose another folder.', mbError, MB_OK);
      Result := False;
    end;
  end;

  if CurPageID = AdminPage.ID then
  begin
    User := Trim(AdminPage.Values[1]);
    Pass := AdminPage.Values[2];

    if Trim(AdminPage.Values[0]) = '' then
    begin
      MsgBox('Please enter the administrator''s full name.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Pos('"', AdminPage.Values[0]) > 0 then
    begin
      MsgBox('The full name cannot contain a double quote character.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (Length(User) < 3) or (Length(User) > 30) then
    begin
      MsgBox('The username must be 3 to 30 characters long.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    for I := 1 to Length(User) do
      if not IsSafeUsernameChar(User[I]) then
      begin
        MsgBox('The username can only contain lowercase letters, numbers, dot, dash and underscore.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
    if Length(Pass) < 8 then
    begin
      MsgBox('The password must be at least 8 characters long.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    for I := 1 to Length(Pass) do
      if (Ord(Pass[I]) < 32) or (Ord(Pass[I]) > 126) then
      begin
        MsgBox('The password can only use normal keyboard characters (letters, numbers and symbols).', mbError, MB_OK);
        Result := False;
        Exit;
      end;
    if Pass <> AdminPage.Values[3] then
    begin
      MsgBox('The two passwords do not match. Please type them again.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  S: String;
begin
  S := 'Program files:' + NewLine + Space + WizardDirValue + NewLine + NewLine;
  S := S + 'Data folder (database, backups, logs):' + NewLine + Space + DataDir + NewLine;
  if ExistingData then
    S := S + Space + 'Existing data was found and will be KEPT.' + NewLine + NewLine
  else
    S := S + Space + 'A new, empty database will be created.' + NewLine + NewLine;

  S := S + 'Client folders (details and bills of every client, one folder per client):' + NewLine +
       Space + GetClientDir + NewLine +
       Space + 'These folders are never deleted by Billing Software or by the uninstaller.' + NewLine + NewLine;

  S := S + 'Network:' + NewLine +
       Space + 'Port ' + Trim(PortPage.Values[0]) + NewLine +
       Space + 'This computer: http://localhost:' + Trim(PortPage.Values[0]) + NewLine +
       Space + 'Other computers: http://' + GetComputerNameString + ':' + Trim(PortPage.Values[0]) + NewLine + NewLine;

  if ExistingData then
    S := S + 'Administrator:' + NewLine + Space + 'The existing accounts are kept. No new account will be created.' + NewLine + NewLine
  else
    S := S + 'First administrator:' + NewLine +
         Space + 'Name: ' + Trim(AdminPage.Values[0]) + NewLine +
         Space + 'Username: ' + Lowercase(Trim(AdminPage.Values[1])) + NewLine +
         Space + 'Password: (the one you typed, hidden)' + NewLine + NewLine;

  S := S + 'Windows service:' + NewLine +
       Space + 'Name: Billing Software (service id {#ServiceName})' + NewLine +
       Space + 'Starts automatically with Windows and restarts itself if it stops unexpectedly.' + NewLine + NewLine;

  S := S + 'Windows Firewall:' + NewLine +
       Space + 'Adds an inbound rule "{#FirewallRule}" for TCP port ' + Trim(PortPage.Values[0]) + NewLine +
       Space + 'Applies to private and domain networks only, not public networks.' + NewLine + NewLine;

  S := S + 'Backups:' + NewLine +
       Space + 'A backup is made at startup and every 24 hours in ' + DataDir + '\backups' + NewLine +
       Space + 'The 14 most recent backups are kept. After installing, add a second location' + NewLine +
       Space + '(USB drive, network or cloud folder) in Settings > Backups.' + NewLine + NewLine;

  S := S + 'This computer:' + NewLine + Space;
  if IsArm64 then
    S := S + 'Windows on ARM: the ARM version of Node.js will be installed.'
  else if IsWin64 then
    S := S + '64-bit Windows: the 64-bit version of Node.js will be installed.'
  else
    S := S + '32-bit Windows: the 32-bit version of Node.js will be installed.';
  S := S + NewLine + NewLine;

  if MemoTasksInfo <> '' then
    S := S + MemoTasksInfo + NewLine + NewLine;

  S := S + 'Click Install to continue, or Back to change anything above.';
  Result := S;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Svc: String;
begin
  Result := '';
  Svc := ExpandConstant('{app}\service\billing-service.exe');
  if FileExists(Svc) then
  begin
    // Upgrading: the old service must be stopped before its files are replaced.
    WizardForm.PreparingLabel.Caption := 'Stopping the existing Billing Software service...';
    RunHidden(Svc, 'stop', '');
    RunHidden(Svc, 'uninstall', '');
  end;
end;

procedure WriteConfigFiles;
var
  App, Data, Port, Xml, Env: String;
begin
  App := ExpandConstant('{app}');
  Data := DataDir;
  Port := Trim(PortPage.Values[0]);

  SaveStringToFile(Data + '\port.txt', Port, False);
  SaveStringToFile(Data + '\client-files-dir.txt', GetClientDir, False);

  // Read by the server (and by the seed/restore tools) from its working directory.
  Env := 'NODE_ENV=production' + #13#10 +
         'PORT=' + Port + #13#10 +
         'DATA_DIR=' + Slashes(Data) + #13#10 +
         'DATABASE_URL=pglite:' + Slashes(Data) + '/db' + #13#10 +
         'CLIENT_FILES_DIR=' + Slashes(GetClientDir) + #13#10;
  SaveStringToFile(App + '\server\.env', Env, False);

  Xml := '<service>' + #13#10 +
         '  <id>{#ServiceName}</id>' + #13#10 +
         '  <name>Billing Software</name>' + #13#10 +
         '  <description>Billing Software web server for the office network.</description>' + #13#10 +
         '  <executable>' + XmlEscape(App) + '\node\node.exe</executable>' + #13#10 +
         '  <arguments>dist\index.js</arguments>' + #13#10 +
         '  <workingdirectory>' + XmlEscape(App) + '\server</workingdirectory>' + #13#10 +
         '  <startmode>Automatic</startmode>' + #13#10 +
         '  <onfailure action="restart" delay="10 sec"/>' + #13#10 +
         '  <onfailure action="restart" delay="30 sec"/>' + #13#10 +
         '  <resetfailure>1 hour</resetfailure>' + #13#10 +
         '  <stoptimeout>20 sec</stoptimeout>' + #13#10 +
         '  <logpath>' + XmlEscape(Data) + '\logs</logpath>' + #13#10 +
         '  <log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>5</keepFiles></log>' + #13#10 +
         '</service>' + #13#10;
  SaveStringToFile(App + '\service\billing-service.xml', Xml, False);
end;

procedure CreateAdminAccount;
var
  App, PwFile: String;
  Code: Integer;
begin
  App := ExpandConstant('{app}');
  PwFile := ExpandConstant('{tmp}\admin-password.txt');
  // The password goes through a temporary file, never on a command line.
  SaveStringToFile(PwFile, AdminPage.Values[2], False);
  Code := RunHidden(App + '\node\node.exe',
    'dist\scripts\seed.js --username "' + Lowercase(Trim(AdminPage.Values[1])) +
    '" --full-name "' + Trim(AdminPage.Values[0]) +
    '" --password-file "' + PwFile + '"',
    App + '\server');
  DeleteFile(PwFile);
  if Code <> 0 then
    MsgBox('The administrator account could not be created (error code ' + IntToStr(Code) + ').' + #13#10 + #13#10 +
           'Billing Software was installed, but you will not be able to log in. ' +
           'Please run the installer again, or ask for help on the project''s GitHub page.', mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Svc, Port: String;
begin
  if CurStep = ssPostInstall then
  begin
    Svc := ExpandConstant('{app}\service\billing-service.exe');
    Port := Trim(PortPage.Values[0]);

    WizardForm.StatusLabel.Caption := 'Writing configuration...';
    WriteConfigFiles;

    if not ExistingData then
    begin
      WizardForm.StatusLabel.Caption := 'Creating the database and the administrator account...';
      CreateAdminAccount;
    end;

    WizardForm.StatusLabel.Caption := 'Allowing the network port through Windows Firewall...';
    RunHidden(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="{#FirewallRule}"', '');
    RunHidden(ExpandConstant('{sys}\netsh.exe'),
      'advfirewall firewall add rule name="{#FirewallRule}" dir=in action=allow protocol=TCP localport=' + Port +
      ' profile=private,domain', '');

    WizardForm.StatusLabel.Caption := 'Installing and starting the Billing Software service...';
    RunHidden(Svc, 'install', '');
    if RunHidden(Svc, 'start', '') <> 0 then
      MsgBox('The Billing Software service was installed but could not be started right now.' + #13#10 + #13#10 +
             'Restart the computer, or open "Services" in Windows and start "Billing Software". ' +
             'If it still does not start, look in ' + DataDir + '\logs for the reason.', mbError, MB_OK)
    else
    begin
      WizardForm.StatusLabel.Caption := 'Waiting for Billing Software to start (the first start sets up the database)...';
      if not WaitForServer(Port, 90) then
        MsgBox('The Billing Software service started, but it is not answering on port ' + Port + ' yet.' + #13#10 + #13#10 +
               'Wait a minute and open http://localhost:' + Port + ' in your browser. If it still does not open, ' +
               'look in ' + DataDir + '\logs for the reason, or run this installer again and choose another port.',
               mbInformation, MB_OK);
    end;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption :=
      'Billing Software is installed and running.' + #13#10 + #13#10 +
      'On this computer open:' + #13#10 +
      '    http://localhost:' + GetPort('') + #13#10 + #13#10 +
      'On other computers in the office open:' + #13#10 +
      '    http://' + GetComputerNameString + ':' + GetPort('') + #13#10 + #13#10 +
      'Each client''s folder (details and bills) is kept in:' + #13#10 +
      '    ' + GetClientDir + #13#10 + #13#10 +
      'Daily database backups are saved in ' + DataDir + '\backups. In Settings > Backups, add a second ' +
      'location (a USB drive or a cloud folder) so a copy survives if this computer fails.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Svc: String;
  ClientDirSaved: AnsiString;
begin
  if CurUninstallStep = usUninstall then
  begin
    Svc := ExpandConstant('{app}\service\billing-service.exe');
    if FileExists(Svc) then
    begin
      RunHidden(Svc, 'stop', '');
      RunHidden(Svc, 'uninstall', '');
    end;
    RunHidden(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="{#FirewallRule}"', '');
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    if not LoadStringFromFile(DataDir + '\client-files-dir.txt', ClientDirSaved) then
      ClientDirSaved := '(the client folders location)';
    if DirExists(DataDir) then
      if MsgBox('Billing Software has been removed.' + #13#10 + #13#10 +
                'Do you also want to permanently delete all of its data (the database, your backups and the logs) in ' +
                DataDir + '?' + #13#10 + #13#10 +
                'Your client folders in ' + Trim(String(ClientDirSaved)) + ' are NOT deleted either way.' + #13#10 + #13#10 +
                'This cannot be undone. Choose No to keep your data.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
