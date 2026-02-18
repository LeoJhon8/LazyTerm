@echo off
chcp 65001 >nul
echo ========================================
echo Lazy Terminal - 修复 Electron 安装
echo ========================================
echo.

echo [1] 清理 npm 缓存...
call npm cache clean --force
echo.

echo [2] 删除旧的 node_modules...
if exist node_modules rmdir /s /q node_modules
echo.

echo [3] 删除 package-lock.json...
if exist package-lock.json del /q package-lock.json
echo.

echo [4] 安装依赖 (使用国内镜像)...
echo 正在从 https://cdn.npmmirror.com 下载 Electron...
call npm install
if errorlevel 1 (
    echo.
    echo [错误] 安装失败！请检查网络连接。
    pause
    exit /b 1
)
echo.

echo [5] 验证 Electron 安装...
if exist node_modules\electron\dist\electron.exe (
    echo [成功] Electron 安装完成！
) else if exist node_modules\electron\dist\electron (
    echo [成功] Electron 安装完成 (Linux/Mac 版本)
) else (
    echo [警告] Electron 可能未正确安装，请手动检查。
)
echo.

echo ========================================
echo 安装完成！现在可以运行: npm start
echo ========================================
pause
