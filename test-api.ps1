# Тест Yandex Fleet API на чистом PowerShell (встроен в Windows, ничего ставить не надо).
# Считает по всем активным водителям комиссию парка за период и её долю (по умолчанию 1/3).
# Результат печатается на экран И сохраняется в result.txt рядом со скриптом.
param(
  [string]$From = "",
  [string]$To = ""
)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$ErrorActionPreference = "Stop"

$script:lines = @()
function Log($s) { Write-Host $s; $script:lines += [string]$s }

# --- конфиг ---
$CLIENT_ID = if ($env:FLEET_CLIENT_ID) { $env:FLEET_CLIENT_ID } else { "422835" }
$PARK_ID   = if ($env:FLEET_PARK_ID) { $env:FLEET_PARK_ID } else { "3878feaa7de447c7954009f526955fef" }
$BASE_URL  = if ($env:FLEET_BASE_URL) { $env:FLEET_BASE_URL.TrimEnd("/") } else { "https://fleet-api.taxi.yandex.net" }
$RATE      = if ($env:REFERRAL_RATE) { [double]$env:REFERRAL_RATE } else { 0.3333333333 }
$COMMISSION_CATS = @()
if ($env:PARK_COMMISSION_CATEGORY_IDS) {
  $COMMISSION_CATS = $env:PARK_COMMISSION_CATEGORY_IDS.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$API_KEY = $env:FLEET_API_KEY
if (-not $API_KEY) { $API_KEY = Read-Host "Вставь секрет ключа (X-Api-Key) и нажми Enter" }
if (-not $API_KEY) { Write-Host "Ключ не введён. Выход."; Start-Sleep 3; exit 1 }

if (-not $From -or -not $To) {
  $toDate = (Get-Date).ToUniversalTime().Date
  $fromDate = $toDate.AddDays(-7)
  $From = $fromDate.ToString("yyyy-MM-ddTHH:mm:ss")
  $To = $toDate.ToString("yyyy-MM-ddTHH:mm:ss")
}

$headers = @{ "X-Client-ID" = $CLIENT_ID; "X-Api-Key" = $API_KEY; "X-Park-ID" = $PARK_ID; "Accept-Language" = "ru" }

function Post-Fleet($path, $bodyObj) {
  $json = $bodyObj | ConvertTo-Json -Depth 12 -Compress
  return Invoke-RestMethod -Uri ($BASE_URL + $path) -Method Post -Headers $headers -Body $json -ContentType "application/json"
}

function Get-Drivers {
  $out = @(); $offset = 0
  while ($true) {
    $data = Post-Fleet "/v1/parks/driver-profiles/list" @{ query = @{ park = @{ id = $PARK_ID } }; limit = 1000; offset = $offset }
    $batch = @($data.driver_profiles)
    if ($batch) { $out += $batch }
    $total = if ($data.total) { [int]$data.total } else { $out.Count }
    $offset += 1000
    if ($offset -ge $total -or $batch.Count -eq 0) { break }
  }
  return $out
}

function Get-Categories {
  try { $data = Post-Fleet "/v2/parks/transactions/categories/list" @{ query = @{ park = @{ id = $PARK_ID } } }; return @($data.categories) }
  catch { return @() }
}

function Get-DriverTx($driverId) {
  $out = @(); $cursor = $null
  while ($true) {
    $body = @{ query = @{ park = @{ id = $PARK_ID; driver_profile = @{ id = $driverId }; transaction = @{ event_at = @{ from = $From; to = $To } } } }; limit = 1000 }
    if ($cursor) { $body["cursor"] = $cursor }
    $data = Post-Fleet "/v2/parks/driver-profiles/transactions/list" $body
    $batch = @($data.transactions)
    if ($batch) { $out += $batch }
    $cursor = $data.cursor
    if (-not $cursor) { break }
  }
  return $out
}

Log ""
Log "Период: $From — $To"
Write-Host "Иду в API Яндекса..."

$legend = @{}
foreach ($c in Get-Categories) { if ($c.id) { $legend[[string]$c.id] = [string]$c.name } }

$drivers = Get-Drivers
$active = @($drivers | Where-Object { $dp = if ($_.driver_profile) { $_.driver_profile } else { $_ }; ($dp.work_status) -ne "fired" })

Log ("Активных водителей: {0}" -f $active.Count)
Log ("Доля реферера: {0}%" -f ([math]::Round($RATE*100,2)))
if ($COMMISSION_CATS.Count -eq 0) {
  Log ""
  Log "! Категория комиссии парка не задана — ниже разбивка по всем категориям списаний."
}
Log ""

$totalCommission = [decimal]0; $totalShare = [decimal]0; $rows = @()
foreach ($p in $active) {
  $dp = if ($p.driver_profile) { $p.driver_profile } else { $p }
  $id = [string]$dp.id
  if (-not $id) { continue }
  $name = (@($dp.last_name, $dp.first_name, $dp.middle_name) | Where-Object { $_ }) -join " "
  if (-not $name) { $name = $id }
  $txs = Get-DriverTx $id
  $byCat = @{}; $commission = [decimal]0
  foreach ($tx in $txs) {
    $amt = [decimal]$tx.amount
    if ($amt -lt 0) {
      $cat = if ($tx.category_id) { [string]$tx.category_id } elseif ($tx.category_name) { [string]$tx.category_name } else { "unknown" }
      if (-not $byCat.ContainsKey($cat)) { $byCat[$cat] = [decimal]0 }
      $byCat[$cat] += (-$amt)
      if ($COMMISSION_CATS -contains $cat) { $commission += (-$amt) }
    }
  }
  $commission = [math]::Round($commission, 2)
  $share = [math]::Round($commission * [decimal]$RATE, 2)
  $rows += [pscustomobject]@{ Name = $name; Commission = $commission; Share = $share; ByCat = $byCat }
  $totalCommission += $commission; $totalShare += $share
}

$rows = $rows | Sort-Object -Property Commission -Descending
foreach ($r in $rows) {
  Log ("  {0,-28} комиссия парка: {1,12:N2} руб   доля: {2,10:N2} руб" -f $r.Name, $r.Commission, $r.Share)
  if ($COMMISSION_CATS.Count -eq 0) {
    foreach ($k in $r.ByCat.Keys) {
      $label = if ($legend[$k]) { $legend[$k] } else { $k }
      Log ("        - {0} ({1}): {2:N2} руб" -f $label, $k, $r.ByCat[$k])
    }
  }
}

Log ""
Log "=== ИТОГО ==="
Log ("Комиссия парка (все активные): {0:N2} руб   <- сверь с доходом парка" -f [math]::Round($totalCommission,2))
Log ("Доля рефереров ({0}%): {1:N2} руб" -f ([math]::Round($RATE*100,2)), [math]::Round($totalShare,2))
Log ""

$outFile = Join-Path $PSScriptRoot "result.txt"
$script:lines | Out-File -FilePath $outFile -Encoding UTF8
Write-Host ("Результат сохранён в файл: {0}" -f $outFile)
Write-Host "Пришли мне этот файл (result.txt) или скопируй текст выше."
