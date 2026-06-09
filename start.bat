@echo off
cd /d "%~dp0"
echo 啟動本機伺服器 http://localhost:3000
echo 顧客頁: http://localhost:3000/
echo 後台:   http://localhost:3000/admin.html
echo.
start "" "http://localhost:3000/admin.html"
python server.py
pause
