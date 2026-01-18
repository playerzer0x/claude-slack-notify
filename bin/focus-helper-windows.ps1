# Focus helper for Windows - switches to the correct terminal window/tab
# Called by URL handler when claude-focus:// URL is invoked

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Url
)

$ErrorActionPreference = "SilentlyContinue"

# Setup logging
$LogDir = "$env:USERPROFILE\.claude\logs"
$LogFile = "$LogDir\focus-debug.log"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "$timestamp`: $Message"
}

Write-Log "Helper received: $Url"

# Parse URL: claude-focus://TYPE/ARG1/ARG2
$UrlPath = $Url -replace "^claude-focus://", ""
$Parts = $UrlPath -split "/", 3
$Type = $Parts[0]
$Arg1 = if ($Parts.Length -gt 1) { [System.Uri]::UnescapeDataString($Parts[1]) } else { "" }
$Arg2 = if ($Parts.Length -gt 2) { [System.Uri]::UnescapeDataString($Parts[2]) } else { "" }

Write-Log "Type=$Type Arg1=$Arg1 Arg2=$Arg2"

# Validate inputs - only allow safe characters
function Test-SafeInput {
    param([string]$Input)
    if ($Input -match "^[a-zA-Z0-9_./:=\-{}\s]+$") {
        return $true
    }
    Write-Log "Rejected unsafe input: $Input"
    return $false
}

if ($Arg1 -and -not (Test-SafeInput $Arg1)) { exit 1 }
if ($Arg2 -and -not (Test-SafeInput $Arg2)) { exit 1 }

# Windows API for window manipulation
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
}
"@

# Focus a window by process ID
function Focus-WindowByPID {
    param([int]$ProcessId)

    $found = $false
    $callback = {
        param([IntPtr]$hwnd, [IntPtr]$lParam)

        $pid = 0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null

        if ($pid -eq $ProcessId -and [Win32]::IsWindowVisible($hwnd)) {
            [Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE) | Out-Null
            [Win32]::SetForegroundWindow($hwnd) | Out-Null
            $script:found = $true
            return $false  # Stop enumeration
        }
        return $true  # Continue enumeration
    }

    [Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $found
}

# Focus a window by title substring
function Focus-WindowByTitle {
    param([string]$TitleSubstring)

    $found = $false
    $callback = {
        param([IntPtr]$hwnd, [IntPtr]$lParam)

        if ([Win32]::IsWindowVisible($hwnd)) {
            $length = [Win32]::GetWindowTextLength($hwnd)
            if ($length -gt 0) {
                $sb = New-Object System.Text.StringBuilder($length + 1)
                [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
                $title = $sb.ToString()

                if ($title -like "*$TitleSubstring*") {
                    [Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE) | Out-Null
                    [Win32]::SetForegroundWindow($hwnd) | Out-Null
                    $script:found = $true
                    return $false  # Stop enumeration
                }
            }
        }
        return $true  # Continue enumeration
    }

    [Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $found
}

# Focus Windows Terminal by session GUID
function Focus-WindowsTerminal {
    param([string]$SessionGuid)

    Write-Log "Looking for Windows Terminal session: $SessionGuid"

    # Windows Terminal doesn't expose session GUIDs to external apps easily
    # Best we can do is focus the Windows Terminal window
    $wtProcess = Get-Process -Name "WindowsTerminal" -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($wtProcess) {
        $result = Focus-WindowByPID $wtProcess.Id
        Write-Log "Windows Terminal focus result: $result"
        return $result
    }

    # Try by window title
    $result = Focus-WindowByTitle "Windows Terminal"
    if (-not $result) {
        $result = Focus-WindowByTitle "WindowsTerminal"
    }
    Write-Log "Windows Terminal title search result: $result"
    return $result
}

# Focus ConEmu/Cmder by PID
function Focus-ConEmu {
    param([string]$Pid)

    Write-Log "Looking for ConEmu PID: $Pid"

    # Try to find by the specific PID
    if ($Pid -match "^\d+$") {
        $result = Focus-WindowByPID ([int]$Pid)
        Write-Log "ConEmu PID focus result: $result"
        return $result
    }

    # Fallback: find any ConEmu window
    $result = Focus-WindowByTitle "ConEmu"
    if (-not $result) {
        $result = Focus-WindowByTitle "Cmder"
    }
    Write-Log "ConEmu title search result: $result"
    return $result
}

# Focus mintty (Git Bash / MSYS2 / Cygwin)
function Focus-Mintty {
    param([string]$Pid)

    Write-Log "Looking for mintty PID: $Pid"

    if ($Pid -match "^\d+$") {
        $result = Focus-WindowByPID ([int]$Pid)
        Write-Log "Mintty PID focus result: $result"
        return $result
    }

    # Fallback: find by title
    $result = Focus-WindowByTitle "MINGW64"
    if (-not $result) {
        $result = Focus-WindowByTitle "MSYS2"
    }
    if (-not $result) {
        $result = Focus-WindowByTitle "Git Bash"
    }
    Write-Log "Mintty title search result: $result"
    return $result
}

# Focus WSL window
function Focus-WSL {
    param([string]$DistroInfo)

    Write-Log "Looking for WSL: $DistroInfo"

    # Extract distro name if present
    $distro = $DistroInfo -replace "-\d+$", ""

    # Try Windows Terminal first (most common WSL host)
    $result = Focus-WindowsTerminal $distro
    if ($result) { return $result }

    # Try finding by WSL distro name in title
    $result = Focus-WindowByTitle $distro
    Write-Log "WSL distro title search result: $result"
    return $result
}

# Switch tmux window (via WSL or directly)
function Switch-TmuxWindow {
    param([string]$TmuxTarget)

    Write-Log "Switching tmux to: $TmuxTarget"

    $session = ($TmuxTarget -split ":")[0]
    $windowPart = ($TmuxTarget -split ":")[1]
    $window = ($windowPart -split "\.")[0]

    # Try WSL tmux first
    $wslResult = wsl tmux switch-client -t "${session}:${window}" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Switched tmux via WSL"
        return $true
    }

    # Try direct tmux (Git Bash/MSYS2)
    $tmuxResult = tmux switch-client -t "${session}:${window}" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Switched tmux directly"
        return $true
    }

    Write-Log "Failed to switch tmux: $wslResult / $tmuxResult"
    return $false
}

# Main logic
switch ($Type) {
    "windows-terminal" {
        Focus-WindowsTerminal $Arg1
    }

    "wt-tmux" {
        Focus-WindowsTerminal $Arg1
        Switch-TmuxWindow $Arg2
    }

    "conemu" {
        Focus-ConEmu $Arg1
    }

    "mintty" {
        Focus-Mintty $Arg1
    }

    "wsl" {
        Focus-WSL $Arg1
    }

    "wsl-tmux" {
        Focus-WSL $Arg1
        Switch-TmuxWindow $Arg2
    }

    default {
        Write-Log "Unknown terminal type: $Type"
        # Try generic Windows Terminal focus as fallback
        Focus-WindowsTerminal ""
    }
}

Write-Log "Focus helper completed"
