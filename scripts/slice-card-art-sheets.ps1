param(
  [string]$AssetsRoot = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$assetsPath = [System.IO.Path]::GetFullPath($AssetsRoot)
$sheetRoot = Join-Path $assetsPath 'source\card-art-v017\sheets'
$outputRoot = Join-Path $assetsPath 'cards\v017'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class CardArtSlicer
{
    private sealed class Component
    {
        public readonly List<int> Pixels = new List<int>();
        public int Left = Int32.MaxValue;
        public int Top = Int32.MaxValue;
        public int Right = -1;
        public int Bottom = -1;
        public long SumX;
        public long SumY;

        public int Area { get { return Pixels.Count; } }
        public double CenterX { get { return SumX / (double)Math.Max(1, Area); } }
        public double CenterY { get { return SumY / (double)Math.Max(1, Area); } }
    }

    private static bool IsRemovableBackground(Color color)
    {
        int max = Math.Max(color.R, Math.Max(color.G, color.B));
        int min = Math.Min(color.R, Math.Min(color.G, color.B));
        // The generated checkerboard is near-white and its antialiased matte
        // reaches into the low 200s. Flooding only from the outer edge keeps
        // enclosed white subject pixels (rabbit fur, cream, moon) intact.
        return min >= 185 && max - min <= 42;
    }

    private static void FloodTransparentBackground(Bitmap image)
    {
        int width = image.Width;
        int height = image.Height;
        bool[] visited = new bool[width * height];
        Queue<int> queue = new Queue<int>();

        Action<int, int> enqueue = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return;
            int index = y * width + x;
            if (visited[index]) return;
            visited[index] = true;
            if (IsRemovableBackground(image.GetPixel(x, y))) queue.Enqueue(index);
        };

        for (int x = 0; x < width; x++) {
            enqueue(x, 0);
            enqueue(x, height - 1);
        }
        for (int y = 0; y < height; y++) {
            enqueue(0, y);
            enqueue(width - 1, y);
        }

        while (queue.Count > 0) {
            int index = queue.Dequeue();
            int x = index % width;
            int y = index / width;
            image.SetPixel(x, y, Color.Transparent);
            enqueue(x - 1, y);
            enqueue(x + 1, y);
            enqueue(x, y - 1);
            enqueue(x, y + 1);
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
                if (image.GetPixel(x, y).A == 0) continue;
                left = Math.Min(left, x);
                top = Math.Min(top, y);
                right = Math.Max(right, x);
                bottom = Math.Max(bottom, y);
            }
        }
        if (right < left || bottom < top) return Rectangle.Empty;
        return Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    }

    private static void KeepOwnedComponents(Bitmap image, Rectangle focus)
    {
        int width = image.Width;
        int height = image.Height;
        bool[] visited = new bool[width * height];
        List<Component> components = new List<Component>();

        for (int startY = 0; startY < height; startY++) {
            for (int startX = 0; startX < width; startX++) {
                int startIndex = startY * width + startX;
                if (visited[startIndex] || image.GetPixel(startX, startY).A == 0) continue;
                Component component = new Component();
            Queue<int> queue = new Queue<int>();
            visited[startIndex] = true;
            queue.Enqueue(startIndex);
            while (queue.Count > 0) {
                int index = queue.Dequeue();
                int x = index % width;
                int y = index / width;
                    component.Pixels.Add(index);
                    component.Left = Math.Min(component.Left, x);
                    component.Top = Math.Min(component.Top, y);
                    component.Right = Math.Max(component.Right, x);
                    component.Bottom = Math.Max(component.Bottom, y);
                    component.SumX += x;
                    component.SumY += y;
                for (int offsetY = -1; offsetY <= 1; offsetY++) {
                    for (int offsetX = -1; offsetX <= 1; offsetX++) {
                        if (offsetX == 0 && offsetY == 0) continue;
                        int nextX = x + offsetX;
                        int nextY = y + offsetY;
                        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
                        int nextIndex = nextY * width + nextX;
                        if (visited[nextIndex] || image.GetPixel(nextX, nextY).A == 0) continue;
                        visited[nextIndex] = true;
                        queue.Enqueue(nextIndex);
                    }
                }
            }
                components.Add(component);
            }
        }

        if (components.Count == 0) return;
        double focusX = focus.Left + focus.Width / 2.0;
        double focusY = focus.Top + focus.Height / 2.0;
        double diagonal = Math.Sqrt(focus.Width * focus.Width + focus.Height * focus.Height);
        Component anchor = null;
        double anchorScore = Double.MinValue;
        foreach (Component component in components) {
            double dx = component.CenterX - focusX;
            double dy = component.CenterY - focusY;
            double distance = Math.Sqrt(dx * dx + dy * dy) / Math.Max(1.0, diagonal);
            double score = component.Area / (1.0 + distance * 8.0);
            if (score > anchorScore) {
                anchorScore = score;
                anchor = component;
            }
        }

        Rectangle ownership = focus;
        ownership.Inflate(-(int)Math.Round(focus.Width * 0.035), -(int)Math.Round(focus.Height * 0.035));
        int minimumArea = Math.Max(6, (int)Math.Round(anchor.Area * 0.0015));
        HashSet<Component> keep = new HashSet<Component>();
        keep.Add(anchor);
        foreach (Component component in components) {
            if (component.Area < minimumArea) continue;
            if (ownership.Contains((int)Math.Round(component.CenterX), (int)Math.Round(component.CenterY))) keep.Add(component);
        }

        foreach (Component component in components) {
            if (keep.Contains(component)) continue;
            foreach (int index in component.Pixels) image.SetPixel(index % width, index / width, Color.Transparent);
        }
    }

    private static Bitmap NormalizeTile(Bitmap tile, Rectangle focus)
    {
        FloodTransparentBackground(tile);
        KeepOwnedComponents(tile, focus);
        Rectangle bounds = FindContentBounds(tile);
        if (bounds.IsEmpty) throw new InvalidDataException("A sprite cell became empty after background removal.");

        const int canvasSize = 256;
        const int contentLimit = 216;
        double scale = Math.Min(contentLimit / (double)bounds.Width, contentLimit / (double)bounds.Height);
        int width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        int height = Math.Max(1, (int)Math.Round(bounds.Height * scale));
        int x = (canvasSize - width) / 2;
        int y = (canvasSize - height) / 2;

        Bitmap subject = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(subject)) {
            graphics.Clear(Color.Transparent);
            graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
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
        if (ids.Length != columns * rows) throw new ArgumentException("Manifest size does not match the requested grid.");
        using (Bitmap sheet = new Bitmap(sheetPath)) {
            if (sheet.Width != sheet.Height) throw new InvalidDataException("Sprite sheet must be square: " + sheetPath);
            for (int index = 0; index < ids.Length; index++) {
                int column = index % columns;
                int row = index / columns;
                int left = (int)Math.Round(column * sheet.Width / (double)columns, MidpointRounding.AwayFromZero);
                int top = (int)Math.Round(row * sheet.Height / (double)rows, MidpointRounding.AwayFromZero);
                int right = (int)Math.Round((column + 1) * sheet.Width / (double)columns, MidpointRounding.AwayFromZero);
                int bottom = (int)Math.Round((row + 1) * sheet.Height / (double)rows, MidpointRounding.AwayFromZero);
                // Read beyond the mathematical cell so silhouettes that drift across a
                // generated grid boundary remain complete. Component ownership below
                // discards neighbouring fragments by their centre, not by a hard crop.
                int bleed = Math.Max(8, (int)Math.Round(Math.Min(right - left, bottom - top) * 0.11));
                Rectangle sourceBounds = Rectangle.FromLTRB(
                    Math.Max(0, left - bleed),
                    Math.Max(0, top - bleed),
                    Math.Min(sheet.Width, right + bleed),
                    Math.Min(sheet.Height, bottom + bleed)
                );
                Rectangle focus = new Rectangle(left - sourceBounds.Left, top - sourceBounds.Top, right - left, bottom - top);
                using (Bitmap tile = sheet.Clone(sourceBounds, PixelFormat.Format32bppArgb))
                using (Bitmap normalized = NormalizeTile(tile, focus)) {
                    string destination = Path.Combine(outputDirectory, ids[index].ToLowerInvariant() + "-v3.png");
                    normalized.Save(destination, ImageFormat.Png);
                }
            }
        }
    }
}
'@

