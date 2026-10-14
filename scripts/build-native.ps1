$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frameworkPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compilerPath = Join-Path $frameworkPath 'csc.exe'
if (!(Test-Path -LiteralPath $compilerPath)) { throw '.NET Framework 4.x C# compiler is required on the build machine.' }
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'native-bin') -Force | Out-Null
$references = @('System.dll','System.Core.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','WPF\UIAutomationClient.dll','WPF\UIAutomationTypes.dll','WPF\WindowsBase.dll','WPF\System.Speech.dll')
$compilerArgs = @('/nologo','/target:exe','/platform:x64','/optimize+','/utf8output',('/out:' + (Join-Path $projectRoot 'native-bin\SelectionHelper.exe')))
$compilerArgs += $references | ForEach-Object { '/reference:' + (Join-Path $frameworkPath $_) }
$compilerArgs += Join-Path $projectRoot 'src\native\windows\SelectionHelper.cs'
& $compilerPath @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed.' }

# Original Union Jack icon, drawn locally; no downloaded artwork.
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $projectRoot 'assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$blue = [System.Drawing.ColorTranslator]::FromHtml('#172d68')
$red = [System.Drawing.ColorTranslator]::FromHtml('#e65e63')
$blueBrush = New-Object System.Drawing.SolidBrush $blue
$redBrush = New-Object System.Drawing.SolidBrush $red
$graphics.FillRectangle($blueBrush,16,40,224,160)
$whitePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),36
$redPen = New-Object System.Drawing.Pen $red,12
$graphics.SetClip((New-Object System.Drawing.Rectangle 16,40,224,160))
$graphics.DrawLine($whitePen,16,40,240,200)
$graphics.DrawLine($whitePen,16,200,240,40)
$graphics.DrawLine($redPen,16,40,240,200)
$graphics.DrawLine($redPen,16,200,240,40)
$graphics.FillRectangle([System.Drawing.Brushes]::White,16,96,224,48)
$graphics.FillRectangle([System.Drawing.Brushes]::White,104,40,48,160)
$graphics.FillRectangle($redBrush,16,108,224,24)
$graphics.FillRectangle($redBrush,116,40,24,160)
$graphics.ResetClip()
$bitmap.Save((Join-Path $assetDirectory 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$stream = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$blueBrush.Dispose()
$redBrush.Dispose()
$whitePen.Dispose()
$redPen.Dispose()
