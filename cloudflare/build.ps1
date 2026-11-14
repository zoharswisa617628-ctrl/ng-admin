# Builds public/ from the site (../index.html), and the redesign preview (../v4/index.html -> public/v4/) when it exists:
#  - plugs in the connector (shim.js) so it saves to our own server
#  - moves every inline <script> into its own .js file, so the page can run with a strict
#    Content-Security-Policy that refuses any injected script (see public/_headers)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pub  = Join-Path $root 'public'
$utf8 = New-Object Text.UTF8Encoding $false

function Build-Site($src, $outDir, $prefix) {
  $html = [IO.File]::ReadAllText($src, [Text.Encoding]::UTF8)
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $names = @('boot.js', 'img.js', 'app.js')
  $rx = [regex]'(?s)<script>(.*?)</script>'
  $found = $rx.Matches($html)
  if ($found.Count -ne $names.Count) { throw "expected $($names.Count) inline scripts, found $($found.Count) - update build.ps1" }
  for ($i = $found.Count - 1; $i -ge 0; $i--) {
    $m = $found[$i]; $code = $m.Groups[1].Value
    if ($names[$i] -eq 'app.js') { $code += "`n;document.getElementById('fmtForm')?.addEventListener('submit', e => e.preventDefault());`n" }
    [IO.File]::WriteAllText((Join-Path $outDir $names[$i]), $code, $utf8)
    $html = $html.Remove($m.Index, $m.Length).Insert($m.Index, "<script src=""$prefix/$($names[$i])""></script>")
  }
  $html = $html.Replace(' onsubmit="return false"', '')
  if ($html -match '\son[a-z]+="') { throw 'an inline event handler is left (on...="") - it would be blocked by the CSP' }

  $app = '<link rel="manifest" href="/manifest.webmanifest?v=2"><link rel="icon" type="image/png" href="/icon-192.png?v=2"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"><meta name="theme-color" content="#0b0f17"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="NG Admin"><meta name="apple-mobile-web-app-status-bar-style" content="black">'
  $html = ([regex]'<meta charset="utf-8">').Replace($html, "<meta charset=""utf-8"">`n$app`n<script src=""/shim.js""></script>", 1)
  if ($html -notmatch 'src="/shim.js"') { throw 'could not plug in shim.js' }
  [IO.File]::WriteAllText((Join-Path $outDir 'index.html'), $html, $utf8)
  "built {0} (index {1:N0} KB, app {2:N0} KB, img {3:N0} KB)" -f $outDir, ((Get-Item (Join-Path $outDir 'index.html')).Length / 1KB), ((Get-Item (Join-Path $outDir 'app.js')).Length / 1KB), ((Get-Item (Join-Path $outDir 'img.js')).Length / 1KB)
}

Build-Site (Join-Path (Split-Path -Parent $root) 'index.html') $pub ''
foreach ($n in @('v4','v5')) { $f = Join-Path (Split-Path -Parent $root) (Join-Path $n 'index.html'); if (Test-Path $f) { Build-Site $f (Join-Path $pub $n) ('/' + $n) } }
