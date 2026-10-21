Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b0f18'))
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#67e6c3'))
$graphics.FillRectangle($brush, 24, 24, 208, 208)
$ink = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#0b0f18'))
$points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(94, 64), [System.Drawing.PointF]::new(194, 64),
    [System.Drawing.PointF]::new(186, 96), [System.Drawing.PointF]::new(112, 96),
    [System.Drawing.PointF]::new(108, 112), [System.Drawing.PointF]::new(154, 112),
    [System.Drawing.PointF]::new(176, 130), [System.Drawing.PointF]::new(160, 180),
    [System.Drawing.PointF]::new(144, 192), [System.Drawing.PointF]::new(57, 192),
    [System.Drawing.PointF]::new(65, 160), [System.Drawing.PointF]::new(129, 160),
    [System.Drawing.PointF]::new(135, 142), [System.Drawing.PointF]::new(90, 142),
    [System.Drawing.PointF]::new(68, 124), [System.Drawing.PointF]::new(80, 80)
)
$graphics.FillPolygon($ink, $points)
$memory = [System.IO.MemoryStream]::new()
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $memory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icon.png'), $png)
$file = [System.IO.File]::Create((Join-Path $PSScriptRoot 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $memory.Dispose()

# NSIS uses a 24-bit bitmap for the welcome/uninstall sidebar. Derive it from
# the existing product mark so the installer shares the client's branding.
$sidebar = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sidebarGraphics = [System.Drawing.Graphics]::FromImage($sidebar)
$sidebarGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b0f18'))
$sidebarGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sidebarGraphics.DrawImage($bitmap, 34, 38, 96, 96)
$brandFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$detailFont = [System.Drawing.Font]::new('Segoe UI', 9)
$alignment = [System.Drawing.StringFormat]::new()
$alignment.Alignment = [System.Drawing.StringAlignment]::Center
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$sidebarGraphics.DrawString('Shatoot', $brandFont, $white, [System.Drawing.RectangleF]::new(0, 147, 164, 40), $alignment)
$sidebarGraphics.DrawString('C O N N E C T', $detailFont, $brush, [System.Drawing.RectangleF]::new(0, 188, 164, 30), $alignment)
$sidebarGraphics.DrawString('ShatootSoft', $detailFont, $white, [System.Drawing.RectangleF]::new(0, 277, 164, 25), $alignment)
$sidebar.Save((Join-Path $PSScriptRoot 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebarGraphics.Dispose(); $sidebar.Dispose(); $brandFont.Dispose(); $detailFont.Dispose(); $alignment.Dispose(); $white.Dispose()
$graphics.Dispose(); $bitmap.Dispose(); $brush.Dispose(); $ink.Dispose()
