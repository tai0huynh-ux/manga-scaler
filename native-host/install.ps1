param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$hostName = "com.universal_ai_image_enhancer.launcher"
$hostPath = (Resolve-Path (Join-Path $PSScriptRoot "run-host.cmd")).Path
$manifestPath = Join-Path $PSScriptRoot "$hostName.json"
$manifest = @{
  name = $hostName
  description = "Starts the Universal AI Image Enhancer backend"
  path = $hostPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

$targets = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)
foreach ($target in $targets) {
  New-Item -Path $target -Force | Out-Null
  Set-Item -Path $target -Value $manifestPath
}
Write-Host "Native host installed for extension $ExtensionId"
