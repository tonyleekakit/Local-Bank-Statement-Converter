// 設置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const status = document.getElementById('status');
const loading = document.getElementById('loading');
const previewContainer = document.getElementById('previewContainer');
const previewBody = document.getElementById('previewBody');
const downloadBtn = document.getElementById('downloadBtn');

// Document AI 配置相關元素
const toggleConfigBtn = document.getElementById('toggleConfigBtn');
const apiConfigContent = document.getElementById('apiConfigContent');
const projectIdInput = document.getElementById('projectIdInput');
const locationInput = document.getElementById('locationInput');
const processorIdInput = document.getElementById('processorIdInput');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const clearConfigBtn = document.getElementById('clearConfigBtn');
const configStatus = document.getElementById('configStatus');

let extractedData = [];

// 框線可視化相關變量
let currentPDF = null;
let currentHeaderRow = null;
let currentPageWidth = null;
let visualizationCanvases = [];

// 可拖動框線相關變量
let draggableBoundaries = null; // 存儲當前可拖動的框線位置
let draggingBoundary = null; // 當前正在拖動的框線
let dragOffset = 0; // 拖動偏移量
let canvasScale = 1.5; // canvas縮放比例
let pdfRenderTask = null; // PDF渲染任務（用於取消）
let redrawTimeout = null; // 防抖定時器
let pdfImageData = null; // 緩存的PDF圖像數據

// Document AI API 配置管理
const API_CONFIG_KEY = 'documentAI_config';

// 初始化 API 配置
function initAPIConfig() {
    const config = loadAPIConfig();
    if (config) {
        projectIdInput.value = config.projectId || '';
        locationInput.value = config.location || 'us';
        processorIdInput.value = config.processorId || '';
        
        updateConfigStatus('已載入保存的配置', 'success');
        
        // 顯示配置狀態
        if (config.projectId) {
            console.log('Document AI 配置已載入:', {
                projectId: config.projectId,
                location: config.location,
                processorId: config.processorId ? '已配置' : '未配置'
            });
        }
    }
    
    // 配置切換按鈕
    toggleConfigBtn.addEventListener('click', () => {
        const isVisible = apiConfigContent.style.display !== 'none';
        apiConfigContent.style.display = isVisible ? 'none' : 'block';
        toggleConfigBtn.textContent = isVisible ? '顯示配置' : '隱藏配置';
    });
    
    // 保存配置
    saveConfigBtn.addEventListener('click', () => {
        const config = {
            projectId: projectIdInput.value.trim(),
            location: locationInput.value.trim() || 'us',
            processorId: processorIdInput.value.trim()
        };
        
        if (!config.projectId) {
            updateConfigStatus('請填寫項目 ID', 'error');
            return;
        }
        
        saveAPIConfig(config);
        
        const message = config.processorId 
            ? '配置已保存！下次上傳 PDF 時將使用 Document AI Form Parser'
            : '配置已保存！下次上傳 PDF 時將使用 Document AI 識別（未配置 Processor ID，無法使用表格可視化）';
        updateConfigStatus(message, 'success');
        console.log('Document AI 配置已保存:', {
            projectId: config.projectId,
            location: config.location,
            processorId: config.processorId ? '已配置' : '未配置'
        });
    });
    
    // 清除配置
    clearConfigBtn.addEventListener('click', () => {
        if (confirm('確定要清除配置嗎？')) {
            clearAPIConfig();
            projectIdInput.value = '';
            locationInput.value = 'us';
            processorIdInput.value = '';
            updateConfigStatus('配置已清除', 'info');
        }
    });
}

// 保存 API 配置到 localStorage
function saveAPIConfig(config) {
    try {
        localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
        console.error('保存配置失敗:', error);
    }
}

// 從 localStorage 載入 API 配置
function loadAPIConfig() {
    try {
        const configStr = localStorage.getItem(API_CONFIG_KEY);
        return configStr ? JSON.parse(configStr) : null;
    } catch (error) {
        console.error('載入配置失敗:', error);
        return null;
    }
}

// 清除 API 配置
function clearAPIConfig() {
    try {
        localStorage.removeItem(API_CONFIG_KEY);
    } catch (error) {
        console.error('清除配置失敗:', error);
    }
}

// 更新配置狀態顯示
function updateConfigStatus(message, type) {
    configStatus.textContent = message;
    configStatus.className = `status ${type}`;
    configStatus.style.display = 'block';
    setTimeout(() => {
        configStatus.style.display = 'none';
    }, 3000);
}

// 初始化配置
initAPIConfig();

// 關鍵字列表（支持多種變體，包括更多銀行常用詞彙）
const KEYWORDS = {
    balance: ['balance', '餘額', '結餘', '結存', 'balance b/f', 'balance c/f'],
    withdrawal: ['withdrawal', 'withdraw', '支出', '提取', '提款', 'debit', '付款', '支付'],
    deposit: ['deposit', '存入', '存款', 'credit', '收入', '收款'],
    date: ['date', '日期', '交易日期', '交易日', 'posting date', 'value date']
};

