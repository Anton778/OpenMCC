param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)

function Get-ContentType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg"  { return "image/svg+xml" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".webp" { return "image/webp" }
        ".gif"  { return "image/gif" }
        ".ico"  { return "image/x-icon" }
        ".wasm" { return "application/wasm" }
        ".map"  { return "application/json; charset=utf-8" }
        default  { return "application/octet-stream" }
    }
}

function Send-Response(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$SendBody = $true
) {
    $header = "HTTP/1.1 $StatusCode $StatusText`r`n" +
              "Content-Type: $ContentType`r`n" +
              "Content-Length: $($Body.Length)`r`n" +
              "Cache-Control: no-cache`r`n" +
              "Connection: close`r`n`r`n"

    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)

    if ($SendBody -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }

    $Stream.Flush()
}

$listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    $Port
)

try {
    $listener.Start()
    Write-Host ""
    Write-Host "OpenMCC local server"
    Write-Host "http://localhost:$Port/"
    Write-Host ""
    Write-Host "Keep this window open while OpenMCC is running."
    Write-Host "Press Ctrl+C to stop the server."
    Write-Host ""

    while ($true) {
        $client = $listener.AcceptTcpClient()

        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader(
                $stream,
                [System.Text.Encoding]::ASCII,
                $false,
                4096,
                $true
            )

            $requestLine = $reader.ReadLine()

            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                continue
            }

            do {
                $line = $reader.ReadLine()
            } while ($null -ne $line -and $line -ne "")

            $parts = $requestLine.Split(" ")

            if ($parts.Length -lt 2) {
                continue
            }

            $method = $parts[0].ToUpperInvariant()
            $requestPath = $parts[1].Split("?")[0]
            $requestPath = [System.Uri]::UnescapeDataString($requestPath)

            if ($requestPath -eq "/") {
                $requestPath = "/index.html"
            }

            $relativePath = $requestPath.TrimStart("/").Replace(
                "/",
                [System.IO.Path]::DirectorySeparatorChar
            )

            $fullPath = [System.IO.Path]::GetFullPath(
                (Join-Path $Root $relativePath)
            )

            $rootPrefix = $Root.TrimEnd(
                [System.IO.Path]::DirectorySeparatorChar
            ) + [System.IO.Path]::DirectorySeparatorChar

            if (-not $fullPath.StartsWith(
                $rootPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
                Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" $body ($method -ne "HEAD")
                continue
            }

            if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $body ($method -ne "HEAD")
                continue
            }

            if ($method -ne "GET" -and $method -ne "HEAD") {
                $body = [System.Text.Encoding]::UTF8.GetBytes("405 Method Not Allowed")
                Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" $body $true
                continue
            }

            $body = [System.IO.File]::ReadAllBytes($fullPath)
            $contentType = Get-ContentType $fullPath

            Send-Response $stream 200 "OK" $contentType $body ($method -eq "GET")
        }
        catch {
            Write-Warning $_.Exception.Message
        }
        finally {
            if ($null -ne $client) {
                $client.Close()
            }
        }
    }
}
finally {
    $listener.Stop()
}
