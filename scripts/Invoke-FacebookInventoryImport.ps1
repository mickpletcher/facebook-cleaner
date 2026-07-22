[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string[]]$ExportPath,

    [string]$DatabasePath,

    [string]$ReportPath,

    [switch]$ValidateOnly
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$tsxPath = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
$cliPath = Join-Path $projectRoot 'src\cli.ts'

if (-not (Test-Path -LiteralPath $tsxPath -PathType Leaf)) {
    throw 'Project dependencies are missing. Run npm install first.'
}

$cliArguments = [System.Collections.Generic.List[string]]::new()
$cliArguments.Add($tsxPath)
$cliArguments.Add($cliPath)

if ($ValidateOnly) {
    $cliArguments.Add('--validate-only')
}

foreach ($path in $ExportPath) {
    $cliArguments.Add('--export-path')
    $cliArguments.Add($path)
}

if ($ReportPath) {
    $cliArguments.Add('--report-path')
    $cliArguments.Add($ReportPath)
}

if (-not $ValidateOnly) {
    if (-not $DatabasePath) {
        throw 'DatabasePath is required unless ValidateOnly is specified.'
    }
    $cliArguments.Add('--database-path')
    $cliArguments.Add($DatabasePath)
}

& node @cliArguments
exit $LASTEXITCODE