// 拖放功能
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        handleFile(files[0]);
    } else {
        showStatus('請選擇PDF檔案', 'error');
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

function showStatus(message, type = 'info') {
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
}

function hideStatus() {
    status.style.display = 'none';
}

async function handleFile(file) {
    hideStatus();
    loading.classList.add('show');
    previewContainer.style.display = 'none';
    downloadBtn.classList.remove('show');
    extractedData = [];

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        showStatus(`PDF載入成功，共 ${pdf.numPages} 頁`, 'info');
        
        // 步驟1：識別銀行類型
        const bankType = await identifyBank(pdf);
        const config = loadAPIConfig();
        
        // 檢查是否已登入（使用 Supabase 認證）
        let hasAuth = false;
        if (window.supabase) {
            const { data: { session } } = await window.supabase.auth.getSession();
            hasAuth = !!session;
        }
        
        // 檢查 Document AI 配置（現在只需要 projectId 和 processorId，認證在後端處理）
        const hasDocumentAIConfig = config && config.projectId && config.processorId;
        const usedDocumentAI = hasAuth && hasDocumentAIConfig;
        
        // 調試信息
        if (config && config.processorId) {
            console.log('Document AI 配置檢查:', {
                hasConfig: !!config,
                hasProcessorId: !!config.processorId,
                hasProjectId: !!config.projectId,
                hasAuth: hasAuth,
                canUseDocumentAI: usedDocumentAI
            });
            
            if (!hasAuth) {
                console.warn('⚠️ 請先登入以使用 Document AI 功能');
            } else if (!hasDocumentAIConfig) {
                console.warn('⚠️ Document AI 配置不完整，請配置 Project ID 和 Processor ID');
            }
        }
        
        // 保存識別結果，用於後續顯示
        let bankInfo = '';
        if (bankType) {
            const bankNames = {
                'hangseng': '恒生銀行',
                'hsbc': '匯豐銀行',
                'boc': '中銀香港'
            };
            const bankName = bankNames[bankType] || bankType;
            const method = usedDocumentAI ? '（Document AI）' : '（本地識別）';
            bankInfo = `${bankName} ${method}`;
            console.log('識別到的銀行類型：', bankType, method);
            // 顯示識別結果（短暫顯示，讓用戶看到）
            showStatus(`✓ 識別到銀行類型：${bankInfo}`, 'success');
            // 延遲一下，讓用戶看到識別結果
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
            bankInfo = '未識別（使用默認：恒生銀行）';
            console.log('未能識別銀行類型，使用默認模板（恒生銀行）');
        }
        
        // 如果配置了 Processor ID 且已登入，調用 Document AI Form Parser 並可視化表格
        let documentAIResult = null;
        if (usedDocumentAI) {
            try {
                console.log('準備調用 Document AI Form Parser...', {
                    processorId: config.processorId,
                    projectId: config.projectId,
                    location: config.location || 'us'
                });
                showStatus('正在調用 Document AI Form Parser...', 'info');
                documentAIResult = await callDocumentAIFormParser(pdf, config);
                
                if (documentAIResult && documentAIResult.document) {
                    const tableCount = documentAIResult.document.pages?.reduce((sum, page) => 
                        sum + (page.tables?.length || 0), 0) || 0;
                    showStatus(`✓ Document AI 檢測到 ${tableCount} 個表格`, 'success');
                    
                    // 自動可視化表格
                    await visualizeDocumentAITables(pdf, documentAIResult);
                    console.log('✅ Document AI 表格可視化已完成');
                }
            } catch (error) {
                console.error('❌ Document AI Form Parser 調用失敗:', error);
                const errorMsg = error.message || '未知錯誤';
                
                // 根據錯誤類型提供更詳細的提示
                let userMessage = `⚠️ Document AI 調用失敗: ${errorMsg}`;
                let helpMessage = '';
                
                if (errorMsg.includes('401') || errorMsg.includes('認證失敗') || errorMsg.includes('未授權')) {
                    userMessage = '⚠️ 認證失敗：請確保您已登入';
                    helpMessage = '📌 認證問題提示：\n' +
                        '1. 請確保您已登入 Supabase 帳號\n' +
                        '2. 檢查瀏覽器的登入狀態\n' +
                        '3. 如果問題持續，請嘗試重新登入';
                } else if (errorMsg.includes('404') || errorMsg.includes('未找到')) {
                    userMessage = '⚠️ Processor ID 不正確或資源未找到';
                    helpMessage = '📌 配置問題提示：\n' +
                        '1. 檢查 Processor ID 是否正確\n' +
                        '2. 確認 Project ID 和 Location 是否正確\n' +
                        '3. 確認該 Processor 是否存在並已啟用';
                } else if (errorMsg.includes('403') || errorMsg.includes('權限不足')) {
                    userMessage = '⚠️ 權限不足：您沒有使用此功能的權限';
                    helpMessage = '📌 權限問題提示：\n' +
                        '1. 檢查您的帳號是否有權限使用 Document AI\n' +
                        '2. 確認 Service Account 是否已配置\n' +
                        '3. 聯繫管理員檢查權限設置';
                } else if (errorMsg.includes('500') || errorMsg.includes('伺服器錯誤')) {
                    userMessage = '⚠️ 伺服器錯誤：後端服務暫時不可用';
                    helpMessage = '📌 服務問題提示：\n' +
                        '1. 檢查 Service Account 配置是否正確\n' +
                        '2. 確認 Google Cloud 服務是否正常\n' +
                        '3. 稍後再試';
                } else if (errorMsg.includes('未配置')) {
                    userMessage = '⚠️ 配置缺失：請配置必要的參數';
                    helpMessage = '📌 配置問題提示：\n' +
                        '1. 請在配置中填寫 Project ID\n' +
                        '2. 請填寫 Processor ID\n' +
                        '3. 選擇正確的 Location（如 us、asia 等）';
                }
                
                // 顯示錯誤信息
                showStatus(userMessage + '\n\n繼續使用本地提取方法', 'error');
                
                // 在控制台輸出詳細幫助信息
                if (helpMessage) {
                    console.warn(helpMessage);
                }
                
                // 輸出完整錯誤對象（用於調試）
                console.error('錯誤詳情:', {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                });
            }
        }
        
        // 處理每一頁
        let headerRow = null;
        let dataRows = [];
        let allLines = []; // 用於調試
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // 將文本內容轉換為結構化數據
            const textItems = textContent.items;
            const lines = groupTextItemsIntoLines(textItems);
            allLines = allLines.concat(lines);
            
            // 在當前頁尋找標題行
            const foundHeaderRow = findHeaderRow(lines);
            if (foundHeaderRow) {
                headerRow = foundHeaderRow;
                showStatus(`在第 ${pageNum} 頁找到標題行`, 'success');
                console.log('找到標題行:', foundHeaderRow.line.map(item => item.text).join(' | '));
                
                // 保存PDF和標題行，用於可視化
                currentPDF = pdf;
                currentHeaderRow = foundHeaderRow;
                
                // 獲取頁面寬度
                const viewport = page.getViewport({ scale: 1.0 });
                currentPageWidth = viewport.width;
            }
        }
        
        if (!headerRow) {
            // 調試：顯示前20行的內容，幫助診斷問題
            console.log('未找到標題行，前20行內容：');
            allLines.slice(0, 20).forEach((line, idx) => {
                const lineText = line.map(item => item.text).join(' | ');
                console.log(`行 ${idx + 1}:`, lineText);
            });
            
            // 嘗試找出部分匹配的行（可能缺少某些關鍵字）
            console.log('尋找部分匹配的行（可能缺少某些關鍵字）：');
            const partialMatches = [];
            allLines.slice(0, 30).forEach((line, idx) => {
                const lineText = line.map(item => item.text).join(' ').toLowerCase();
                let matchCount = 0;
                const matches = [];
                
                if (lineText.includes('date') || lineText.includes('日期')) {
                    matchCount++;
                    matches.push('Date');
                }
                if (lineText.includes('deposit') || lineText.includes('存入') || lineText.includes('存款')) {
                    matchCount++;
                    matches.push('Deposit');
                }
                if (lineText.includes('withdrawal') || lineText.includes('支出') || lineText.includes('提取')) {
                    matchCount++;
                    matches.push('Withdrawal');
                }
                if (lineText.includes('balance') || lineText.includes('餘額') || lineText.includes('結餘')) {
                    matchCount++;
                    matches.push('Balance');
                }
                
                if (matchCount >= 2) {
                    partialMatches.push({ line: idx + 1, matches, text: line.map(item => item.text).join(' | ') });
                }
            });
            
            if (partialMatches.length > 0) {
                console.log('找到部分匹配的行：');
                partialMatches.forEach(m => {
                    console.log(`行 ${m.line} (匹配: ${m.matches.join(', ')}):`, m.text);
                });
            }
            
            showStatus('未找到包含 Date、Deposit、Withdrawal、Balance 的標題行。請打開瀏覽器控制台（F12）查看詳細信息。', 'error');
            loading.classList.remove('show');
            return;
        }
        
        // 步驟2：使用對應的銀行模板提取數據
        let foundEndMarker = false; // 標記是否找到 C/F BALANCE（僅用於匯豐銀行）
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const textItems = textContent.items;
            const lines = groupTextItemsIntoLines(textItems);
            
            // 獲取頁面寬度（用於相對百分比換算）
            const viewport = page.getViewport({ scale: 1.0 });
            const pageWidth = viewport.width;
            
            // 根據銀行類型選擇對應的模板
            const result = extractDataRowsWithTemplate(lines, headerRow, bankType, pageWidth);
            
            // 處理返回結果（可能是數組或對象）
            if (Array.isArray(result)) {
                // 恒生銀行：返回數組
                dataRows = dataRows.concat(result);
            } else if (result && result.dataRows) {
                // 匯豐銀行：返回對象 { dataRows, foundEndMarker }
                dataRows = dataRows.concat(result.dataRows);
                if (result.foundEndMarker) {
                    foundEndMarker = true;
                    console.log(`✓ 在第 ${pageNum} 頁找到 C/F BALANCE，停止處理後續頁面`);
                    break; // 停止處理後續頁面
                }
            } else {
                // 兼容舊版本：如果返回的是數組
                dataRows = dataRows.concat(result || []);
            }
        }
        
        extractedData = dataRows;
        console.log(`提取到 ${extractedData.length} 筆資料`);
        if (extractedData.length > 0) {
            console.log('第一筆資料範例:', extractedData[0]);
        }
        
        displayPreview(extractedData);
        downloadBtn.classList.add('show');
        
        // 如果找到標題行，顯示框線可視化按鈕
        const showVisualizationBtn = document.getElementById('showVisualizationBtn');
        const exportBoundariesBtn = document.getElementById('exportBoundariesBtn');
        
        console.log('檢查可視化按鈕顯示條件:', {
            hasCurrentPDF: !!currentPDF,
            hasCurrentHeaderRow: !!currentHeaderRow,
            showVisualizationBtn: !!showVisualizationBtn,
            exportBoundariesBtn: !!exportBoundariesBtn
        });
        
        if (currentPDF && currentHeaderRow) {
            if (showVisualizationBtn) {
                showVisualizationBtn.style.display = 'inline-block';
                console.log('✓ 已顯示「顯示框線標記」按鈕');
            } else {
                console.warn('⚠️ 找不到 showVisualizationBtn 元素');
            }
            if (exportBoundariesBtn) {
                exportBoundariesBtn.style.display = 'inline-block';
                console.log('✓ 已顯示「導出框線配置」按鈕');
            }
        } else {
            console.warn('⚠️ 無法顯示可視化按鈕:', {
                currentPDF: !!currentPDF,
                currentHeaderRow: !!currentHeaderRow
            });
        }
        
        // 如果使用了 Document AI Form Parser，添加一個按鈕來重新顯示表格可視化
        if (documentAIResult) {
            // 保存 Document AI 結果供後續使用
            window.lastDocumentAIResult = documentAIResult;
            
            // 如果可視化容器已顯示，不需要額外操作
            // 否則可以添加一個按鈕來顯示表格可視化
            const container = document.getElementById('visualizationContainer');
            if (container && container.style.display === 'none') {
                // 可視化已經在調用時自動顯示了，這裡不需要額外操作
            }
        }
        
        // 顯示最終結果，包含銀行識別信息
        const finalMessage = bankInfo 
            ? `✓ 銀行類型：${bankInfo} | 成功提取 ${extractedData.length} 筆資料`
            : `成功提取 ${extractedData.length} 筆資料`;
        showStatus(finalMessage, 'success');
        
    } catch (error) {
        console.error('處理PDF時發生錯誤:', error);
        showStatus('處理PDF時發生錯誤: ' + error.message, 'error');
    } finally {
        loading.classList.remove('show');
    }
}

// 將文本項目分組為行
function groupTextItemsIntoLines(textItems) {
    const lines = [];
    let currentLine = [];
    let currentY = null;
    
    // 按Y座標排序（從上到下）
    const sortedItems = [...textItems].sort((a, b) => {
        const yA = a.transform ? a.transform[5] : (a.y || 0);
        const yB = b.transform ? b.transform[5] : (b.y || 0);
        return yB - yA; // 降序排列
    });
    
    const Y_THRESHOLD = 5; // Y座標容差（增大以提高容錯性）
    
    sortedItems.forEach(item => {
        const y = item.transform ? item.transform[5] : (item.y || 0);
        const x = item.transform ? item.transform[4] : (item.x || 0);
        const text = item.str.trim();
        
        if (!text) return;
        
        if (currentY === null || Math.abs(y - currentY) <= Y_THRESHOLD) {
            // 同一行
            currentLine.push({ text, x, y });
            if (currentY === null) currentY = y;
        } else {
            // 新行
            if (currentLine.length > 0) {
                // 按X座標排序（從左到右）
                currentLine.sort((a, b) => a.x - b.x);
                lines.push(currentLine);
            }
            currentLine = [{ text, x, y }];
            currentY = y;
        }
    });
    
    // 添加最後一行
    if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.x - b.x);
        lines.push(currentLine);
    }
    
    return lines;
}

