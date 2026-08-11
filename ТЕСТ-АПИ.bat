@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   TEST API Yandex Fleet - referralka
echo ==========================================
echo.
echo Sejchas otkroetsya zapros klyucha. Vstav sekret klyucha i nazhmi Enter.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-api.ps1"
echo.
echo Gotovo. Fayl result.txt lezhit ryadom s etim fajlom - prishli ego mne.
pause
