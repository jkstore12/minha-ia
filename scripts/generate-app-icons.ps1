Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Save-IconPng {
  param(
    [int]$Size,
    [string]$Path
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::FromArgb(255, 5, 7, 11))

  $background = New-RoundedRectanglePath 0 0 $Size $Size ($Size * 0.22)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new(0, 0, $Size, $Size),
    [System.Drawing.Color]::FromArgb(255, 6, 8, 13),
    [System.Drawing.Color]::FromArgb(255, 20, 25, 34),
    45
  )
  $graphics.FillPath($gradient, $background)

  for ($i = 0; $i -lt 9; $i++) {
    $alpha = [Math]::Max(8, 58 - ($i * 6))
    $diameter = $Size * (0.38 + ($i * 0.085))
    $x = ($Size * 0.58) - ($diameter / 2)
    $y = ($Size * 0.48) - ($diameter / 2)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, 0, 232, 174))
    $graphics.FillEllipse($brush, $x, $y, $diameter, $diameter)
    $brush.Dispose()
  }

  for ($i = 0; $i -lt 7; $i++) {
    $alpha = [Math]::Max(6, 42 - ($i * 5))
    $diameter = $Size * (0.30 + ($i * 0.075))
    $x = ($Size * 0.42) - ($diameter / 2)
    $y = ($Size * 0.62) - ($diameter / 2)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, 63, 140, 255))
    $graphics.FillEllipse($brush, $x, $y, $diameter, $diameter)
    $brush.Dispose()
  }

  $orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(110, 25, 241, 194), [Math]::Max(2, $Size * 0.022))
  $orbitPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $orbitPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $orbitRect = [System.Drawing.RectangleF]::new($Size * 0.22, $Size * 0.24, $Size * 0.56, $Size * 0.54)
  $graphics.DrawArc($orbitPen, $orbitRect, 206, 244)

  $glowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(105, 0, 240, 190), [Math]::Max(8, $Size * 0.16))
  $glowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $mainPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 248, 250, 252), [Math]::Max(7, $Size * 0.095))
  $mainPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $mainPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $mainPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $points = @(
    [System.Drawing.PointF]::new($Size * 0.27, $Size * 0.70),
    [System.Drawing.PointF]::new($Size * 0.42, $Size * 0.31),
    [System.Drawing.PointF]::new($Size * 0.53, $Size * 0.58),
    [System.Drawing.PointF]::new($Size * 0.72, $Size * 0.31)
  )
  $graphics.DrawLines($glowPen, $points)
  $graphics.DrawLines($mainPen, $points)

  $baseGlow = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 63, 140, 255), [Math]::Max(7, $Size * 0.09))
  $baseGlow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $baseGlow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $basePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 230, 246, 255), [Math]::Max(4, $Size * 0.052))
  $basePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $basePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($baseGlow, $Size * 0.36, $Size * 0.72, $Size * 0.70, $Size * 0.72)
  $graphics.DrawLine($basePen, $Size * 0.36, $Size * 0.72, $Size * 0.70, $Size * 0.72)

  $dotGlow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(75, 0, 242, 196))
  $graphics.FillEllipse($dotGlow, $Size * 0.675, $Size * 0.185, $Size * 0.17, $Size * 0.17)
  $dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 25, 241, 194))
  $graphics.FillEllipse($dotBrush, $Size * 0.715, $Size * 0.225, $Size * 0.09, $Size * 0.09)

  $borderPath = New-RoundedRectanglePath ($Size * 0.035) ($Size * 0.035) ($Size * 0.93) ($Size * 0.93) ($Size * 0.19)
  $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(55, 255, 255, 255), [Math]::Max(1, $Size * 0.01))
  $graphics.DrawPath($borderPen, $borderPath)

  New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose()
  $borderPath.Dispose()
  $dotBrush.Dispose()
  $dotGlow.Dispose()
  $basePen.Dispose()
  $baseGlow.Dispose()
  $mainPen.Dispose()
  $glowPen.Dispose()
  $orbitPen.Dispose()
  $gradient.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Convert-PngsToIco {
  param(
    [string[]]$PngPaths,
    [string]$IcoPath
  )

  $entries = @()
  foreach ($pngPath in $PngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($pngPath)
    $image = [System.Drawing.Image]::FromFile($pngPath)
    $entries += [PSCustomObject]@{
      Width = [int]$image.Width
      Height = [int]$image.Height
      Bytes = $bytes
    }
    $image.Dispose()
  }

  $stream = [System.IO.File]::Create($IcoPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$entries.Count)

  $offset = 6 + (16 * $entries.Count)
  foreach ($entry in $entries) {
    $writer.Write([byte]$(if ($entry.Width -ge 256) { 0 } else { $entry.Width }))
    $writer.Write([byte]$(if ($entry.Height -ge 256) { 0 } else { $entry.Height }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
  }

  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }

  $writer.Dispose()
  $stream.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$public = Join-Path $root "public"
$app = Join-Path $root "src/app"

Save-IconPng 512 (Join-Path $public "icon-512.png")
Save-IconPng 192 (Join-Path $public "icon-192.png")
Save-IconPng 512 (Join-Path $public "maskable-icon-512.png")
Save-IconPng 180 (Join-Path $public "apple-touch-icon.png")
Save-IconPng 64 (Join-Path $app "icon.png")
Save-IconPng 180 (Join-Path $app "apple-icon.png")
Save-IconPng 32 (Join-Path $public "favicon-32.png")
Save-IconPng 16 (Join-Path $public "favicon-16.png")

Convert-PngsToIco @(
  (Join-Path $public "favicon-32.png"),
  (Join-Path $public "favicon-16.png")
) (Join-Path $app "favicon.ico")
