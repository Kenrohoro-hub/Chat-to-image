; Compile with scripts/build_installer.py; payload contains only explicit release files.
[Setup]
AppId={{9709967C-228C-4465-BA08-0CE14F65B1F5}
AppName=Chat to image
AppVersion={#AppVersion}
AppPublisher=Chat to image contributors
AppPublisherURL=https://github.com/Kenrohoro-hub/Chat-to-image
AppSupportURL=https://github.com/Kenrohoro-hub/Chat-to-image/issues
DefaultDirName={localappdata}\Programs\Chat to image
DefaultGroupName=Chat to image
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.17763
OutputBaseFilename=Chat-to-image-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
SignTool=chattoimage
SignedUninstaller=yes
UninstallDisplayName=Chat to image
SetupIconFile={#PayloadDir}\dist\app.ico
UninstallDisplayIcon={app}\dist\app.ico
LicenseFile={#PayloadDir}\LICENSE
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "zhcn"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewInstaller}"; Flags: dontcopy

[Icons]
Name: "{group}\Chat to image"; Filename: "{app}\runtime\pythonw.exe"; Parameters: "-B ""{app}\scripts\desktop_app.pyw"""; WorkingDir: "{app}"; IconFilename: "{app}\dist\app.ico"
Name: "{autodesktop}\Chat to image"; Filename: "{app}\runtime\pythonw.exe"; Parameters: "-B ""{app}\scripts\desktop_app.pyw"""; WorkingDir: "{app}"; IconFilename: "{app}\dist\app.ico"; Tasks: desktopicon
Name: "{group}\卸载 Chat to image"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\runtime\pythonw.exe"; Parameters: "-B ""{app}\scripts\desktop_app.pyw"""; Description: "启动 Chat to image"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKCU, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM64, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then Exit;
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := '无法启动 WebView2 离线安装程序。请重新运行安装器。'
  else if (ExitCode <> 0) and (ExitCode <> 3010) then
    Result := Format('WebView2 安装未完成（错误码 %d）。请重新运行安装器。', [ExitCode])
  else begin
    NeedsRestart := ExitCode = 3010;
    if (not NeedsRestart) and (not HasWebView2) then
      Result := '尚未检测到 WebView2 运行时。请重新启动电脑后再次安装。';
  end;
end;
