param(
  [string]$AssetsRoot = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$assetsPath = [System.IO.Path]::GetFullPath($AssetsRoot)
$sheetRoot = Join-Path $assetsPath 'source\item-art-v024\sheets'
$outputRoot = Join-Path $assetsPath 'item-sprites\v024'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class ItemArtSlicer
{
    private sealed class Component
    {
        public readonly List<Point> Pixels = new List<Point>();
        public int Left = Int32.MaxValue;
        public int Top = Int32.MaxValue;
        public int Right = -1;
        public int Bottom = -1;
        public int Area { get { return Pixels.Count; } }
        public Rectangle Bounds { get { return Rectangle.FromLTRB(Left, Top, Right + 1, Bottom + 1); } }
    }

    private static int RectangleDistance(Rectangle first, Rectangle second)
    {
        int dx = first.Right < second.Left ? second.Left - first.Right : second.Right < first.Left ? first.Left - second.Right : 0;
        int dy = first.Bottom < second.Top ? second.Top - first.Bottom : second.Bottom < first.Top ? first.Top - second.Bottom : 0;
        return (int)Math.Round(Math.Sqrt(dx * dx + dy * dy));
    }

    private static void KeepOwnedComponents(Bitmap image)
    {
        int width = image.Width;
        int height = image.Height;
        bool[] visited = new bool[width * height];
        List<Component> components = new List<Component>();
        for (int startY = 0; startY < height; startY++) {
            for (int startX = 0; startX < width; startX++) {
                int start = startY * width + startX;
                if (visited[start] || image.GetPixel(startX, startY).A <= 10) continue;
                Component component = new Component();
                Queue<Point> queue = new Queue<Point>();
                visited[start] = true;
                queue.Enqueue(new Point(startX, startY));
                while (queue.Count > 0) {
                    Point point = queue.Dequeue();
                    component.Pixels.Add(point);
                    component.Left = Math.Min(component.Left, point.X);
                    component.Top = Math.Min(component.Top, point.Y);
                    component.Right = Math.Max(component.Right, point.X);
                    component.Bottom = Math.Max(component.Bottom, point.Y);
                    for (int oy = -1; oy <= 1; oy++) {
                        for (int ox = -1; ox <= 1; ox++) {
                            if (ox == 0 && oy == 0) continue;
                            int x = point.X + ox;
                            int y = point.Y + oy;
                            if (x < 0 || y < 0 || x >= width || y >= height) continue;
                            int index = y * width + x;
                            if (visited[index] || image.GetPixel(x, y).A <= 10) continue;
                            visited[index] = true;
                            queue.Enqueue(new Point(x, y));
                        }
                    }
                }
                components.Add(component);
            }
        }
        if (components.Count == 0) return;
        Component anchor = components[0];
        foreach (Component component in components) if (component.Area > anchor.Area) anchor = component;
        foreach (Component component in components) {
            bool touchesCellEdge = component.Left <= 2 || component.Top <= 2 || component.Right >= width - 3 || component.Bottom >= height - 3;
            bool keep = component == anchor || (!touchesCellEdge && (
                component.Area >= anchor.Area * 0.08
                || (component.Area >= 4 && RectangleDistance(component.Bounds, anchor.Bounds) <= 30)));
            if (keep) continue;
            foreach (Point point in component.Pixels) image.SetPixel(point.X, point.Y, Color.Transparent);
        }
    }

    private static Rectangle FindContentBounds(Bitmap image)
    {
        int left = image.Width;
        int top = image.Height;
        int right = -1;
        int bottom = -1;
        for (int y = 0; y < image.Height; y++) {
            for (int x = 0; x < image.Width; x++) {
                Color pixel = image.GetPixel(x, y);
                if (pixel.A <= 10) {
                    if (pixel.A != 0) image.SetPixel(x, y, Color.Transparent);
                    continue;
                }
                left = Math.Min(left, x);
                top = Math.Min(top, y);
                right = Math.Max(right, x);
                bottom = Math.Max(bottom, y);
            }
        }
        if (right < left || bottom < top) return Rectangle.Empty;
        return Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    }

    private static Bitmap NormalizeTile(Bitmap tile)
    {
        KeepOwnedComponents(tile);
        Rectangle bounds = FindContentBounds(tile);
        if (bounds.IsEmpty) throw new InvalidDataException("An item sprite cell is empty.");

        const int canvasSize = 256;
        const int contentLimit = 224;
        double scale = Math.Min(contentLimit / (double)bounds.Width, contentLimit / (double)bounds.Height);
        int width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        int height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
        int x = (canvasSize - width) / 2;
        int y = (canvasSize - height) / 2;

        Bitmap subject = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(subject)) {
            graphics.Clear(Color.Transparent);
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.CompositingQuality = CompositingQuality.HighSpeed;
            graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            graphics.PixelOffsetMode = PixelOffsetMode.Half;
            graphics.SmoothingMode = SmoothingMode.None;
            graphics.DrawImage(tile, new Rectangle(x, y, width, height), bounds, GraphicsUnit.Pixel);
        }
        return subject;
    }

    public static void Slice(string sheetPath, int columns, int rows, string[] ids, string outputDirectory)
    {
        if (ids.Length > columns * rows) throw new ArgumentException("Manifest exceeds the requested grid.");
        using (Bitmap sheet = new Bitmap(sheetPath)) {
            if (sheet.Width != sheet.Height) throw new InvalidDataException("Item sprite sheet must be square: " + sheetPath);
            for (int index = 0; index < ids.Length; index++) {
                int column = index % columns;
                int row = index / columns;
                int left = (int)Math.Round(column * sheet.Width / (double)columns, MidpointRounding.AwayFromZero);
                int top = (int)Math.Round(row * sheet.Height / (double)rows, MidpointRounding.AwayFromZero);
                int right = (int)Math.Round((column + 1) * sheet.Width / (double)columns, MidpointRounding.AwayFromZero);
                int bottom = (int)Math.Round((row + 1) * sheet.Height / (double)rows, MidpointRounding.AwayFromZero);
                // Generated subjects occasionally cross the nominal 4x4 guide by a few
                // dozen pixels. Keep a transparent safety gutter, then let component
                // ownership discard fragments belonging to neighbouring cells. A hard
                // cell crop visibly sliced tall/tilted items such as the rebellious fork.
                int gutter = Math.Max(24, Math.Min(sheet.Width / columns, sheet.Height / rows) / 4);
                Rectangle sourceBounds = Rectangle.FromLTRB(
                    Math.Max(0, left - gutter),
                    Math.Max(0, top - gutter),
                    Math.Min(sheet.Width, right + gutter),
                    Math.Min(sheet.Height, bottom + gutter));
                using (Bitmap tile = sheet.Clone(sourceBounds, PixelFormat.Format32bppArgb))
                using (Bitmap normalized = NormalizeTile(tile)) {
                    string destination = Path.Combine(outputDirectory, ids[index].ToLowerInvariant() + ".png");
                    normalized.Save(destination, ImageFormat.Png);
                }
            }
        }
    }
}
'@

$sheets = @(
  @{
    File = 'item-sprites-sheet-01.png'; Columns = 4; Rows = 4;
    Ids = @('A1','A2','A3','A4','A5','A6','A7','A8','B1','B2','B3','C1','C2','C3','C4','C5')
  },
  @{
    File = 'item-sprites-sheet-02.png'; Columns = 4; Rows = 4;
    Ids = @('C6','C7','C8','C9','C10','C11','C12','C13','C14','C15','C16','C17','C18','C19','C20','C30')
  },
  @{
    File = 'item-sprites-sheet-03.png'; Columns = 4; Rows = 4;
    Ids = @('E101','E102','E103','E104','E105','E106','E107')
  }
)

foreach ($sheet in $sheets) {
  $sourcePath = Join-Path $sheetRoot $sheet.File
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing item source sheet: $sourcePath" }
  [ItemArtSlicer]::Slice($sourcePath, $sheet.Columns, $sheet.Rows, [string[]]$sheet.Ids, $outputRoot)
}

Write-Host "Wrote 39 item sprites to $outputRoot"
