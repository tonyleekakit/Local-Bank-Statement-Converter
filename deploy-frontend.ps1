# 部署 frontend 文件夾到 GitHub 的 PowerShell 腳本

Write-Host "開始部署 frontend 文件夾到 GitHub..." -ForegroundColor Green

# 切換到項目目錄
$projectPath = "c:\Users\User\OneDrive\桌面\Cursor\bank statement converter"
Set-Location $projectPath

Write-Host "當前目錄: $(Get-Location)" -ForegroundColor Yellow

# 檢查是否已初始化 Git
if (-not (Test-Path ".git")) {
    Write-Host "初始化 Git 倉庫..." -ForegroundColor Yellow
    git init
    git branch -M main
}

# 檢查是否已連接遠程倉庫
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
    Write-Host "連接 GitHub 遠程倉庫..." -ForegroundColor Yellow
    git remote add origin https://github.com/tonyleekakit/Local-Bank-Statement-Converter.git
}

# 添加所有文件（.gitignore 會自動排除敏感文件）
Write-Host "添加文件到 Git..." -ForegroundColor Yellow
git add .

# 顯示狀態
Write-Host "`n文件更改狀態:" -ForegroundColor Cyan
git status

# 提交更改
Write-Host "`n提交更改..." -ForegroundColor Yellow
git commit -m "Add frontend directory with login functionality and latest updates"

# 推送到 GitHub
Write-Host "`n推送到 GitHub..." -ForegroundColor Yellow
git push -u origin main

Write-Host "`n✅ 完成！frontend 文件夾已推送到 GitHub" -ForegroundColor Green
Write-Host "請訪問 https://github.com/tonyleekakit/Local-Bank-Statement-Converter 確認" -ForegroundColor Cyan