// 尋找標題行（包含 Date、Deposit、Withdrawal、Balance）
function findHeaderRow(lines) {
    // 方法1：嘗試在同一行找到所有關鍵字（嚴格模式）
    for (const line of lines) {
        const lineText = line.map(item => item.text).join(' ').toLowerCase();
        const lineTextLower = lineText.toLowerCase();
        
        // 檢查是否包含所有關鍵字（支持多種變體）
        let hasBalance = false, hasWithdrawal = false, hasDeposit = false, hasDate = false;
        
        for (const kw of KEYWORDS.balance) {
            if (lineTextLower.includes(kw.toLowerCase())) {
                hasBalance = true;
                break;
            }
        }
        for (const kw of KEYWORDS.withdrawal) {
            if (lineTextLower.includes(kw.toLowerCase())) {
                hasWithdrawal = true;
                break;
            }
        }
        for (const kw of KEYWORDS.deposit) {
            if (lineTextLower.includes(kw.toLowerCase())) {
                hasDeposit = true;
                break;
            }
        }
        for (const kw of KEYWORDS.date) {
            if (lineTextLower.includes(kw.toLowerCase())) {
                hasDate = true;
                break;
            }
        }
        
        if (hasBalance && hasWithdrawal && hasDeposit && hasDate) {
            // 尋找關鍵字索引（支持多種變體）
            const balanceIndex = findKeywordIndex(line, KEYWORDS.balance);
            const withdrawalIndex = findKeywordIndex(line, KEYWORDS.withdrawal);
            const depositIndex = findKeywordIndex(line, KEYWORDS.deposit);
            const dateIndex = findKeywordIndex(line, KEYWORDS.date);
            
            if (balanceIndex !== -1 && withdrawalIndex !== -1 && 
                depositIndex !== -1 && dateIndex !== -1) {
                // 檢查順序：Date < Deposit < Withdrawal < Balance (從左到右)
                // 但放寬要求：只要順序大致正確即可（允許一些偏差）
                const indices = [dateIndex, depositIndex, withdrawalIndex, balanceIndex].sort((a, b) => a - b);
                const isOrdered = dateIndex < depositIndex && 
                                 depositIndex < withdrawalIndex && 
                                 withdrawalIndex < balanceIndex;
                
                // 如果順序正確，直接返回
                if (isOrdered) {
                    return {
                        line: line,
                        indices: {
                            date: dateIndex,
                            deposit: depositIndex,
                            withdrawal: withdrawalIndex,
                            balance: balanceIndex
                        }
                    };
                }
                // 如果順序不完全正確，但所有關鍵字都在同一行，也嘗試使用（放寬模式）
                // 按照找到的順序重新排列
                const sortedIndices = {
                    date: dateIndex,
                    deposit: depositIndex,
                    withdrawal: withdrawalIndex,
                    balance: balanceIndex
                };
                
                // 按照X座標排序，確定實際順序
                const itemsWithKeywords = [
                    { key: 'date', index: dateIndex, x: line[dateIndex]?.x || 0 },
                    { key: 'deposit', index: depositIndex, x: line[depositIndex]?.x || 0 },
                    { key: 'withdrawal', index: withdrawalIndex, x: line[withdrawalIndex]?.x || 0 },
                    { key: 'balance', index: balanceIndex, x: line[balanceIndex]?.x || 0 }
                ].sort((a, b) => a.x - b.x);
                
                // 如果最左邊是date，最右邊是balance，則認為是有效的
                if (itemsWithKeywords[0].key === 'date' && 
                    itemsWithKeywords[itemsWithKeywords.length - 1].key === 'balance') {
                    return {
                        line: line,
                        indices: sortedIndices
                    };
                }
            }
        }
    }
    
    // 方法2：嘗試在相鄰的幾行中找到所有關鍵字（多行標題模式）
    for (let i = 0; i < lines.length - 2; i++) {
        const currentLine = lines[i];
        const nextLine = lines[i + 1];
        const combinedLines = [currentLine, nextLine];
        
        // 合併相鄰行的文本
        const allTextItems = [];
        combinedLines.forEach(l => {
            l.forEach(item => allTextItems.push(item));
        });
        allTextItems.sort((a, b) => a.x - b.x);
        
        const combinedText = allTextItems.map(item => item.text).join(' ').toLowerCase();
        
        let hasBalance = false, hasWithdrawal = false, hasDeposit = false, hasDate = false;
        
        for (const kw of KEYWORDS.balance) {
            if (combinedText.includes(kw.toLowerCase())) {
                hasBalance = true;
                break;
            }
        }
        for (const kw of KEYWORDS.withdrawal) {
            if (combinedText.includes(kw.toLowerCase())) {
                hasWithdrawal = true;
                break;
            }
        }
        for (const kw of KEYWORDS.deposit) {
            if (combinedText.includes(kw.toLowerCase())) {
                hasDeposit = true;
                break;
            }
        }
        for (const kw of KEYWORDS.date) {
            if (combinedText.includes(kw.toLowerCase())) {
                hasDate = true;
                break;
            }
        }
        
        if (hasBalance && hasWithdrawal && hasDeposit && hasDate) {
            // 在合併的文本中尋找索引
            const balanceIndex = findKeywordIndexInCombined(allTextItems, KEYWORDS.balance);
            const withdrawalIndex = findKeywordIndexInCombined(allTextItems, KEYWORDS.withdrawal);
            const depositIndex = findKeywordIndexInCombined(allTextItems, KEYWORDS.deposit);
            const dateIndex = findKeywordIndexInCombined(allTextItems, KEYWORDS.date);
            
            if (balanceIndex !== -1 && withdrawalIndex !== -1 && 
                depositIndex !== -1 && dateIndex !== -1) {
                // 使用合併後的索引
                return {
                    line: allTextItems,
                    indices: {
                        date: dateIndex,
                        deposit: depositIndex,
                        withdrawal: withdrawalIndex,
                        balance: balanceIndex
                    },
                    isMultiLine: true
                };
            }
        }
    }
    
    return null;
}

// 在合併的文本項目中尋找關鍵字索引
function findKeywordIndexInCombined(items, keywords) {
    const keywordList = Array.isArray(keywords) ? keywords : [keywords];
    
    for (let i = 0; i < items.length; i++) {
        const itemText = items[i].text.toLowerCase();
        for (const keyword of keywordList) {
            if (itemText.includes(keyword.toLowerCase())) {
                return i;
            }
        }
    }
    return -1;
}

// 在行中尋找關鍵字的索引（支持關鍵字列表）
function findKeywordIndex(line, keywords) {
    const keywordList = Array.isArray(keywords) ? keywords : [keywords];
    
    for (let i = 0; i < line.length; i++) {
        const itemText = line[i].text.toLowerCase();
        for (const keyword of keywordList) {
            if (itemText.includes(keyword.toLowerCase())) {
                return i;
            }
        }
    }
    return -1;
}

// 識別銀行類型（主函數，優先使用 Document AI，失敗時回退到本地識別）
async function identifyBank(pdf) {
    const config = loadAPIConfig();
    
    // 如果配置了 Document AI，優先使用
    if (config && config.projectId) {
        // 檢查是否已登入（認證在後端處理）
        let hasAuth = false;
        if (window.supabase) {
            const { data: { session } } = await window.supabase.auth.getSession();
            hasAuth = !!session;
        }
        
        if (hasAuth) {
            try {
                const bankType = await identifyBankWithDocumentAI(pdf, config);
                if (bankType) {
                    console.log('Document AI 識別成功:', bankType);
                    return bankType;
                }
            } catch (error) {
                console.warn('Document AI 識別失敗，回退到本地識別:', error);
                // 繼續執行本地識別
            }
        }
    }
    
    // 回退到本地識別（檢查多頁）
    return await identifyBankLocal(pdf);
}

// 使用 Document AI 識別銀行類型
async function identifyBankWithDocumentAI(pdf, config) {
    try {
        // 讀取第一頁文本內容進行分析
        const firstPage = await pdf.getPage(1);
        const textContent = await firstPage.getTextContent();
        const textItems = textContent.items;
        const allText = textItems.map(item => item.str).join(' ');
        
        // 首先嘗試使用文本分析（快速方法）
        const bankType = analyzeBankFromText(allText);
        if (bankType) {
            return bankType;
        }
        
        // 如果配置了 Processor ID，嘗試使用 Document AI API
        if (config.processorId) {
            try {
                const result = await callDocumentAIFormParser(pdf, config);
                if (result && result.document) {
                    const extractedText = result.document.text || '';
                    const bankTypeFromAI = analyzeBankFromText(extractedText);
                    if (bankTypeFromAI) {
                        return bankTypeFromAI;
                    }
                }
            } catch (error) {
                console.warn('Document AI API 調用失敗，回退到本地識別:', error);
            }
        }
        
        // 當前實現：如果文本分析失敗，返回 null，讓系統回退到本地識別
        return null;
    } catch (error) {
        console.error('Document AI 識別錯誤:', error);
        throw error;
    }
}

// 調用 Document AI Form Parser API（通過 Supabase Edge Function）
// 返回完整的 Document AI 結果，包含表格座標信息
async function callDocumentAIFormParser(pdf, config) {
    if (!config.processorId) {
        throw new Error('未配置 Processor ID');
    }
    
    if (!config.projectId) {
        throw new Error('未配置 Project ID');
    }
    
    // 檢查是否已登入
    if (!window.supabase) {
        throw new Error('Supabase 客戶端未初始化。請確保已載入 auth.js');
    }
    
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session) {
        throw new Error('請先登入以使用 Document AI 功能');
    }
    
    try {
        // 獲取 PDF 文件
        const fileInput = document.getElementById('fileInput');
        if (!fileInput || !fileInput.files || !fileInput.files[0]) {
            throw new Error('無法獲取 PDF 文件');
        }
        
        const file = fileInput.files[0];
        
        // 構建 Supabase Edge Function URL
        const supabaseUrl = window.supabase.supabaseUrl;
        const edgeFunctionUrl = `${supabaseUrl}/functions/v1/documentai-process`;
        
        console.log('調用 Supabase Edge Function (Document AI)...');
        showStatus('正在調用 Document AI Form Parser...', 'info');
        
        // 準備 FormData
        const formData = new FormData();
        formData.append('pdf', file);
        formData.append('projectId', config.projectId);
        formData.append('location', config.location || 'us');
        formData.append('processorId', config.processorId);
        
        // 調用 Supabase Edge Function
        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: '未知錯誤' }));
            let errorMessage = `Document AI API 錯誤 (${response.status})`;
            
            if (response.status === 401) {
                errorMessage = '認證失敗 (401)：請確保您已登入並有權限使用此功能';
            } else if (response.status === 403) {
                errorMessage = '權限不足 (403)：您沒有權限使用此功能';
            } else if (response.status === 404) {
                errorMessage = '資源未找到 (404)：Processor ID 可能不正確';
            } else if (errorData.error) {
                errorMessage = errorData.error;
            }
            
            console.error('API 錯誤詳情:', {
                status: response.status,
                statusText: response.statusText,
                errorBody: errorData
            });
            
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        
        // 調試：輸出完整的響應數據
        console.log('✅ Document AI Form Parser 調用成功');
        console.log('完整響應結構:', {
            hasSuccess: 'success' in result,
            hasDocument: !!result.document,
            documentPages: result.document?.pages?.length || 0,
            firstPageTables: result.document?.pages?.[0]?.tables?.length || 0
        });
        
        // 驗證響應格式
        if (!result.success) {
            console.warn('⚠️ Edge Function 返回 success: false');
        }
        
        if (!result.document) {
            console.warn('⚠️ Edge Function 響應中缺少 document 屬性');
        } else {
            // 輸出表格統計信息
            const totalTables = result.document.pages?.reduce((sum, page) => 
                sum + (page.tables?.length || 0), 0) || 0;
            console.log(`📊 檢測到 ${totalTables} 個表格（跨 ${result.document.pages?.length || 0} 頁）`);
            
            // 詳細表格信息
            result.document.pages?.forEach((page, pageIndex) => {
                const pageTables = page.tables?.length || 0;
                if (pageTables > 0) {
                    console.log(`  第 ${pageIndex + 1} 頁: ${pageTables} 個表格`);
                    page.tables?.forEach((table, tableIndex) => {
                        const headerRows = table.headerRows?.length || 0;
                        const bodyRows = table.bodyRows?.length || 0;
                        console.log(`    表格 ${tableIndex + 1}: ${headerRows} 行標題, ${bodyRows} 行數據`);
                    });
                }
            });
        }
        
        return result;
    } catch (error) {
        console.error('Document AI Form Parser API 調用失敗:', error);
        throw error;
    }
}