$sheets = @(
  @{
    File = 'sheet-01-fruit-fastfood.png'; Columns = 4; Rows = 4;
    Ids = @('F001','F002','F003','F004','F005','F006','F007','F008','F009','F010','F011','F012','F013','K001','K002','K003')
  },
  @{
    File = 'sheet-02-fastfood-dessert.png'; Columns = 4; Rows = 4;
    Ids = @('K004','K005','K006','K007','K008','K009','K010','K011','K012','D001','D002','D003','D004','D005','D006','D007')
  },
  @{
    File = 'sheet-03-dessert-drink.png'; Columns = 4; Rows = 4;
    Ids = @('D008','D009','D010','D011','B001','B002','B003','B004','B005','B006','B007','B008','B009','B010','B011','B012')
  },
  @{
    File = 'sheet-04-animal-celestial.png'; Columns = 4; Rows = 4;
    Ids = @('A001','A002','A003','A004','A005','A006','A007','A008','A009','A010','A011','A012','C001','C002','C003','C004')
  },
  @{
    File = 'sheet-05-celestial-person.png'; Columns = 4; Rows = 4;
    Ids = @('C005','C006','C007','C008','C009','C010','C011','P001','P002','P003','P004','P005','P006','P007','P008','P009')
  },
  @{
    File = 'sheet-06-person-utility.png'; Columns = 3; Rows = 3;
    Ids = @('P010','U001','U002','U003','U004','U005','U006','U007','U008')
  }
)

foreach ($sheet in $sheets) {
  $sheetPath = Join-Path $sheetRoot $sheet.File
  if (-not (Test-Path -LiteralPath $sheetPath)) { throw "Missing sprite sheet: $sheetPath" }
  [CardArtSlicer]::Slice($sheetPath, $sheet.Columns, $sheet.Rows, [string[]]$sheet.Ids, $outputRoot)
}

$files = Get-ChildItem -LiteralPath $outputRoot -Filter '*-v3.png' -File
if ($files.Count -ne 89) { throw "Expected 89 generated sprites, found $($files.Count)." }
Write-Output "Generated 89 normalized card sprites in $outputRoot"
