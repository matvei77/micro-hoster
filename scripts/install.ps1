$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillSource = Join-Path $repoRoot "skills\share-on-pages"
$legacySkillSources = @(
    (Join-Path $repoRoot "integrations\skills\share-on-pages"),
    (Join-Path $repoRoot ".agents\plugins\plugins\micro-hoster\skills\share-on-pages"),
    (Join-Path $repoRoot "plugins\micro-hoster\skills\share-on-pages")
)
$skillTargets = @(
    (Join-Path $env:USERPROFILE ".codex\skills\share-on-pages"),
    (Join-Path $env:USERPROFILE ".claude\skills\share-on-pages"),
    (Join-Path $env:USERPROFILE ".kimi-code\skills\share-on-pages")
)

Push-Location $repoRoot
try {
    npm install
    npm link
} finally {
    Pop-Location
}

foreach ($target in $skillTargets) {
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path $target) {
        $item = Get-Item $target -Force
        if ($item.LinkType -eq "Junction" -and $item.Target -contains $skillSource) {
            continue
        }
        if ($item.LinkType -eq "Junction" -and ($item.Target | Where-Object { $legacySkillSources -contains $_ })) {
            [System.IO.Directory]::Delete($target)
        } else {
            throw "Skill target already exists and was not changed: $target"
        }
    }
    New-Item -ItemType Junction -Path $target -Target $skillSource | Out-Null
}

micro-hoster --version
Write-Output "Installed the command and share-on-pages skill for Codex, Claude Code, Kimi Code, and OpenCode."