// 從文本中分析銀行類型（輔助函數）
function analyzeBankFromText(text) {
    const lowerText = text.toLowerCase();
    
    // 調試：檢查所有銀行關鍵字匹配
    console.log('檢查銀行關鍵字匹配:');
    const checks = {
        '恒生 - hang seng bank': lowerText.includes('hang seng bank'),
        '恒生 - hang seng': lowerText.includes('hang seng'),
        '恒生 - 恒生': lowerText.includes('恒生'),
        '恒生 - hangseng': lowerText.includes('hangseng'),
        '恒生 - bank code 024': lowerText.includes('bank code') && /024/.test(text),
        '匯豐 - hsbc': lowerText.includes('hsbc'),
        '匯豐 - 滙豐': lowerText.includes('滙豐'),
        '匯豐 - hongkong and shanghai banking': lowerText.includes('hongkong and shanghai banking'),
        '中銀 - bank of china': lowerText.includes('bank of china'),
        '中銀 - 中銀': lowerText.includes('中銀'),
        '中銀 - boc': lowerText.includes('boc')
    };
    console.table(checks);
    
    // 檢查銀行代碼（恒生銀行：024）
    if (lowerText.includes('bank code') && /024/.test(text)) {
        console.log('✓ 通過銀行代碼 024 識別為恒生銀行');
        return 'hangseng';
    }
    
    // 恒生銀行識別特徵（添加 "hang seng bank"）
    // 注意：排除地址中的 "hang shing street" 等
    const hangSengPattern = /\bhang\s+seng\s+bank\b/i;
    const hangSengSimple = /\bhang\s+seng\b/i;
    // 檢查是否在地址中（避免誤匹配）
    const isInAddress = /hang\s+shing\s+street/i.test(text) || 
                        /hang\s+fung\s+street/i.test(text) ||
                        /hang\s+loong\s+street/i.test(text);
    
    if (hangSengPattern.test(text) && !isInAddress) {
        console.log('✓ 通過 "Hang Seng Bank" 識別為恒生銀行');
        return 'hangseng';
    }
    
    if ((hangSengSimple.test(text) || lowerText.includes('恒生') || lowerText.includes('hangseng')) && !isInAddress) {
        console.log('✓ 通過關鍵字識別為恒生銀行');
        return 'hangseng';
    }
    
    if (lowerText.includes('h.s.b.c.') && lowerText.includes('hang seng') && !isInAddress) {
        console.log('✓ 通過 H.S.B.C. + Hang Seng 識別為恒生銀行');
        return 'hangseng';
    }
    
    // 如果找到相關關鍵字但沒匹配，顯示上下文
    if (lowerText.includes('hang') || lowerText.includes('seng') || lowerText.includes('恒')) {
        const hangIndex = lowerText.indexOf('hang');
        const sengIndex = lowerText.indexOf('seng');
        const hengIndex = lowerText.indexOf('恒');
        const indices = [hangIndex, sengIndex, hengIndex].filter(i => i !== -1);
        if (indices.length > 0) {
            const index = Math.min(...indices);
            const context = lowerText.substring(Math.max(0, index - 50), index + 100);
            console.log('找到相關關鍵字，上下文:', context);
        }
    }
    
    // 匯豐銀行識別特徵
    if (lowerText.includes('hsbc') || 
        lowerText.includes('滙豐') || 
        lowerText.includes('hongkong and shanghai banking')) {
        console.log('✓ 識別為匯豐銀行 (HSBC)');
        return 'hsbc';
    }
    
    // 中銀香港識別特徵
    if (lowerText.includes('bank of china') || 
        lowerText.includes('中銀') || 
        lowerText.includes('boc')) {
        return 'boc';
    }
    
    console.log('✗ 未匹配到任何銀行');
    return null;
}

// 本地識別銀行類型（備用方案）
async function identifyBankLocal(pdf) {
    try {
        // 讀取多頁來識別銀行（最多檢查前3頁）
        let allText = '';
        const maxPages = Math.min(pdf.numPages, 3);
        
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const textItems = textContent.items;
            const pageText = textItems.map(item => item.str).join(' ');
            allText += ' ' + pageText;
        }
        
        // 調試：輸出提取的文本信息
        console.log('=== 銀行識別調試信息 ===');
        console.log('檢查頁數:', maxPages);
        console.log('提取的文本長度:', allText.length);
        console.log('前1000字符:', allText.substring(0, 1000));
        
        // 使用文本分析識別銀行（包含銀行代碼等特徵）
        const result = analyzeBankFromText(allText);
        console.log('識別結果:', result);
        console.log('======================');
        
        return result;
    } catch (error) {
        console.error('本地識別銀行時發生錯誤:', error);
        return null;
    }
}

// 使用模板提取數據行
function extractDataRowsWithTemplate(lines, headerRow, bankType, pageWidth) {
    // 根據銀行類型選擇對應的模板
    switch (bankType) {
        case 'hangseng':
            return extractDataRowsHangSeng(lines, headerRow, pageWidth);
        case 'hsbc':
            return extractDataRowsHSBC(lines, headerRow, pageWidth);
        default:
            // 默認使用恒生銀行模板
            return extractDataRowsHangSeng(lines, headerRow, pageWidth);
    }
}

// 恒生銀行模板：提取數據行（使用恒生銀行專用模板引擎）
function extractDataRowsHangSeng(lines, headerRow, pageWidth) {
    const config = BANK_TEMPLATE_CONFIGS.hangseng;
    return applyHangSengTemplate(lines, headerRow, config, pageWidth);
}

// 匯豐銀行模板：提取數據行
function extractDataRowsHSBC(lines, headerRow, pageWidth) {
    const config = BANK_TEMPLATE_CONFIGS.hsbc;
    // 使用匯豐銀行專用的模板引擎
    const result = applyHSBCTemplate(lines, headerRow, config, pageWidth);
    // 返回完整結果對象（包含 dataRows 和 foundEndMarker）
    return result;
}

// 獲取標題行中各欄位的X座標範圍
// 注意：此函數在 template-engine.js 中也有定義，優先使用 template-engine.js 中的版本
function getHeaderXPositions(headerLine, indices) {
    if (!headerLine || headerLine.length === 0) return null;
    
    // 獲取各欄位的X座標
    const dateX = headerLine[indices.date]?.x || 0;
    const depositX = headerLine[indices.deposit]?.x || 0;
    const withdrawalX = headerLine[indices.withdrawal]?.x || 0;
    const balanceX = headerLine[indices.balance]?.x || 0;
    
    // 計算各欄位的中點（用於判斷金額屬於哪個欄位）
    const dateEndX = indices.date < headerLine.length - 1 ? 
                     (headerLine[indices.date + 1]?.x || dateX) : dateX;
    const depositStartX = depositX;
    const depositEndX = indices.deposit < headerLine.length - 1 ? 
                       (headerLine[indices.deposit + 1]?.x || depositX) : depositX;
    const withdrawalStartX = withdrawalX;
    const withdrawalEndX = indices.withdrawal < headerLine.length - 1 ? 
                          (headerLine[indices.withdrawal + 1]?.x || withdrawalX) : withdrawalX;
    const balanceStartX = balanceX;
    
    return {
        date: { start: dateX, end: dateEndX },
        deposit: { start: depositStartX, end: depositEndX },
        withdrawal: { start: withdrawalStartX, end: withdrawalEndX },
        balance: { start: balanceStartX, end: Infinity }, // Balance 在最右邊
        detailsStart: dateEndX, // Details 從 Date 結束開始
        detailsEnd: depositStartX // Details 到 Deposit 開始結束
    };
}

// 恒生銀行模板：從一行中提取數據（從Details開始，往左找日期，往右找金額）
// 注意：此函數已被配置驅動的模板引擎取代，保留作為備用
// 新版本使用 extractDataRowsHangSeng -> applyHangSengTemplate -> extractRowDataByConfig
function extractRowDataHangSeng(line, headerXPositions) {
    if (line.length === 0) return null;
    
    // 步驟1：在Details欄位範圍內提取所有文字項目（Details欄位在Date和Deposit之間）
    // 注意：Details可以包含數字或其他符號，需要收集該欄位範圍內的所有文字項目
    let detailsText = '';
    let detailsX = null;
    let detailsIndex = -1;
    const detailsItems = [];
    const detailsItemIndices = [];
    
    // 在Details欄位範圍內（Date結束到Deposit開始之間）收集所有非空文字
    // 不排除數字或符號，只要是文字就收集
    for (let i = 0; i < line.length; i++) {
        const item = line[i];
        const itemX = item.x;
        const itemText = item.text.trim();
        
        // 檢查是否在Details欄位範圍內，只要是非空文字就收集
        if (itemX >= headerXPositions.detailsStart && 
            itemX < headerXPositions.detailsEnd && 
            itemText !== '') {
            detailsItems.push(itemText);
            detailsItemIndices.push(i);
            // 記錄第一個Details項目的X座標和索引，用於後續往左/右查找
            if (detailsX === null) {
                detailsX = itemX;
                detailsIndex = i;
            }
        }
    }
    
    // 如果沒在嚴格範圍內找到，放寬條件：在Date和Deposit之間找所有文字
    if (detailsItems.length === 0) {
        for (let i = 0; i < line.length; i++) {
            const item = line[i];
            const itemX = item.x;
            const itemText = item.text.trim();
            
            if (itemX > headerXPositions.date.end && 
                itemX < headerXPositions.deposit.start && 
                itemText !== '') {
                detailsItems.push(itemText);
                detailsItemIndices.push(i);
                if (detailsX === null) {
                    detailsX = itemX;
                    detailsIndex = i;
                }
            }
        }
    }
    
    // 將所有Details項目組合成一個字串
    if (detailsItems.length > 0) {
        detailsText = detailsItems.join(' ');
        // 如果還沒設定detailsIndex，使用第一個項目的索引
        if (detailsIndex === -1 && detailsItemIndices.length > 0) {
            detailsIndex = detailsItemIndices[0];
        }
    }
    
    if (!detailsText) {
        // 如果完全找不到Details，這可能不是有效的數據行
        return null;
    }
    
    // 步驟2：從Details往左找日期
    let date = '';
    for (let i = detailsIndex - 1; i >= 0; i--) {
        const itemText = line[i].text.trim();
        if (isDate(itemText)) {
            date = itemText;
            break;
        }
    }
    
    // 如果沒找到標準日期格式，使用Details左邊第一個包含數字的元素
    if (!date && detailsIndex > 0) {
        for (let i = detailsIndex - 1; i >= 0; i--) {
            const itemText = line[i].text.trim();
            if (/\d/.test(itemText)) {
                date = itemText;
                break;
            }
        }
    }
    
    // 步驟3：從Details往右找金額，根據X座標判斷屬於哪個欄位
    let deposit = '';
    let withdrawal = '';
    let balance = '';
    
    // 從Details右邊開始找所有金額
    const amounts = [];
    for (let i = detailsIndex + 1; i < line.length; i++) {
        const item = line[i];
        const itemText = item.text.trim();
        const itemX = item.x;
        
        if (isAmount(itemText)) {
            amounts.push({
                text: itemText,
                x: itemX,
                index: i
            });
        }
    }
    
    // 根據X座標將金額分配到對應欄位
    for (const amount of amounts) {
        // Deposit欄：在Deposit欄之後，Withdrawal欄之前
        if (amount.x >= headerXPositions.deposit.start && 
            amount.x < headerXPositions.withdrawal.start) {
            if (!deposit) {
                deposit = amount.text;
            }
        }
        // Withdrawal欄：在Withdrawal欄之後，Balance欄之前
        else if (amount.x >= headerXPositions.withdrawal.start && 
                 amount.x < headerXPositions.balance.start) {
            if (!withdrawal) {
                withdrawal = amount.text;
            }
        }
        // Balance欄：在Balance欄之後（最右邊）
        else if (amount.x >= headerXPositions.balance.start) {
            if (!balance) {
                balance = amount.text;
            }
        }
    }
    
    // 如果Balance未找到，則留空（不強行使用最右邊的金額）
    
    // 驗證：至少要有日期或餘額
    const hasDate = date && /\d/.test(date);
    const hasBalance = balance && /\d/.test(balance);
    
    if (hasDate || hasBalance) {
        return {
            date: date,
            details: detailsText,
            deposit: deposit,
            withdrawal: withdrawal,
            balance: balance
        };
    }
    
    return null;
}

