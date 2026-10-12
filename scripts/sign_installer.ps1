[CmdletBinding(DefaultParameterSetName = 'Prepare')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Prepare')]
  [string]$ExportPath,
  [Parameter(Mandatory, ParameterSetName = 'Sign')]
  [string]$FilePath,
  [Parameter(Mandatory, ParameterSetName = 'Sign')]
  [string]$CertificateThumbprint,
  [Parameter(ParameterSetName = 'Sign')]
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }

if ($PSCmdlet.ParameterSetName -eq 'Prepare') {
  $certificates = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
    $_.Subject -eq 'CN=Chat to image' -and $_.FriendlyName -eq 'Chat to image installer self-signing' -and $_.HasPrivateKey
  })
  if ($certificates.Count -gt 1) { throw 'Multiple installer signing certificates found; select the intended certificate in the Windows certificate manager.' }
  $certificate = $certificates | Select-Object -First 1
  if (-not $certificate) {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Chat to image' `
      -FriendlyName 'Chat to image installer self-signing' -CertStoreLocation 'Cert:\CurrentUser\My' `
      -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable `
      -NotAfter (Get-Date).AddYears(3)
  }
} else {
  if ($CertificateThumbprint -notmatch '^[0-9A-Fa-f]{40}$') { throw 'Invalid certificate thumbprint.' }
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
  if (-not $certificate.HasPrivateKey) { throw 'The signing certificate has no private key.' }
}

if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) {
  throw 'The signing certificate is outside its validity period; renew it before building.'
}

if ($PSCmdlet.ParameterSetName -eq 'Prepare') {
  Export-Certificate -Cert $certificate -FilePath $ExportPath -Type CERT -Force | Out-Null
  Write-Output $certificate.Thumbprint
} else {
  if (-not $VerifyOnly) {
    Set-AuthenticodeSignature -LiteralPath $FilePath -Certificate $certificate -HashAlgorithm SHA256 | Out-Null
  }
  if (-not ('ChatToImage.Authenticode' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace ChatToImage {
  public static class Authenticode {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FileInfo {
      public uint Size;
      [MarshalAs(UnmanagedType.LPWStr)] public string Path;
      public IntPtr Handle, Subject;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct TrustData {
      public uint Size;
      public IntPtr Policy, Sip;
      public uint Ui, Revocation, Choice;
      public IntPtr File;
      public uint StateAction;
      public IntPtr State, Url;
      public uint Flags, Context;
      public IntPtr Settings;
    }
    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern uint WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);
    public static uint Verify(string path) {
      var file = new FileInfo { Size = (uint)Marshal.SizeOf<FileInfo>(), Path = path };
      var pointer = Marshal.AllocHGlobal(Marshal.SizeOf<FileInfo>());
      try {
        Marshal.StructureToPtr(file, pointer, false);
        var data = new TrustData { Size = (uint)Marshal.SizeOf<TrustData>(), Ui = 2,
          Choice = 1, File = pointer, Flags = 0x1000 };
        var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
        return WinVerifyTrust(new IntPtr(-1), ref action, ref data);
      } finally {
        Marshal.DestroyStructure<FileInfo>(pointer);
        Marshal.FreeHGlobal(pointer);
      }
    }
  }
}
"@
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
  $status = [ChatToImage.Authenticode]::Verify((Get-Item -LiteralPath $FilePath).FullName)
  # PowerShell 将不受信任的根证书也归入 UnknownError，因此按原生错误码精确区分。
  if ($signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or $status -notin @(0, 0x800B0109u)) {
    throw ('Signature verification failed: 0x{0:X8}' -f $status)
  }
  Write-Output ('Verified: {0} (0x{1:X8})' -f [IO.Path]::GetFileName($FilePath), $status)
}
