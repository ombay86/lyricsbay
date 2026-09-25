@echo off
title LyricsBay - vMix Controller
echo ===================================================
echo     MEMULAI SERVER LYRICSBAY (PORT 3000)
echo ===================================================
echo.
echo Membuka Panel Operator di browser...
start http://localhost:3000
echo.
echo Server sedang berjalan. Jangan tutup jendela ini selama acara.
echo Untuk mematikan server, tekan Ctrl + C atau tutup jendela ini.
echo ===================================================
node server.js
pause