// 判斷是否為日期格式
function isDate(text) {
    if (!text || !/\d/.test(text)) return false;
    
    // 常見日期格式
    const datePatterns = [
        /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/, // DD/MM/YYYY, DD-MM-YY 等
        /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/, // YYYY-MM-DD 等
        /\d{1,2}\s+\w{3}\s+\d{2,4}/, // 01 Jan 2024
        /\d{1,2}\s+\w+\s+\d{2,4}/, // 01 January 2024
        /\w{3}\s+\d{1,2},?\s+\d{2,4}/, // Jan 01, 2024
    ];
    
    return datePatterns.some(pattern => pattern.test(text));
}

// 判斷是否為金額格式
function isAmount(text) {
    if (!text) return false;
    
    // 金額通常包含數字、小數點、逗號、貨幣符號等
    // 例如：1234.56, 1,234.56, $1234.56, 1234.56-
    const amountPattern = /^[\$€£¥]?[\d,]+\.?\d*[\-]?$/;
    const hasNumbers = /\d/.test(text);
    const looksLikeAmount = amountPattern.test(text.replace(/\s/g, '')) || 
                           (hasNumbers && (text.includes('.') || text.includes(',') || /^\d+$/.test(text)));
    
    return looksLikeAmount && !isDate(text);
}

// 在單行中重新尋找索引（用於多行標題的情況）
function findIndicesInLine(line, originalIndices, headerLine) {
    // 嘗試通過X座標對齊來找到正確的索引
    // 如果headerLine中的項目有X座標，我們可以通過X座標匹配來找到對應位置
    
    // 簡單方法：直接在當前行中重新尋找關鍵字
    const dateIndex = findKeywordIndex(line, KEYWORDS.date);
    const depositIndex = findKeywordIndex(line, KEYWORDS.deposit);
    const withdrawalIndex = findKeywordIndex(line, KEYWORDS.withdrawal);
    const balanceIndex = findKeywordIndex(line, KEYWORDS.balance);
    
    // 如果找到了，使用新的索引；否則使用原始索引
    return {
        date: dateIndex !== -1 ? dateIndex : originalIndices.date,
        deposit: depositIndex !== -1 ? depositIndex : originalIndices.deposit,
        withdrawal: withdrawalIndex !== -1 ? withdrawalIndex : originalIndices.withdrawal,
        balance: balanceIndex !== -1 ? balanceIndex : originalIndices.balance
    };
}

// 顯示預覽
function displayPreview(data) {
    previewBody.innerHTML = '';
    
    if (data.length === 0) {
        previewBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">沒有找到數據</td></tr>';
        return;
    }
    
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.details}</td>
            <td>${row.deposit}</td>
            <td>${row.withdrawal}</td>
            <td>${row.balance}</td>
        `;
        previewBody.appendChild(tr);
    });
    
    previewContainer.style.display = 'block';
}

// 下載Excel
downloadBtn.addEventListener('click', () => {
    if (extractedData.length === 0) {
        showStatus('沒有數據可下載', 'error');
        return;
    }
    
    // 準備工作表數據
    const wsData = [
        ['Date', 'Details', 'Deposit', 'Withdrawal', 'Balance']
    ];
    
    extractedData.forEach(row => {
        wsData.push([
            row.date,
            row.details,
            row.deposit,
            row.withdrawal,
            row.balance
        ]);
    });
    
    // 創建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // 設置列寬
    ws['!cols'] = [
        { wch: 15 }, // Date
        { wch: 40 }, // Details
        { wch: 15 }, // Deposit
        { wch: 15 }, // Withdrawal
        { wch: 15 }  // Balance
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, '銀行月結單');
    
    // 下載
    const fileName = `銀行月結單_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    showStatus('Excel檔案下載成功！', 'success');
});

// ==================== 框線可視化功能 ====================

// 顯示框線可視化
async function showColumnBoundariesVisualization(pdf, headerRow) {
    currentPDF = pdf;
    currentHeaderRow = headerRow;
    
    const container = document.getElementById('visualizationContainer');
    const viewer = document.getElementById('pdfViewer');
    const showBtn = document.getElementById('showVisualizationBtn');
    const hideBtn = document.getElementById('hideVisualizationBtn');
    const exportBtn = document.getElementById('exportBoundariesBtn');
    
    if (!container || !viewer) {
        console.error('可視化容器元素未找到');
        return;
    }
    
    container.style.display = 'block';
    viewer.innerHTML = '';
    visualizationCanvases = [];
    
    // 初始化可拖動框線位置（基於標題行）
    initializeDraggableBoundaries(headerRow);
    
    // 渲染所有頁面
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: canvasScale });
        
        if (pageNum === 1) {
            currentPageWidth = viewport.width / canvasScale;
        }
        
        // 創建canvas容器
        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.position = 'relative';
        canvasWrapper.style.display = 'inline-block';
        canvasWrapper.style.margin = '0 auto 20px';
        
        // 創建canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.display = 'block';
        canvas.style.border = '1px solid #ccc';
        canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        canvas.style.cursor = 'crosshair';
        
        // 設置canvas ID以便識別
        canvas.id = `pdfCanvas_${pageNum}`;
        
        // 渲染PDF頁面
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        
        // 繪製可拖動框線（只在第一頁）
        if (pageNum === 1) {
            // 緩存PDF圖像數據（用於快速重繪框線）
            pdfImageData = context.getImageData(0, 0, canvas.width, canvas.height);
            
            drawDraggableBoundaries(context, canvas.width, canvas.height);
            setupCanvasDragEvents(canvas);
        }
        
        canvasWrapper.appendChild(canvas);
        viewer.appendChild(canvasWrapper);
        visualizationCanvases.push({ canvas, pageNum, viewport });
        
        // 添加頁碼標籤
        const pageLabel = document.createElement('div');
        pageLabel.textContent = `第 ${pageNum} 頁${pageNum === 1 ? '（可拖動框線調整位置）' : ''}`;
        pageLabel.style.textAlign = 'center';
        pageLabel.style.marginBottom = '10px';
        pageLabel.style.fontWeight = 'bold';
        pageLabel.style.color = '#667eea';
        viewer.appendChild(pageLabel);
    }
    
    // 隱藏預覽區域的按鈕，顯示可視化容器內的隱藏按鈕
    const showBtnInPreview = document.getElementById('showVisualizationBtn');
    if (showBtnInPreview) showBtnInPreview.style.display = 'none';
    
    if (hideBtn) hideBtn.style.display = 'inline-block';
    
    // 確保導出按鈕在預覽區域可見
    const exportBtnInPreview = document.getElementById('exportBoundariesBtn');
    if (exportBtnInPreview) exportBtnInPreview.style.display = 'inline-block';
    
    // 分析並顯示框線配置
    updateBoundariesDisplay();
}

// 初始化可拖動框線位置
function initializeDraggableBoundaries(headerRow) {
    if (!headerRow || !headerRow.line) return;
    
    const { line: headerLine, indices } = headerRow;
    
    const dateX = headerLine[indices.date]?.x || 0;
    const depositX = headerLine[indices.deposit]?.x || 0;
    const withdrawalX = headerLine[indices.withdrawal]?.x || 0;
    const balanceX = headerLine[indices.balance]?.x || 0;
    
    const dateEndX = indices.date < headerLine.length - 1 ? 
                     (headerLine[indices.date + 1]?.x || dateX) : dateX;
    const depositEndX = indices.deposit < headerLine.length - 1 ? 
                       (headerLine[indices.deposit + 1]?.x || depositX) : depositX;
    const withdrawalEndX = indices.withdrawal < headerLine.length - 1 ? 
                          (headerLine[indices.withdrawal + 1]?.x || withdrawalX) : withdrawalX;
    
    // 存儲所有可拖動的邊界線（原始像素座標）
    draggableBoundaries = {
        dateEnd: dateEndX,
        detailsStart: dateEndX,
        detailsEnd: depositX,
        depositStart: depositX,
        depositEnd: depositEndX,
        withdrawalStart: withdrawalX,
        withdrawalEnd: withdrawalEndX,
        balanceStart: balanceX
    };
}

