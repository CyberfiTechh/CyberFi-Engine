param([Parameter(Mandatory = $true)][string]$EngineSource)

$ErrorActionPreference = 'Stop'
$engine = (Resolve-Path -LiteralPath $EngineSource).Path
$revision = git -C $engine rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -ne '3d672e414d70804cf9f1b20b44d7243c78e063c3') {
    throw 'Beklenen motor kaynak revizyonu bulunamadı.'
}
$native = Join-Path $engine 'packages/happy-agent-modules/sources/menuBar/native/windows'
$source = Join-Path $native 'WindowsTray.cs'
$text = [IO.File]::ReadAllText($source)
if (-not $text.Contains('Text = "Happy Agent is running"')) {
    throw 'Windows tepsi kaynağı beklenen biçimde değil.'
}
$text = $text.Replace('Happy Agent is running', 'CyberFi ajan motoru \u00e7al\u0131\u015f\u0131yor')
$text = $text.Replace('Happy Agent is not responding', 'CyberFi ajan motoru yan\u0131t vermiyor')
$text = $text.Replace('Quit Happy', 'CyberFi motorunu kapat')
$text = $text.Replace('Quitting Happy...', 'CyberFi motoru kapat\u0131l\u0131yor...')
$text = $text.Replace('Happy tray:', 'CyberFi:')
[IO.File]::WriteAllText($source, $text, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'CyberFi.ico') -Destination (Join-Path $native 'happy.ico')
