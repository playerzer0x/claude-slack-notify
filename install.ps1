# =============================================================================
# Claude Slack Notify - Windows Installation Script
# Sends Slack notifications with clickable "Focus Terminal" buttons
#
# Supports: Windows Terminal, ConEmu/Cmder, Git Bash, MSYS2, WSL
# =============================================================================

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$ClaudeDir = "$env:USERPROFILE\.claude"
$BinDir = "$ClaudeDir\bin"
$CommandsDir = "$ClaudeDir\commands"
$InstancesDir = "$ClaudeDir\instances"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Colors for output
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red }

# Registry path for URL scheme
$UrlSchemeKey = "HKCU:\Software\Classes\claude-focus"

# -----------------------------------------------------------------------------
# Uninstall
# -----------------------------------------------------------------------------
if ($Uninstall) {
    Write-Info "Uninstalling Claude Slack Notify..."

    # Remove URL scheme registration
    if (Test-Path $UrlSchemeKey) {
        Remove-Item -Path $UrlSchemeKey -Recurse -Force
        Write-Info "Removed URL scheme registration"
    }

    # Remove scripts
    $filesToRemove = @(
        "$BinDir\claude-slack-notify",
        "$BinDir\focus-helper",
        "$BinDir\focus-helper-windows.ps1",
        "$BinDir\claude-focus-handler.cmd",
        "$CommandsDir\slack-notify.md"
    )

    foreach ($file in $filesToRemove) {
        if (Test-Path $file) {
            Remove-Item $file -Force
        }
    }

    Write-Info "Uninstalled successfully"
    Write-Warn "Note: $ClaudeDir\slack-webhook-url and $InstancesDir were preserved"
    exit 0
}

# -----------------------------------------------------------------------------
# Install
# -----------------------------------------------------------------------------
Write-Info "Installing Claude Slack Notify for Windows..."

# Create directories
$dirsToCreate = @($BinDir, $CommandsDir, $InstancesDir)
foreach ($dir in $dirsToCreate) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# Install scripts as symlinks (so updates to repo are automatically available)
# Remove existing files/symlinks first
Remove-Item "$BinDir\claude-slack-notify" -Force -ErrorAction SilentlyContinue
Remove-Item "$BinDir\focus-helper" -Force -ErrorAction SilentlyContinue
Remove-Item "$BinDir\focus-helper-windows.ps1" -Force -ErrorAction SilentlyContinue

# Create symlinks
New-Item -ItemType SymbolicLink -Path "$BinDir\claude-slack-notify" -Target "$ScriptDir\bin\claude-slack-notify" -Force | Out-Null
New-Item -ItemType SymbolicLink -Path "$BinDir\focus-helper" -Target "$ScriptDir\bin\focus-helper" -Force | Out-Null
New-Item -ItemType SymbolicLink -Path "$BinDir\focus-helper-windows.ps1" -Target "$ScriptDir\bin\focus-helper-windows.ps1" -Force | Out-Null
Copy-Item "$ScriptDir\commands\slack-notify.md" "$CommandsDir\" -Force
Write-Info "Installed scripts to $BinDir (symlinked to repo)"
Write-Info "Installed Claude command to $CommandsDir"

# Create URL handler batch file
$handlerContent = @"
@echo off
REM Claude Focus URL Handler for Windows
REM Receives claude-focus:// URLs and invokes PowerShell focus helper

set "URL=%~1"
if "%URL%"=="" exit /b 1

REM Run the PowerShell focus helper
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\bin\focus-helper-windows.ps1" "%URL%"
"@

$handlerPath = "$BinDir\claude-focus-handler.cmd"
Set-Content -Path $handlerPath -Value $handlerContent -Encoding ASCII
Write-Info "Created URL handler at $handlerPath"

# Register URL scheme in Windows Registry
Write-Info "Registering claude-focus:// URL scheme..."

# Create the URL scheme keys
if (-not (Test-Path $UrlSchemeKey)) {
    New-Item -Path $UrlSchemeKey -Force | Out-Null
}

# Set URL scheme properties
Set-ItemProperty -Path $UrlSchemeKey -Name "(Default)" -Value "URL:Claude Focus Protocol"
Set-ItemProperty -Path $UrlSchemeKey -Name "URL Protocol" -Value ""

# Create shell\open\command subkey
$commandKey = "$UrlSchemeKey\shell\open\command"
if (-not (Test-Path $commandKey)) {
    New-Item -Path $commandKey -Force | Out-Null
}

# Set the command to run
$escapedHandler = $handlerPath -replace '\\', '\\'
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value "`"$handlerPath`" `"%1`""

Write-Info "URL scheme registered successfully"

# Create WSL wrapper script for running the notifier from WSL
$wslWrapperContent = @'
#!/bin/bash
# WSL wrapper for claude-slack-notify
# This allows the notification script to work from within WSL

# Get the Windows home directory path
WIN_HOME=$(wslpath "$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')")

# Source or run the main script
if [[ -f "$WIN_HOME/.claude/bin/claude-slack-notify" ]]; then
    exec "$WIN_HOME/.claude/bin/claude-slack-notify" "$@"
else
    echo "Error: claude-slack-notify not found" >&2
    exit 1
fi
'@

$wslWrapperPath = "$BinDir\claude-slack-notify-wsl"
Set-Content -Path $wslWrapperPath -Value $wslWrapperContent -NoNewline
Write-Info "Created WSL wrapper script"

# Add ~/.claude/bin to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    $newPath = "$BinDir;$userPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "Added $BinDir to user PATH"
    Write-Warn "Restart your terminal for PATH changes to take effect"
} else {
    Write-Info "$BinDir already in PATH"
}

# Show completion message
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Info "Installation complete!"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Get a Slack webhook URL from https://api.slack.com/apps"
Write-Host "2. Save it:"
Write-Host "   Windows:  echo YOUR_WEBHOOK_URL > %USERPROFILE%\.claude\slack-webhook-url"
Write-Host "   WSL:      echo 'YOUR_WEBHOOK_URL' > ~/.claude/slack-webhook-url"
Write-Host "3. In Claude, run: /slack-notify"
Write-Host ""
Write-Host "Supported terminals:"
Write-Host "  - Windows Terminal (recommended)"
Write-Host "  - ConEmu / Cmder"
Write-Host "  - Git Bash / MSYS2 / Cygwin (via mintty)"
Write-Host "  - WSL (with or without Windows Terminal)"
Write-Host ""
Write-Host "The Focus Terminal button will switch to the correct terminal window."
Write-Host ""

# Show hook configuration suggestion
$settingsFile = "$ClaudeDir\settings.json"
if (Test-Path $settingsFile) {
    $content = Get-Content $settingsFile -Raw
    if ($content -notmatch "claude-slack-notify") {
        Write-Warn "Add these hooks to $settingsFile for automatic notifications:"
        Write-Host ""
        Write-Host '  "hooks": {'
        Write-Host '    "UserPromptSubmit": ['
        Write-Host '      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-start", "timeout": 5}]}'
        Write-Host '    ],'
        Write-Host '    "Stop": ['
        Write-Host '      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]}'
        Write-Host '    ]'
        Write-Host '  }'
    }
}