// 繪製可拖動框線
function drawDraggableBoundaries(ctx, canvasWidth, canvasHeight) {
    if (!draggableBoundaries || !currentPageWidth) return;
    
    const scaleFactor = canvasWidth / (currentPageWidth * canvasScale);
    
    // 定義各欄位的顏色
    const boundaryColors = {
        dateEnd: { line: 'rgba(255, 0, 0, 0.9)', label: 'Date結束', width: 5 },
        detailsEnd: { line: 'rgba(0, 255, 0, 0.9)', label: 'Details結束', width: 5 },
        depositStart: { line: 'rgba(0, 0, 255, 0.9)', label: 'Deposit開始', width: 5 },
        depositEnd: { line: 'rgba(0, 0, 255, 0.7)', label: 'Deposit結束', width: 3 },
        withdrawalStart: { line: 'rgba(255, 165, 0, 0.9)', label: 'Withdrawal開始', width: 5 },
        withdrawalEnd: { line: 'rgba(255, 165, 0, 0.7)', label: 'Withdrawal結束', width: 3 },
        balanceStart: { line: 'rgba(255, 0, 255, 0.9)', label: 'Balance開始', width: 5 }
    };
    
    // 繪製所有可拖動的邊界線
    Object.keys(draggableBoundaries).forEach(key => {
        const originalX = draggableBoundaries[key];
        const canvasX = originalX * scaleFactor;
        const color = boundaryColors[key] || { line: 'rgba(128, 128, 128, 0.9)', label: key, width: 3 };
        
        // 計算實際顯示位置（不限制在canvas寬度內，允許超出）
        // 但如果超出canvas太多，限制在canvas右邊緣
        const maxCanvasX = canvasWidth - 5;
        const visibleX = Math.min(canvasX, maxCanvasX);
        const isBeyondCanvas = canvasX > maxCanvasX;
        
        // 繪製可拖動標記線（更粗、更明顯）
        ctx.strokeStyle = color.line;
        ctx.lineWidth = color.width;
        ctx.beginPath();
        ctx.moveTo(visibleX, 0);
        ctx.lineTo(visibleX, canvasHeight);
        ctx.stroke();
        
        // 繪製拖動手柄（頂部和底部的小矩形）
        const handleSize = 15;
        ctx.fillStyle = color.line;
        ctx.fillRect(visibleX - handleSize/2, 0, handleSize, handleSize);
        ctx.fillRect(visibleX - handleSize/2, canvasHeight - handleSize, handleSize, handleSize);
        
        // 繪製標籤
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.font = 'bold 12px Arial';
        const labelText = isBeyondCanvas 
            ? `${color.label} (${Math.round(originalX)}, 超出顯示)` 
            : `${color.label} (${Math.round(originalX)})`;
        ctx.fillText(
            labelText,
            visibleX + 5,
            20
        );
    });
    
    // 繪製說明
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('💡 拖動彩色線條調整框線位置', 10, canvasHeight - 10);
}

// 設置canvas拖動事件
function setupCanvasDragEvents(canvas) {
    let isDragging = false;
    let currentBoundary = null;
    
    canvas.addEventListener('mousedown', (e) => {
        if (!draggableBoundaries || !currentPageWidth) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const scaleFactor = canvas.width / (currentPageWidth * canvasScale);
        const threshold = 10; // 點擊容差（像素）
        
        // 檢查是否點擊在框線上
        for (const [key, originalX] of Object.entries(draggableBoundaries)) {
            const canvasX = originalX * scaleFactor;
            const maxCanvasX = canvas.width - 5;
            const visibleX = Math.min(canvasX, maxCanvasX);
            
            // 計算點擊位置對應的原始座標
            const clickOriginalX = x / scaleFactor;
            
            // 檢查點擊位置是否在框線附近（使用原始座標比較，更精確）
            if (Math.abs(clickOriginalX - originalX) < (threshold / scaleFactor)) {
                isDragging = true;
                currentBoundary = key;
                dragOffset = x - visibleX; // 使用可見位置計算偏移
                canvas.style.cursor = 'grabbing';
                break;
            }
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!draggableBoundaries || !currentPageWidth) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const scaleFactor = canvas.width / (currentPageWidth * canvasScale);
        
        if (isDragging && currentBoundary) {
            // 計算新的原始座標
            // 使用鼠標位置減去拖動偏移量，然後轉換為原始座標
            const newCanvasX = x - dragOffset;
            const newOriginalX = newCanvasX / scaleFactor;
            
            // 對於 withdrawalEnd 和 balanceStart，允許拖到頁面寬度之外（更右邊）
            // 其他框線限制在頁面寬度內
            let shouldUpdate = false;
            let finalX = newOriginalX;
            
            if (currentBoundary === 'withdrawalEnd' || currentBoundary === 'balanceStart') {
                // 允許拖到頁面寬度之外，限制在canvas寬度對應的原始座標範圍內
                // 這樣可以精確定位到595和canvas最右邊之間的任何位置
                const maxX = canvas.width / scaleFactor; // canvas寬度對應的原始座標
                if (newOriginalX >= 0 && newOriginalX <= maxX) {
                    finalX = newOriginalX;
                    shouldUpdate = true;
                }
            } else {
                // 其他框線限制在頁面寬度內
                if (newOriginalX >= 0 && newOriginalX <= currentPageWidth) {
                    finalX = newOriginalX;
                    shouldUpdate = true;
                }
            }
            
            if (shouldUpdate) {
                draggableBoundaries[currentBoundary] = finalX;
                
                // 使用防抖重新繪製（只重新繪製框線，不重新渲染PDF）
                redrawBoundariesOnly(canvas);
                
                // 更新配置顯示（也使用防抖）
                if (redrawTimeout) clearTimeout(redrawTimeout);
                redrawTimeout = setTimeout(() => {
                    updateBoundariesDisplay();
                }, 100);
            }
        } else {
            // 檢查鼠標是否在框線附近
            let nearBoundary = false;
            for (const [key, originalX] of Object.entries(draggableBoundaries)) {
                const canvasX = originalX * scaleFactor;
                const maxCanvasX = canvas.width - 5;
                const visibleX = Math.min(canvasX, maxCanvasX);
                
                // 計算鼠標位置對應的原始座標
                const mouseOriginalX = x / scaleFactor;
                
                // 使用原始座標比較，更精確
                if (Math.abs(mouseOriginalX - originalX) < (10 / scaleFactor)) {
                    nearBoundary = true;
                    break;
                }
            }
            canvas.style.cursor = nearBoundary ? 'grab' : 'crosshair';
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            currentBoundary = null;
            canvas.style.cursor = 'crosshair';
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            currentBoundary = null;
            canvas.style.cursor = 'crosshair';
        }
    });
}

// 只重新繪製框線（不重新渲染PDF）- 用於拖動時快速更新
function redrawBoundariesOnly(canvas) {
    const ctx = canvas.getContext('2d');
    
    // 如果有緩存的PDF圖像，先恢復它
    if (pdfImageData) {
        ctx.putImageData(pdfImageData, 0, 0);
    } else {
        // 如果沒有緩存，重新渲染（只會發生一次）
        redrawCanvas(canvas);
        return;
    }
    
    // 重新繪製框線
    drawDraggableBoundaries(ctx, canvas.width, canvas.height);
}

// 重新繪製canvas（完整渲染，包括PDF）
function redrawCanvas(canvas) {
    // 取消之前的渲染任務
    if (pdfRenderTask) {
        pdfRenderTask.cancel();
        pdfRenderTask = null;
    }
    
    // 找到對應的PDF頁面並重新渲染
    const canvasId = canvas.id;
    const pageNum = parseInt(canvasId.split('_')[1]);
    
    if (pageNum === 1 && currentPDF) {
        currentPDF.getPage(pageNum).then(page => {
            const viewport = page.getViewport({ scale: canvasScale });
            const ctx = canvas.getContext('2d');
            
            // 清除canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 重新渲染PDF
            const renderTask = page.render({
                canvasContext: ctx,
                viewport: viewport
            });
            pdfRenderTask = renderTask;
            
            renderTask.promise.then(() => {
                // 緩存PDF圖像數據（用於快速重繪框線）
                pdfImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                
                // 重新繪製框線
                drawDraggableBoundaries(ctx, canvas.width, canvas.height);
                
                pdfRenderTask = null;
            }).catch((error) => {
                // 如果被取消，忽略錯誤
                if (error.name !== 'RenderingCancelledException') {
                    console.error('PDF渲染錯誤:', error);
                }
                pdfRenderTask = null;
            });
        });
    }
}

// 更新框線配置顯示
function updateBoundariesDisplay() {
    if (!draggableBoundaries || !currentPageWidth) return;
    
    // 構建配置對象
    const absolute = {
        date: {
            start: 0,
            end: Math.round(draggableBoundaries.dateEnd)
        },
        details: {
            start: Math.round(draggableBoundaries.detailsStart),
            end: Math.round(draggableBoundaries.detailsEnd)
        },
        deposit: {
            start: Math.round(draggableBoundaries.depositStart),
            end: Math.round(draggableBoundaries.depositEnd)
        },
        withdrawal: {
            start: Math.round(draggableBoundaries.withdrawalStart),
            end: Math.round(draggableBoundaries.withdrawalEnd)
        },
        balance: {
            start: Math.round(draggableBoundaries.balanceStart),
            end: Infinity
        }
    };
    
    const relative = {
        date: {
            start: Math.round((0 / currentPageWidth) * 10000) / 10000,
            end: Math.round((draggableBoundaries.dateEnd / currentPageWidth) * 10000) / 10000
        },
        details: {
            start: Math.round((draggableBoundaries.detailsStart / currentPageWidth) * 10000) / 10000,
            end: Math.round((draggableBoundaries.detailsEnd / currentPageWidth) * 10000) / 10000
        },
        deposit: {
            start: Math.round((draggableBoundaries.depositStart / currentPageWidth) * 10000) / 10000,
            end: Math.round((draggableBoundaries.depositEnd / currentPageWidth) * 10000) / 10000
        },
        withdrawal: {
            start: Math.round((draggableBoundaries.withdrawalStart / currentPageWidth) * 10000) / 10000,
            end: Math.round((draggableBoundaries.withdrawalEnd / currentPageWidth) * 10000) / 10000
        },
        balance: {
            start: Math.round((draggableBoundaries.balanceStart / currentPageWidth) * 10000) / 10000,
            end: 1.0
        }
    };
    
    const boundaries = { absolute, relative, pageWidth: currentPageWidth };
    displayBoundariesInfo(boundaries);
}

