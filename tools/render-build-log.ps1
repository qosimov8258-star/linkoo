param(
  [string]$LogPath = ".codex-build.log",
  [string]$OutputPath = ".codex-build.png"
)

Add-Type -AssemblyName System.Drawing

$lines = Get-Content -LiteralPath $LogPath -Tail 100
$font = New-Object System.Drawing.Font("Consolas", 14)
$width = 1800
$height = [Math]::Max(600, ($lines.Count + 2) * 21)
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$y = 10

foreach ($line in $lines) {
  $graphics.DrawString($line, $font, [System.Drawing.Brushes]::Black, 10, $y)
  $y += 21
}

$bitmap.Save((Join-Path (Get-Location) $OutputPath), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$font.Dispose()
