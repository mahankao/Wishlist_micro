param(
    [Parameter(Mandatory = $true)]
    [string] $BaseUrl,

    [Parameter(Mandatory = $true)]
    [string] $WishlistId,

    [Parameter(Mandatory = $true)]
    [string] $ItemId,

    [Parameter(Mandatory = $true)]
    [string] $FirstBearerToken,

    [Parameter(Mandatory = $true)]
    [string] $SecondBearerToken
)

$ErrorActionPreference = "Stop"

$uri = "$BaseUrl/wishlists/$WishlistId/items/$ItemId/reserve"

function Start-ReserveRequest {
    param([string] $Token)

    Start-Job -ScriptBlock {
        param($RequestUri, $BearerToken)

        Add-Type -AssemblyName System.Net.Http

        $client = [System.Net.Http.HttpClient]::new()
        try {
            $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $RequestUri)
            $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $BearerToken)
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

            [pscustomobject]@{
                StatusCode = [int] $response.StatusCode
                Body = $body
            }
        }
        catch {
            [pscustomobject]@{
                StatusCode = -1
                Body = $_.Exception.Message
            }
        }
        finally {
            if ($request) {
                $request.Dispose()
            }

            $client.Dispose()
        }
    } -ArgumentList $uri, $Token
}

$jobs = @(
    Start-ReserveRequest -Token $FirstBearerToken
    Start-ReserveRequest -Token $SecondBearerToken
)

$results = $jobs | Receive-Job -Wait -AutoRemoveJob
$results | Format-Table -AutoSize

$statusCodes = @($results | ForEach-Object { $_.StatusCode } | Sort-Object)
if ($statusCodes -contains 200 -and $statusCodes -contains 409) {
    Write-Host "OK: exactly one reserve succeeded and one returned 409 Conflict."
    exit 0
}

Write-Error "Expected one 200 and one 409, got: $($statusCodes -join ', ')"