// 分析框線距離
function analyzeColumnBoundaries(headerRow, pageWidth) {
    if (!headerRow || !headerRow.line) return null;
    
    const { line: headerLine, indices } = headerRow;
    
    const dateX = headerLine[indices.date]?.x || 0;
    const depositX = headerLine[indices.deposit]?.x || 0;
    const withdrawalX = headerLine[indices.withdrawal]?.x || 0;
    const balanceX = headerLine[indices.balance]?.x || 0;
    
    const dateEndX = indices.date < headerLine.length - 1 ? 
                     (headerLine[indices.date + 1]?.x || dateX) : dateX;
    const depositEndX = indices.deposit < headerLine.length - 1 ? 
                       (headerLine[indices.deposit + 1]?.x || depositX) : depositX;
    const withdrawalEndX = indices.withdrawal < headerLine.length - 1 ? 
                          (headerLine[indices.withdrawal + 1]?.x || withdrawalX) : withdrawalX;
    
    const detailsStartX = dateEndX;
    const detailsEndX = depositX;
    
    const absolute = {
        date: { start: Math.round(dateX), end: Math.round(dateEndX) },
        details: { start: Math.round(detailsStartX), end: Math.round(detailsEndX) },
        deposit: { start: Math.round(depositX), end: Math.round(depositEndX) },
        withdrawal: { start: Math.round(withdrawalX), end: Math.round(withdrawalEndX) },
        balance: { start: Math.round(balanceX), end: Infinity }
    };
    
    let relative = null;
    if (pageWidth && pageWidth > 0) {
        relative = {
            date: {
                start: Math.round((dateX / pageWidth) * 10000) / 10000,
                end: Math.round((dateEndX / pageWidth) * 10000) / 10000
            },
            details: {
                start: Math.round((detailsStartX / pageWidth) * 10000) / 10000,
                end: Math.round((detailsEndX / pageWidth) * 10000) / 10000
            },
            deposit: {
                start: Math.round((depositX / pageWidth) * 10000) / 10000,
                end: Math.round((depositEndX / pageWidth) * 10000) / 10000
            },
            withdrawal: {
                start: Math.round((withdrawalX / pageWidth) * 10000) / 10000,
                end: Math.round((withdrawalEndX / pageWidth) * 10000) / 10000
            },
            balance: {
                start: Math.round((balanceX / pageWidth) * 10000) / 10000,
                end: 1.0
            }
        };
    }
    
    return { absolute, relative, pageWidth };
}

// 顯示框線配置信息
function displayBoundariesInfo(boundaries) {
    const infoDiv = document.getElementById('boundariesInfo');
    const textDiv = document.getElementById('boundariesText');
    
    if (!boundaries || !infoDiv || !textDiv) return;
    
    let text = '📍 絕對像素值（從左邊緣開始）：\n';
    text += JSON.stringify(boundaries.absolute, null, 4);
    
    if (boundaries.relative) {
        text += '\n\n📊 相對百分比（基於頁面寬度）：\n';
        text += JSON.stringify(boundaries.relative, null, 4);
        text += `\n\n📄 頁面寬度：${boundaries.pageWidth.toFixed(2)} 像素`;
    }
    
    text += '\n\n📋 複製以下配置到 hsbc-config.js：\n\n';
    text += 'columnBoundaries: {\n';
    text += '    absolute: ' + JSON.stringify(boundaries.absolute, null, 8);
    if (boundaries.relative) {
        text += ',\n';
        text += '    relative: ' + JSON.stringify(boundaries.relative, null, 8);
    }
    text += '\n}';
    
    textDiv.textContent = text;
    infoDiv.style.display = 'block';
}

// 導出框線配置到控制台
function exportBoundariesToConsole() {
    // 優先使用可拖動框線的配置，如果沒有則使用標題行分析
    let boundaries;
    
    if (draggableBoundaries && currentPageWidth) {
        // 使用可拖動框線的配置
        const absolute = {
            date: {
                start: 0,
                end: Math.round(draggableBoundaries.dateEnd)
            },
            details: {
                start: Math.round(draggableBoundaries.detailsStart),
                end: Math.round(draggableBoundaries.detailsEnd)
            },
            deposit: {
                start: Math.round(draggableBoundaries.depositStart),
                end: Math.round(draggableBoundaries.depositEnd)
            },
            withdrawal: {
                start: Math.round(draggableBoundaries.withdrawalStart),
                end: Math.round(draggableBoundaries.withdrawalEnd)
            },
            balance: {
                start: Math.round(draggableBoundaries.balanceStart),
                end: Infinity
            }
        };
        
        const relative = {
            date: {
                start: Math.round((0 / currentPageWidth) * 10000) / 10000,
                end: Math.round((draggableBoundaries.dateEnd / currentPageWidth) * 10000) / 10000
            },
            details: {
                start: Math.round((draggableBoundaries.detailsStart / currentPageWidth) * 10000) / 10000,
                end: Math.round((draggableBoundaries.detailsEnd / currentPageWidth) * 10000) / 10000
            },
            deposit: {
                start: Math.round((draggableBoundaries.depositStart / currentPageWidth) * 10000) / 10000,
                end: Math.round((draggableBoundaries.depositEnd / currentPageWidth) * 10000) / 10000
            },
            withdrawal: {
                start: Math.round((draggableBoundaries.withdrawalStart / currentPageWidth) * 10000) / 10000,
                end: Math.round((draggableBoundaries.withdrawalEnd / currentPageWidth) * 10000) / 10000
            },
            balance: {
                start: Math.round((draggableBoundaries.balanceStart / currentPageWidth) * 10000) / 10000,
                end: 1.0
            }
        };
        
        boundaries = { absolute, relative, pageWidth: currentPageWidth };
    } else if (currentHeaderRow && currentPageWidth) {
        // 回退到標題行分析
        boundaries = analyzeColumnBoundaries(currentHeaderRow, currentPageWidth);
    } else {
        alert('請先上傳PDF並找到標題行');
        return;
    }
    
    if (!boundaries) {
        alert('無法分析框線距離');
        return;
    }
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📏 框線距離配置');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('📍 絕對像素值：');
    console.log(JSON.stringify(boundaries.absolute, null, 4));
    if (boundaries.relative) {
        console.log('\n📊 相對百分比：');
        console.log(JSON.stringify(boundaries.relative, null, 4));
    }
    console.log('\n📋 配置代碼：');
    console.log('columnBoundaries: {');
    console.log('    absolute: ' + JSON.stringify(boundaries.absolute, null, 8));
    if (boundaries.relative) {
        console.log(',');
        console.log('    relative: ' + JSON.stringify(boundaries.relative, null, 8));
    }
    console.log('}');
    console.log('\n═══════════════════════════════════════════════════════\n');
    
    // 複製到剪貼板
    const configText = 'columnBoundaries: {\n    absolute: ' + 
                      JSON.stringify(boundaries.absolute, null, 8) +
                      (boundaries.relative ? ',\n    relative: ' + JSON.stringify(boundaries.relative, null, 8) : '') +
                      '\n}';
    
    navigator.clipboard.writeText(configText).then(() => {
        alert('✅ 框線配置已複製到剪貼板！\n\n請打開瀏覽器控制台（F12）查看完整信息。');
    }).catch(() => {
        alert('⚠️ 無法自動複製，請手動從頁面複製配置。');
    });
}

// 綁定按鈕事件
document.addEventListener('DOMContentLoaded', () => {
    const showBtn = document.getElementById('showVisualizationBtn');
    const hideBtn = document.getElementById('hideVisualizationBtn');
    const exportBtn = document.getElementById('exportBoundariesBtn');
    
    if (showBtn) {
        showBtn.addEventListener('click', async () => {
            if (currentPDF && currentHeaderRow) {
                await showColumnBoundariesVisualization(currentPDF, currentHeaderRow);
            } else {
                alert('請先上傳PDF並成功提取數據');
            }
        });
    }
    
    if (hideBtn) {
        hideBtn.addEventListener('click', () => {
            const container = document.getElementById('visualizationContainer');
            if (container) {
                container.style.display = 'none';
            }
            // 顯示預覽區域的按鈕
            const showBtnInPreview = document.getElementById('showVisualizationBtn');
            if (showBtnInPreview) showBtnInPreview.style.display = 'inline-block';
            if (hideBtn) hideBtn.style.display = 'none';
        });
    }
    
    if (exportBtn) {
        exportBtn.addEventListener('click', exportBoundariesToConsole);
    }
});

// ==================== Document AI 表格可視化功能 ====================

// 根據 Document AI Form Parser 回傳結果可視化表格
// documentAIResult: Document AI API 回傳的 JSON 對象
// pdf: PDF.js 的 PDF 對象
async function visualizeDocumentAITables(pdf, documentAIResult) {
    if (!documentAIResult) {
        console.error('❌ Document AI 結果為空');
        showStatus('⚠️ 無法可視化：Document AI 結果為空', 'error');
        return;
    }
    
    if (!documentAIResult.document) {
        console.error('❌ Document AI 結果中缺少 document 屬性');
        console.error('響應結構:', Object.keys(documentAIResult));
        showStatus('⚠️ 無法可視化：Document AI 響應格式不正確', 'error');
        return;
    }
    
    if (!documentAIResult.document.pages || documentAIResult.document.pages.length === 0) {
        console.error('❌ Document AI 結果中沒有頁面數據');
        showStatus('⚠️ 無法可視化：Document AI 未檢測到頁面', 'error');
        return;
    }
    
    const container = document.getElementById('visualizationContainer');
    const viewer = document.getElementById('pdfViewer');
    
    if (!container || !viewer) {
        console.error('可視化容器元素未找到');
        return;
    }
    
    container.style.display = 'block';
    viewer.innerHTML = '';
    visualizationCanvases = [];
    
    // 解析 Document AI 結果，提取表格信息
    const tablesByPage = parseDocumentAITables(documentAIResult);
    
    // 檢查是否有表格
    const totalTables = Object.values(tablesByPage).reduce((sum, tables) => sum + tables.length, 0);
    if (totalTables === 0) {
        console.warn('⚠️ Document AI 未檢測到任何表格');
        showStatus('⚠️ Document AI 未檢測到表格（PDF 中可能沒有表格）', 'info');
        // 仍然顯示 PDF 預覽，但不繪製表格框線
    } else {
        console.log(`✅ 將可視化 ${totalTables} 個表格`);
    }
    
    // 渲染所有頁面並繪製表格
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: canvasScale });
        
        // 創建canvas容器
        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.position = 'relative';
        canvasWrapper.style.display = 'inline-block';
        canvasWrapper.style.margin = '0 auto 20px';
        
        // 創建canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.display = 'block';
        canvas.style.border = '2px solid #667eea';
        canvas.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        canvas.id = `pdfCanvas_${pageNum}`;
        
        // 渲染PDF頁面
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        
        // 繪製當前頁面的表格
        const pageTables = tablesByPage[pageNum] || [];
        if (pageTables.length > 0) {
            drawDocumentAITablesOnCanvas(context, pageTables, viewport, canvas);
        }
        
        canvasWrapper.appendChild(canvas);
        viewer.appendChild(canvasWrapper);
        visualizationCanvases.push({ canvas, pageNum, viewport });
        
        // 添加頁碼標籤
        const pageLabel = document.createElement('div');
        pageLabel.textContent = `第 ${pageNum} 頁 - 檢測到 ${pageTables.length} 個表格`;
        pageLabel.style.textAlign = 'center';
        pageLabel.style.marginBottom = '10px';
        pageLabel.style.fontWeight = 'bold';
        pageLabel.style.color = '#667eea';
        pageLabel.style.fontSize = '1.1em';
        viewer.appendChild(pageLabel);
    }
    
    // 顯示隱藏按鈕
    const hideBtn = document.getElementById('hideVisualizationBtn');
    if (hideBtn) hideBtn.style.display = 'inline-block';
    
    console.log('✅ Document AI 表格可視化完成');
}

