# Reads the text in one image with the OCR engine built into Windows 10/11
# (Windows.Media.Ocr). No install, no account, no key: it ships with the OS.
# Prints one JSON array of lines, each { text, x, y, w, h } in image pixels.
#
#   powershell -NoProfile -File scripts/lib/ocr.ps1 <image.png|jpg|bmp>
#
# Called by scripts/find-event-art.mjs --apply, which is the only reason it
# exists: Kuro set a patch's event names as type inside a picture, and this is
# the one free way to read them back.
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"
# Kuro's titles use curly apostrophes. Through the console's legacy code page
# one comes out as a control byte and the JSON no longer parses.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

# WinRT hands back IAsyncOperation; Windows PowerShell 5.1 can only wait on a
# Task, so bridge through the AsTask extension.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait() | Out-Null
  $t.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Path).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en"))
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw "no English OCR language on this machine" }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$lines = foreach ($line in $result.Lines) {
  $r = $line.Words | ForEach-Object { $_.BoundingRect }
  $x = ($r | Measure-Object X -Minimum).Minimum
  $y = ($r | Measure-Object Y -Minimum).Minimum
  $x2 = ($r | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
  $y2 = ($r | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
  [pscustomobject]@{ text = $line.Text; x = [int]$x; y = [int]$y; w = [int]($x2 - $x); h = [int]($y2 - $y) }
}
$stream.Dispose()
ConvertTo-Json -InputObject @($lines) -Compress
