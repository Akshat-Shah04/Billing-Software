<#
  Draws the app icon and the installer wizard pictures, so they match the app's mark
  (a white receipt on a blue rounded square, client/src/components/BrandMark.tsx).

  Writes into installer\assets:
    billing.ico            app / setup / shortcut icon (16 to 256 px)
    wizard-100.bmp ...     the tall picture on the wizard's Welcome and Finish pages (100% to 200% DPI)
    wizard-small-100.bmp   the small picture at the top right of the other pages

  Run it again only when the artwork changes:   powershell -ExecutionPolicy Bypass -File installer\make-art.ps1
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Out = Join-Path $PSScriptRoot "assets"
New-Item -ItemType Directory -Force $Out | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Draws the mark into a square of side $s at ($ox, $oy). Coordinates follow the 64-unit SVG.
function Draw-Mark([System.Drawing.Graphics]$g, [float]$ox, [float]$oy, [float]$s) {
  $k = $s / 64.0
  $bg = New-RoundedPath $ox $oy $s $s (14.5 * $k)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF($ox, $oy)), (New-Object System.Drawing.PointF($ox, ($oy + $s))),
    [System.Drawing.Color]::FromArgb(255, 59, 155, 255), [System.Drawing.Color]::FromArgb(255, 0, 98, 214))
  $g.FillPath($grad, $bg)

  # Receipt with a zig-zag bottom edge
  $pts = @(
    @(20, 14), @(44, 14), @(44, 50), @(40, 47), @(36, 50), @(32, 47), @(28, 50), @(24, 47), @(20, 50)
  ) | ForEach-Object { New-Object System.Drawing.PointF(($ox + $_[0] * $k), ($oy + $_[1] * $k)) }
  $g.FillPolygon([System.Drawing.Brushes]::White, [System.Drawing.PointF[]]$pts)

  if ($s -ge 24) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 10, 111, 224), [float](2.6 * $k))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, ($ox + 25 * $k), ($oy + 23 * $k), ($ox + 39 * $k), ($oy + 23 * $k))
    $g.DrawLine($pen, ($ox + 25 * $k), ($oy + 29 * $k), ($ox + 39 * $k), ($oy + 29 * $k))
    $g.DrawLine($pen, ($ox + 25 * $k), ($oy + 35 * $k), ($ox + 33 * $k), ($oy + 35 * $k))
  }
}

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @($bmp, $g)
}

# ---------- Icon: PNG-compressed frames in one .ico ----------
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = foreach ($s in $sizes) {
  $bmp, $g = New-Canvas $s $s
  # A hair of padding at small sizes, as Windows icons have.
  $pad = [math]::Max(0, [math]::Round($s / 32.0))
  Draw-Mark $g $pad $pad ($s - 2 * $pad)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  if ($s -ge 256) {
    # The 256 px frame is stored as PNG (the standard for large icons).
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    # Smaller frames are classic 32-bit bitmaps, which every Windows API and tool can read.
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([uint32]40); $bw.Write([int32]$s); $bw.Write([int32]($s * 2))
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
    $maskStride = [int]([math]::Ceiling($s / 32.0) * 4)
    $bw.Write([uint32]($s * $s * 4 + $maskStride * $s))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    for ($y = $s - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $s; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
      }
    }
    $bw.Write((New-Object byte[] ($maskStride * $s))) # AND mask: all zero, alpha does the work
    $bw.Flush()
  }
  $bmp.Dispose()
  , $ms.ToArray()
}
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $Out "billing.ico"), $ico.ToArray())

# ---------- Wizard pictures (24-bit BMP, as Inno Setup expects) ----------
function Save-Bmp24($bmp, $path) {
  $flat = New-Object System.Drawing.Bitmap($bmp.Width, $bmp.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($flat)
  $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
  $g.Dispose()
  $flat.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $flat.Dispose()
}

# Tall picture: soft system-grey background, the mark, the name. Calm, one element, lots of space.
foreach ($scale in 100, 125, 150, 175, 200) {
  $W = [int][math]::Round(164 * $scale / 100); $H = [int][math]::Round(314 * $scale / 100); $k = $scale / 100.0
  $bmp, $g = New-Canvas $W $H
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.PointF(0, $H)),
    [System.Drawing.Color]::FromArgb(255, 245, 247, 251), [System.Drawing.Color]::FromArgb(255, 226, 234, 247))
  $g.FillRectangle($bgBrush, 0, 0, $W, $H)
  $m = 72 * $k
  Draw-Mark $g (($W - $m) / 2) (92 * $k) $m
  $font = New-Object System.Drawing.Font("Segoe UI Semibold", [float](11.5 * $k), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $font2 = New-Object System.Drawing.Font("Segoe UI", [float](9.5 * $k), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString("Billing Software", $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 29, 29, 31))), (New-Object System.Drawing.RectangleF(0, (178 * $k), $W, (20 * $k))), $fmt)
  $g.DrawString("Bills, payments and clients", $font2, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 110, 110, 115))), (New-Object System.Drawing.RectangleF(0, (196 * $k), $W, (18 * $k))), $fmt)
  $g.Dispose()
  Save-Bmp24 $bmp (Join-Path $Out "wizard-$scale.bmp")
  $bmp.Dispose()
}

# Small picture (top right of inner pages): just the mark on white.
foreach ($scale in 100, 125, 150, 175, 200) {
  $S = [int][math]::Round(55 * $scale / 100)
  $bmp, $g = New-Canvas $S $S
  $g.Clear([System.Drawing.Color]::White)
  $m = [math]::Round($S * 0.8)
  Draw-Mark $g (($S - $m) / 2) (($S - $m) / 2) $m
  $g.Dispose()
  Save-Bmp24 $bmp (Join-Path $Out "wizard-small-$scale.bmp")
  $bmp.Dispose()
}

Write-Host "Artwork written to $Out"