// 解析 Document AI 結果，提取表格信息
function parseDocumentAITables(documentAIResult) {
    const tablesByPage = {};
    
    if (!documentAIResult || !documentAIResult.document) {
        console.error('parseDocumentAITables: documentAIResult 無效');
        return tablesByPage;
    }
    
    console.log('📋 開始解析 Document AI 表格數據...');
    
    documentAIResult.document?.pages?.forEach((page, pageIndex) => {
        const pageNumber = pageIndex + 1;
        const tables = [];
        
        if (!page.tables || page.tables.length === 0) {
            console.log(`  第 ${pageNumber} 頁: 無表格`);
            return;
        }
        
        console.log(`  第 ${pageNumber} 頁: 找到 ${page.tables.length} 個表格`);
        
        page.tables?.forEach((table, tableIndex) => {
            // 提取整個表格的邊界框
            const tableBounds = extractBounds(table.layout?.boundingPoly, page.dimension);
            
            // 提取標題行
            const headerRows = table.headerRows?.map((row, rowIndex) => {
                return {
                    rowIndex,
                    cells: row.cells?.map((cell, cellIndex) => {
                        return {
                            cellIndex,
                            text: getCellText(cell),
                            bounds: extractBounds(cell.layout?.boundingPoly, page.dimension),
                            rowSpan: cell.rowSpan || 1,
                            colSpan: cell.colSpan || 1
                        };
                    }) || []
                };
            }) || [];
            
            // 提取數據行
            const bodyRows = table.bodyRows?.map((row, rowIndex) => {
                return {
                    rowIndex,
                    cells: row.cells?.map((cell, cellIndex) => {
                        return {
                            cellIndex,
                            text: getCellText(cell),
                            bounds: extractBounds(cell.layout?.boundingPoly, page.dimension),
                            rowSpan: cell.rowSpan || 1,
                            colSpan: cell.colSpan || 1
                        };
                    }) || []
                };
            }) || [];
            
            // 統計單元格數量
            const headerCellCount = headerRows.reduce((sum, row) => sum + (row.cells?.length || 0), 0);
            const bodyCellCount = bodyRows.reduce((sum, row) => sum + (row.cells?.length || 0), 0);
            
            console.log(`    表格 ${tableIndex + 1}: ${headerRows.length} 行標題 (${headerCellCount} 單元格), ${bodyRows.length} 行數據 (${bodyCellCount} 單元格)`);
            
            tables.push({
                tableIndex,
                tableBounds,
                headerRows,
                bodyRows,
                pageDimension: page.dimension
            });
        });
        
        if (tables.length > 0) {
            tablesByPage[pageNumber] = tables;
        }
    });
    
    const totalTables = Object.values(tablesByPage).reduce((sum, tables) => sum + tables.length, 0);
    console.log(`✅ 解析完成: 共 ${totalTables} 個表格，分布在 ${Object.keys(tablesByPage).length} 頁`);
    
    return tablesByPage;
}

// 從 boundingPoly 提取邊界框座標
function extractBounds(boundingPoly, pageDimension) {
    if (!boundingPoly) return null;
    
    // 優先使用 normalizedVertices（歸一化座標 0-1）
    const vertices = boundingPoly.normalizedVertices || boundingPoly.vertices || [];
    if (vertices.length < 2) return null;
    
    // 如果使用歸一化座標，轉換為像素座標
    if (boundingPoly.normalizedVertices && pageDimension) {
        const pageWidth = pageDimension.width || 612; // 默認 A4 寬度
        const pageHeight = pageDimension.height || 792; // 默認 A4 高度
        
        return {
            x1: vertices[0].x * pageWidth,
            y1: vertices[0].y * pageHeight,
            x2: vertices[2]?.x ? vertices[2].x * pageWidth : vertices[1].x * pageWidth,
            y2: vertices[2]?.y ? vertices[2].y * pageHeight : vertices[1].y * pageHeight
        };
    } else {
        // 使用像素座標
        return {
            x1: vertices[0].x || 0,
            y1: vertices[0].y || 0,
            x2: vertices[2]?.x || vertices[1]?.x || 0,
            y2: vertices[2]?.y || vertices[1]?.y || 0
        };
    }
}

// 獲取單元格的文本內容
function getCellText(cell) {
    // 方法1: 嘗試從 layout.textAnchor.textSegments 獲取文本
    const textSegments = cell.layout?.textAnchor?.textSegments;
    if (textSegments && textSegments.length > 0) {
        const text = textSegments.map(seg => seg.text || '').filter(t => t.trim()).join(' ').trim();
        if (text) return text;
    }
    
    // 方法2: 嘗試從 textLayout.textAnchor 獲取（某些 Document AI 版本）
    const textLayoutSegments = cell.textLayout?.textAnchor?.textSegments;
    if (textLayoutSegments && textLayoutSegments.length > 0) {
        const text = textLayoutSegments.map(seg => seg.text || '').filter(t => t.trim()).join(' ').trim();
        if (text) return text;
    }
    
    // 方法3: 直接從 cell 對象查找 text 屬性
    if (cell.text) {
        return String(cell.text).trim();
    }
    
    // 方法4: 嘗試從其他可能的屬性獲取
    if (cell.value) {
        return String(cell.value).trim();
    }
    
    return '';
}

// 在 Canvas 上繪製 Document AI 表格
function drawDocumentAITablesOnCanvas(context, tables, viewport, canvas) {
    // 表格顏色配置
    const colors = {
        tableBorder: 'rgba(102, 126, 234, 0.8)',      // 表格邊界框（藍紫色）
        headerCell: 'rgba(255, 193, 7, 0.3)',         // 標題行單元格（黃色半透明）
        bodyCell: 'rgba(76, 175, 80, 0.2)',           // 數據行單元格（綠色半透明）
        cellBorder: 'rgba(0, 0, 0, 0.3)',             // 單元格邊界（灰色）
        text: '#333333'                                // 文本顏色
    };
    
    tables.forEach((table, tableIndex) => {
        // 繪製整個表格的邊界框
        if (table.tableBounds) {
            const { x1, y1, x2, y2 } = table.tableBounds;
            const width = x2 - x1;
            const height = y2 - y1;
            
            // 轉換座標到 Canvas 尺寸（考慮 scale）
            const canvasX1 = (x1 / viewport.width) * canvas.width;
            const canvasY1 = (y1 / viewport.height) * canvas.height;
            const canvasWidth = (width / viewport.width) * canvas.width;
            const canvasHeight = (height / viewport.height) * canvas.height;
            
            // 繪製表格外邊框
            context.strokeStyle = colors.tableBorder;
            context.lineWidth = 3;
            context.strokeRect(canvasX1, canvasY1, canvasWidth, canvasHeight);
            
            // 添加表格標籤
            context.fillStyle = colors.tableBorder;
            context.font = 'bold 14px Arial';
            context.fillText(`表格 ${tableIndex + 1}`, canvasX1 + 5, canvasY1 - 5);
        }
        
        // 繪製標題行
        table.headerRows?.forEach(row => {
            row.cells?.forEach(cell => {
                if (cell.bounds) {
                    drawCell(context, cell.bounds, colors.headerCell, colors.cellBorder, colors.text, cell.text, viewport, canvas);
                }
            });
        });
        
        // 繪製數據行
        table.bodyRows?.forEach(row => {
            row.cells?.forEach(cell => {
                if (cell.bounds) {
                    drawCell(context, cell.bounds, colors.bodyCell, colors.cellBorder, colors.text, cell.text, viewport, canvas);
                }
            });
        });
    });
}

// 繪製單個單元格
function drawCell(context, bounds, fillColor, borderColor, textColor, text, viewport, canvas) {
    if (!bounds) return;
    
    const { x1, y1, x2, y2 } = bounds;
    const width = x2 - x1;
    const height = y2 - y1;
    
    // 轉換座標到 Canvas 尺寸
    const canvasX1 = (x1 / viewport.width) * canvas.width;
    const canvasY1 = (y1 / viewport.height) * canvas.height;
    const canvasWidth = (width / viewport.width) * canvas.width;
    const canvasHeight = (height / viewport.height) * canvas.height;
    
    // 繪製單元格填充
    context.fillStyle = fillColor;
    context.fillRect(canvasX1, canvasY1, canvasWidth, canvasHeight);
    
    // 繪製單元格邊界
    context.strokeStyle = borderColor;
    context.lineWidth = 1;
    context.strokeRect(canvasX1, canvasY1, canvasWidth, canvasHeight);
    
    // 繪製單元格文本（如果空間足夠）
    if (text && text.trim() && canvasHeight > 12) {
        const trimmedText = text.trim();
        context.fillStyle = textColor;
        // 根據單元格高度動態調整字體大小
        const fontSize = Math.max(8, Math.min(12, Math.floor(canvasHeight * 0.4)));
        context.font = `${fontSize}px Arial`;
        context.textBaseline = 'top';
        
        // 限制文本寬度
        const maxWidth = canvasWidth - 6;
        const textMetrics = context.measureText(trimmedText);
        
        let displayText = trimmedText;
        if (textMetrics.width > maxWidth) {
            // 智能截斷：嘗試找到合適的截斷點
            let truncated = '';
            for (let i = 0; i < trimmedText.length; i++) {
                const testText = trimmedText.substring(0, i + 1) + '...';
                if (context.measureText(testText).width > maxWidth) {
                    break;
                }
                truncated = testText;
            }
            displayText = truncated || trimmedText.substring(0, 10) + '...';
        }
        
        // 垂直居中（如果空間足夠）
        const textY = canvasHeight > fontSize * 1.5 
            ? canvasY1 + (canvasHeight - fontSize) / 2
            : canvasY1 + 2;
        
        context.fillText(displayText, canvasX1 + 3, textY);
    }
}

// 導出函數供外部使用
window.visualizeDocumentAITables = visualizeDocumentAITables;