Add-Type -AssemblyName System.Drawing
function Round-Path($x,$y,$width,$height,$radius) {
    $shape=[System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter=$radius*2
    $shape.AddArc($x,$y,$diameter,$diameter,180,90)
    $shape.AddArc($x+$width-$diameter,$y,$diameter,$diameter,270,90)
    $shape.AddArc($x+$width-$diameter,$y+$height-$diameter,$diameter,$diameter,0,90)
    $shape.AddArc($x,$y+$height-$diameter,$diameter,$diameter,90,90)
    $shape.CloseFigure()
    return $shape
}
$bitmap=[System.Drawing.Bitmap]::new(256,256)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$tile=Round-Path 8 8 240 240 54
$gradient=[System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Point]::new(20,20),[System.Drawing.Point]::new(236,240),[System.Drawing.ColorTranslator]::FromHtml('#9f38d7'),[System.Drawing.ColorTranslator]::FromHtml('#35104e'))
$graphics.FillPath($gradient,$tile)
$brush=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#c28afa'))
$ink=[System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#38144e'))
$whitePen=[System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#f9edff'),8)
$whitePen.StartCap=[System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
$front=Round-Path 34 48 120 92 15
$back=Round-Path 102 112 120 92 15
$graphics.FillPath($ink,$front);$graphics.DrawPath($whitePen,$front)
$graphics.FillPath($ink,$back);$graphics.DrawPath($whitePen,$back)
$graphics.DrawLine($whitePen,62,94,122,94)
$graphics.DrawLines($whitePen,[System.Drawing.Point[]]@([System.Drawing.Point]::new(108,80),[System.Drawing.Point]::new(122,94),[System.Drawing.Point]::new(108,108)))
$graphics.DrawLine($whitePen,136,158,194,158)
$graphics.DrawLines($whitePen,[System.Drawing.Point[]]@([System.Drawing.Point]::new(150,144),[System.Drawing.Point]::new(136,158),[System.Drawing.Point]::new(150,172)))
$bitmap.Save((Join-Path $PSScriptRoot 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Save((Join-Path $PSScriptRoot '../desktop/ui/assets/app-icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$images=@()
foreach($size in @(16,24,32,48,64,128,256)) {
    $scaled=[System.Drawing.Bitmap]::new($size,$size)
    $g=[System.Drawing.Graphics]::FromImage($scaled)
    $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bitmap,0,0,$size,$size)
    $stream=[System.IO.MemoryStream]::new();$scaled.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
    $images+=,@{Size=$size;Bytes=$stream.ToArray()};$g.Dispose();$scaled.Dispose();$stream.Dispose()
}
$writer=[System.IO.BinaryWriter]::new([System.IO.File]::Create((Join-Path $PSScriptRoot 'icon.ico')))
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
$offset=6+16*$images.Count
foreach($item in $images){$dimension=if($item.Size -eq 256){0}else{$item.Size};$writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$item.Bytes.Length);$writer.Write([uint32]$offset);$offset+=$item.Bytes.Length}
foreach($item in $images){$writer.Write([byte[]]$item.Bytes)}
$writer.Dispose();$tile.Dispose();$front.Dispose();$back.Dispose();$gradient.Dispose();$whitePen.Dispose()

# NSIS uses a 24-bit bitmap for the welcome/uninstall sidebar. Derive it from
# the existing product mark so the installer shares the client's branding.
$sidebar = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sidebarGraphics = [System.Drawing.Graphics]::FromImage($sidebar)
$sidebarGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#160e20'))
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
