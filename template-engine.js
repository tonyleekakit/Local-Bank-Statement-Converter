// 恒生銀行模板引擎
// 根據配置執行恒生銀行數據提取邏輯
// 注意：匯豐銀行使用獨立的 hsbc-template-engine.js

// 複製文件創建 hsbc-template-engine.js 時，會修改以下部分：
// 1. 文件頭註釋改為匯豐銀行
// 2. 函數名稱 applyHangSengTemplate -> applyHSBCTemplate
// 3. 返回值改為 { dataRows, foundEndMarker }
// 4. 添加 C/F BALANCE 停止邏輯

// 獲取標題行中各欄位的X座標範圍
function getHeaderXPositions(headerLine, indices, config, pageWidth) {
    // 優先使用配置的框線距離
    if (config && config.columnBoundaries) {
        const columnBoundaries = config.columnBoundaries;
        
        // 檢查是否應該使用配置的框線（而不是從標題行計算）
        const useConfig = columnBoundaries.useHeaderRow === false || 
                         (columnBoundaries.absolute && Object.keys(columnBoundaries.absolute).length > 0);
        
        if (useConfig) {
            let boundaries = null;
            
            // 優先使用絕對像素值
            if (columnBoundaries.absolute) {
                boundaries = {
                    date: { 
                        start: columnBoundaries.absolute.date.start || 0, 
                        end: columnBoundaries.absolute.date.end === Infinity || columnBoundaries.absolute.date.end === null ? Infinity : (columnBoundaries.absolute.date.end || 0)
                    },
                    deposit: { 
                        start: columnBoundaries.absolute.deposit.start || 0, 
                        end: columnBoundaries.absolute.deposit.end === Infinity || columnBoundaries.absolute.deposit.end === null ? Infinity : (columnBoundaries.absolute.deposit.end || 0)
                    },
                    withdrawal: { 
                        start: columnBoundaries.absolute.withdrawal.start || 0, 
                        end: columnBoundaries.absolute.withdrawal.end === Infinity || columnBoundaries.absolute.withdrawal.end === null ? Infinity : (columnBoundaries.absolute.withdrawal.end || 0)
                    },
                    balance: { 
                        start: columnBoundaries.absolute.balance.start || 0, 
                        end: columnBoundaries.absolute.balance.end === Infinity || columnBoundaries.absolute.balance.end === null ? Infinity : (columnBoundaries.absolute.balance.end || 0)
                    },
                    detailsStart: columnBoundaries.absolute.details.start || 0,
                    detailsEnd: columnBoundaries.absolute.details.end || 0
                };
            }
            // 如果沒有絕對值但有相對百分比和頁面寬度，使用相對百分比
            else if (columnBoundaries.relative && pageWidth && pageWidth > 0) {
                const relative = columnBoundaries.relative;
                boundaries = {
                    date: { 
                        start: relative.date.start * pageWidth, 
                        end: relative.date.end * pageWidth
                    },
                    deposit: { 
                        start: relative.deposit.start * pageWidth, 
                        end: relative.deposit.end * pageWidth
                    },
                    withdrawal: { 
                        start: relative.withdrawal.start * pageWidth, 
                        end: relative.withdrawal.end * pageWidth
                    },
                    balance: { 
                        start: relative.balance.start * pageWidth, 
                        end: relative.balance.end === 1.0 ? Infinity : (relative.balance.end * pageWidth)
                    },
                    detailsStart: relative.details.start * pageWidth,
                    detailsEnd: relative.details.end * pageWidth
                };
            }
            
            if (boundaries) {
                console.log('✓ 使用配置的框線距離:', boundaries);
                // 添加標記，表示使用了配置的框線
                boundaries.useConfiguredBoundaries = true;
                return boundaries;
            }
        }
    }
    
    // 回退到從標題行計算（原有邏輯）
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
        detailsEnd: depositStartX, // Details 到 Deposit 開始結束
        useConfiguredBoundaries: false  // 標記為未使用配置的框線
    };
}

// 恒生銀行模板引擎：根據配置應用模板提取數據行
// 注意：此函數不應包含匯豐銀行特定的邏輯（如 C/F BALANCE 停止），匯豐銀行使用 hsbc-template-engine.js
function applyHangSengTemplate(lines, headerRow, config, pageWidth) {
    const dataRows = [];
    const { indices, isMultiLine, line: headerLine } = headerRow;
    
    // 獲取標題行中各欄位的X座標範圍（傳入 config 和 pageWidth）
    const headerXPositions = getHeaderXPositions(headerLine, indices, config, pageWidth);
    if (!headerXPositions) {
        console.error('無法確定標題行的X座標位置');
        return dataRows;
    }
    
    // 處理多行標題的情況
    let headerY = null;
    if (isMultiLine && headerRow.line.length > 0) {
        headerY = headerRow.line[0].y;
    } else if (headerRow.line.length > 0) {
        headerY = headerRow.line[0].y;
    }
    
    const extractionConfig = config.extraction;
    const tolerance = extractionConfig.headerSkipTolerance || 5;
    
    // 找到標題行後，處理後續的行
    let foundHeader = false;
    let headerLineIndex = -1;
    
    // 先找到標題行的索引（通過匹配標題行的內容）
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        const lineText = line.map(item => item.text).join(' ').toLowerCase();
        // 檢查是否包含標題關鍵字
        if (lineText.includes('date') && lineText.includes('deposit') && 
            lineText.includes('withdrawal') && lineText.includes('balance')) {
            headerLineIndex = i;
            foundHeader = true;
            break;
        }
    }
    
    // 如果沒找到，嘗試用Y座標匹配
    if (headerLineIndex === -1 && headerY !== null) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length === 0) continue;
            const lineY = line[0]?.y || 0;
            if (Math.abs(lineY - headerY) < tolerance) {
                headerLineIndex = i;
                foundHeader = true;
                break;
            }
        }
    }
    
    console.log(`標題行索引: ${headerLineIndex}, 總行數: ${lines.length}`);
    if (headerLineIndex >= 0) {
        console.log(`標題行之後的前30行內容:`);
        for (let i = headerLineIndex + 1; i < Math.min(headerLineIndex + 31, lines.length); i++) {
            if (lines[i] && lines[i].length > 0) {
                const lineText = lines[i].map(item => item.text).join(' | ');
                console.log(`  行 ${i}: ${lineText}`);
            }
        }
    }
    
    // 恒生銀行：從標題行開始提取數據（不包含 C/F BALANCE 停止邏輯）
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (line.length === 0) continue;
        
        const lineY = line[0]?.y || 0;
        
        // 跳過標題行本身（包括多行標題）
        if (headerY !== null && Math.abs(lineY - headerY) < tolerance) {
            continue;
        }
        // 如果是多行標題，也跳過下一行
        if (isMultiLine && lineIdx < lines.length - 1) {
            const nextLineY = lines[lineIdx + 1]?.[0]?.y || 0;
            if (headerY !== null && Math.abs(nextLineY - headerY) < tolerance) {
                continue;
            }
        }
        
        // 只處理標題行之後的行
        if (lineIdx <= headerLineIndex) continue;
        
        const lineText = line.map(item => item.text).join(' ').toUpperCase();
        
        // 驗證規則：跳過明顯是標題或分隔線的行
        if (extractionConfig.validation) {
            const lineTextLower = lineText.toLowerCase();
            
            if (extractionConfig.validation.skipHeaderKeywords) {
                const headerKeywords = ['date', 'deposit', 'withdrawal', 'balance', '日期', '存入', '支出', '餘額'];
                if (headerKeywords.some(keyword => lineTextLower.includes(keyword))) {
                    continue;
                }
            }
            
            if (extractionConfig.validation.skipSeparators) {
                if (lineText.match(/^[\s\-_=]+$/)) {
                    continue;
                }
            }
        }
        
        // 根據策略提取數據
        // 使用上一行的日期（用於處理多行交易格式）
        // 找到最近一筆有日期的數據
        let previousDate = '';
        for (let i = dataRows.length - 1; i >= 0; i--) {
            if (dataRows[i] && dataRows[i].date) {
                previousDate = dataRows[i].date;
                break;
            }
        }
        
        let extracted = null;
        if (extractionConfig.strategy === 'details-first') {
            extracted = extractRowDataByConfig(line, headerXPositions, extractionConfig, previousDate);
        }
        // 可以在這裡添加其他策略
        // else if (extractionConfig.strategy === 'balance-first') { ... }
        
        // 調試：顯示提取結果（顯示更多行，特別是找到標題行之後的行）
        if (foundHeader && lineIdx < 45) { // 顯示標題行之後的前45行（包括行 40）
            const lineTextDebug = line.map(item => item.text).join(' | ');
            const lineItems = line.map((item, idx) => `${idx}:${item.text}@${item.x.toFixed(0)}`).join(' | ');
            console.log(`行 ${lineIdx}:`, lineTextDebug);
            // 對於關鍵行顯示詳細信息
            if (lineIdx < 15 || lineIdx === 40) {
                console.log(`  項目詳情:`, lineItems);
                console.log(`  X座標範圍:`, {
                    date: `${headerXPositions.date.start.toFixed(0)}-${headerXPositions.date.end.toFixed(0)}`,
                    details: `${headerXPositions.detailsStart.toFixed(0)}-${headerXPositions.detailsEnd.toFixed(0)}`,
                    deposit: `${headerXPositions.deposit.start.toFixed(0)}-${headerXPositions.deposit.end.toFixed(0)}`,
                    withdrawal: `${headerXPositions.withdrawal.start.toFixed(0)}-${headerXPositions.withdrawal.end.toFixed(0)}`,
                    balance: `${headerXPositions.balance.start.toFixed(0)}-∞`
                });
            }
            if (extracted && extracted.details) {
                console.log(`  Details: "${extracted.details}"`);
            }
            console.log(`  提取結果:`, extracted);
            if (!extracted) {
                console.log(`  ✗ 未提取到數據`);
            }
        }
        
        if (extracted) {
            // 驗證提取的數據
            if (validateExtractedData(extracted, extractionConfig.validation)) {
                // 檢查是否需要合併到上一行（多行交易，如 "THE GOVT OF HKSAR" + "MONTH PAYS"）
                if (dataRows.length > 0) {
                    const lastRow = dataRows[dataRows.length - 1];
                    const lastRowDetails = (lastRow.details || '').toUpperCase();
                    const currentDetails = (extracted.details || '').toUpperCase();
                    
                }
                
                dataRows.push(extracted);
                if (dataRows.length <= 3) { // 只顯示前3筆成功的數據
                    console.log(`  ✓ 成功提取第 ${dataRows.length} 筆數據:`, extracted);
                }
            } else {
                if (lineIdx < 10) {
                    console.log(`  ✗ 數據驗證失敗:`, extracted);
                }
            }
        }
    }
    
    return dataRows;
}

// 根據配置從一行中提取數據
function extractRowDataByConfig(line, headerXPositions, extractionConfig, previousDate = '') {
    if (line.length === 0) return null;
    
    // 步驟1：提取 Details
    let detailsResult = extractDetailsByConfig(line, headerXPositions, extractionConfig.details);
    
    // 如果 Details 提取失敗，嘗試從 Date 範圍內的項目中提取（處理日期和 Details 合併的情況）
    if (!detailsResult || !detailsResult.text) {
        // 檢查 Date 範圍內的項目是否包含日期和 Details（如 "30-Oct THE GOVT OF HKSAR"）
        for (let i = 0; i < line.length; i++) {
            const item = line[i];
            const itemX = item.x;
            const itemText = item.text.trim();
            
            // 如果項目在 Date 範圍內，且包含日期模式
            if (itemX >= headerXPositions.date.start && itemX < headerXPositions.date.end) {
                const datePattern = /\d{1,2}[\-\s]+\w{3}/;
                const dateMatch = itemText.match(datePattern);
                if (dateMatch && isValidDate(dateMatch[0])) {
                    // 提取日期後的部分作為 Details
                    const detailsPart = itemText.substring(dateMatch.index + dateMatch[0].length).trim();
                    if (detailsPart && detailsPart.length > 0) {
                        detailsResult = { text: detailsPart, index: i };
                        console.log(`  → 從 Date 範圍內提取 Details: "${detailsPart}" (從項目: "${itemText}")`);
                        break;
                    }
                }
            }
        }
    }
    
    if (!detailsResult || !detailsResult.text) {
        // 如果使用了配置的框線，不進行擴展範圍查找，嚴格按照框線範圍提取
        const useConfiguredBoundaries = headerXPositions.useConfiguredBoundaries === true;
        
        if (!useConfiguredBoundaries) {
            // 如果 Details 提取失敗，檢查是否為參考號行（可能在 Details 範圍外）
            // 參考號可能出現在 Date 和 Details 之間，或者稍微偏左
            const tolerance = extractionConfig.details?.rangeTolerance || 0;
            const extendedDetailsStart = headerXPositions.detailsStart - tolerance - 10; // 額外放寬 10 像素
            const extendedDetailsEnd = headerXPositions.detailsEnd + tolerance;
            
            // 在擴展範圍內查找可能的參考號
            for (let i = 0; i < line.length; i++) {
                const item = line[i];
                const itemX = item.x;
                const itemText = item.text.trim();
                
                // 檢查是否在擴展的 Details 範圍內
                if (itemX >= extendedDetailsStart && itemX < extendedDetailsEnd && itemText !== '') {
                    // 檢查是否為參考號格式
                    if (isReferenceNumberLine(itemText)) {
                        // 找到參考號，使用它作為 Details
                        detailsResult = { text: itemText, index: i };
                        console.log(`  → 在擴展範圍內找到參考號: "${itemText}" (X=${itemX.toFixed(0)})`);
                        break;
                    }
                }
            }
        }
        
        // 如果仍然沒有找到 Details，返回 null
        if (!detailsResult || !detailsResult.text) {
            // 調試：顯示為什麼 Details 提取失敗
            const lineText = line.map(item => item.text).join(' | ');
            const lineItems = line.map((item, idx) => `${idx}:${item.text}@${item.x.toFixed(0)}`).join(' | ');
            console.log(`  ✗ Details 提取失敗: ${lineText}`);
            console.log(`    項目詳情: ${lineItems}`);
            console.log(`    Details 範圍: ${headerXPositions.detailsStart.toFixed(0)}-${headerXPositions.detailsEnd.toFixed(0)}`);
            if (useConfiguredBoundaries) {
                console.log(`    (使用配置框線，嚴格按照範圍提取)`);
            }
            return null;
        }
    }
    
    let { text: detailsText, index: detailsIndex } = detailsResult;
    
    // 步驟2：提取日期（先從左邊找，如果沒找到，檢查 Details 本身是否包含日期）
    let date = extractDateByConfig(line, detailsIndex, extractionConfig.date);
    
    // 如果日期在 Details 中（匯豐銀行格式：日期和詳情連在一起，如 "12-Dec TO PAYME"）
    // 注意：不要從 Details 中提取日期，因為 Details 中可能包含帳號格式（如 "805-659968-833"），會被誤識別為日期
    // 日期應該在 Date 欄位中，或者在 Details 的開頭且格式明確（如 "12-Dec TO PAYME"）
    if (!date && detailsText) {
        // 只在 Details 開頭查找日期（避免從帳號中提取）
        const detailsTrimmed = detailsText.trim();
        for (const pattern of extractionConfig.date.patterns || []) {
            // 只在開頭匹配
            const match = detailsTrimmed.match(new RegExp('^' + pattern.source));
            if (match) {
                const matchedDate = match[0];
                // 驗證提取的日期是否有效，且不是帳號格式
                if (isValidDate(matchedDate) && !isAccountNumber(matchedDate)) {
                    date = matchedDate;
                    // 從 Details 中移除日期部分
                    detailsText = detailsText.replace(new RegExp('^' + pattern.source), '').trim();
                    break;
                }
            }
        }
    }
    
    // 如果還是沒找到日期，使用上一行的日期（匯豐銀行多行交易格式）
    // 但只有在上一行日期有效時才使用
    if (!date && previousDate && isValidDate(previousDate)) {
        date = previousDate;
    }
    
    // 步驟3：提取金額（傳遞 detailsText 用於判斷 Deposit/Withdrawal）
    const amounts = extractAmountsByConfig(line, detailsIndex, headerXPositions, extractionConfig.amounts, detailsText);
    
    return {
        date: date,
        details: detailsText,
        deposit: amounts.deposit || '',
        withdrawal: amounts.withdrawal || '',
        balance: amounts.balance || ''
    };
}

// 根據配置提取 Details
function extractDetailsByConfig(line, headerXPositions, detailsConfig) {
    const detailsItems = [];
    const detailsItemIndices = [];
    let detailsX = null;
    let detailsIndex = -1;
    
    // 檢查是否使用了配置的框線
    const useConfiguredBoundaries = headerXPositions.useConfiguredBoundaries === true;
    
    if (detailsConfig.method === 'x-range') {
        // 獲取容差（匯豐銀行可能需要）
        const tolerance = detailsConfig.rangeTolerance || 0;
        
        // 在Details欄位範圍內收集所有非空文字
        for (let i = 0; i < line.length; i++) {
            const item = line[i];
            const itemX = item.x;
            const itemText = item.text.trim();
            
            // 檢查是否在Details欄位範圍內（允許容差）
            if (itemX >= (headerXPositions.detailsStart - tolerance) && 
                itemX < (headerXPositions.detailsEnd + tolerance) && 
                itemText !== '') {
                
                // 移除格式過濾：無條件收集範圍內的所有非空文字
                detailsItems.push(itemText);
                detailsItemIndices.push(i);
                if (detailsX === null) {
                    detailsX = itemX;
                    detailsIndex = i;
                }
            }
        }
        
        // 如果沒在嚴格範圍內找到，且未使用配置框線，才放寬條件
        if (detailsItems.length === 0 && detailsConfig.fallbackToLooseRange && !useConfiguredBoundaries) {
            for (let i = 0; i < line.length; i++) {
                const item = line[i];
                const itemX = item.x;
                const itemText = item.text.trim();
                
                // 放寬範圍：在 Date 開始之前或之後，Deposit 開始之前（包括 Date 範圍內和之前的項目）
                // 移除格式過濾：無條件收集範圍內的所有非空文字
                if (itemX < headerXPositions.deposit.start && 
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
    }
    
    // 將所有Details項目組合成一個字串
    if (detailsItems.length > 0) {
        let detailsText = detailsItems.join(' ');
        
        // 調試：顯示收集到的 Details 項目
        if (detailsItems.length > 1 || detailsText.includes('CR TO') || detailsText.includes('445-3-0191') || detailsText === '137') {
            console.log(`  Details 項目 (${detailsItems.length} 個):`, detailsItems);
            console.log(`  組合後的 Details: "${detailsText}"`);
        }
        
        // 移除格式過濾：不再從 Details 中移除日期，保留所有原始內容
        
        if (detailsIndex === -1 && detailsItemIndices.length > 0) {
            detailsIndex = detailsItemIndices[0];
        }
        
        // 確保 Details 不為空
        if (detailsText && detailsText.trim() !== '') {
            return { text: detailsText, index: detailsIndex };
        }
    }
    
    return null;
}

// 檢查是否為帳號格式（輔助函數）
function isAccountNumber(text) {
    if (!text || text.trim() === '') return false;
    const trimmed = text.trim();
    
    // 帳號格式模式：
    // - 數字-數字-數字（如 "445-3-019137", "805-659968-833"）
    // - 數字-多位數字（如 "05-659"）
    const accountPatterns = [
        /^\d{1,3}-\d{1,6}(-\d{1,6})?$/, // 基本帳號格式
        /^\d{2,3}-\d{3,9}$/, // 2-3位數字-3-9位數字
        /^\d{1,3}-\d{1,2}-\d{3,9}$/ // 1-3位-1-2位-3-9位（如 "445-3-019137"）
    ];
    
    for (const pattern of accountPatterns) {
        if (pattern.test(trimmed)) {
            const parts = trimmed.split('-');
            // 如果第一部分是3位或更多位數字，且第二部分是1-2位數字，可能是帳號
            if (parts.length >= 2 && parts[0].length >= 3 && parts[1].length <= 2) {
                return true;
            }
            // 如果第二部分是6位或更多位數字，可能是帳號
            if (parts.length >= 2 && parts[1].length >= 6) {
                return true;
            }
            // 如果第一部分是2位數字，第二部分是3-6位數字，且沒有月份關鍵字，可能是帳號
            if (parts.length >= 2 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6) {
                const monthKeywords = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                if (!monthKeywords.some(month => trimmed.toLowerCase().includes(month))) {
                    return true;
                }
            }
            // 如果第一部分是2位數字，第二部分是3-5位數字，第三部分是3-9位數字，可能是帳號（如 "805-659968-833"）
            if (parts.length >= 3 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6 && parts[2].length >= 3) {
                return true;
            }
        }
    }
    
    return false;
}

// 驗證日期是否有效（匯豐銀行格式：DD-MMM）
function isValidDate(dateText) {
    if (!dateText || dateText.trim() === '') return false;
    
    const text = dateText.trim();
    
    // 排除明顯不是日期的內容
    // 1. 電話號碼格式（如 "2233 3000", "33 300"）
    if (/^\d{2,4}\s+\d{3,4}$/.test(text)) return false;
    
    // 2. 帳號格式（如 "805-659968-833", "05-659", "445-3-019137"）
    // 檢查多種帳號格式：
    // - 數字-數字-數字（如 "445-3-019137"）
    // - 數字-多位數字-數字（如 "805-659968-833"）
    // - 數字-多位數字（如 "05-659"）
    if (/^\d{1,3}-\d{1,6}(-\d{1,6})?$/.test(text)) {
        // 如果包含多個連字符，且數字部分不符合日期格式，則不是日期
        const parts = text.split('-');
        if (parts.length >= 2) {
            // 如果第一部分是3位或更多位數字，且第二部分是1-2位數字，可能是帳號
            if (parts[0].length >= 3 && parts[1].length <= 2) return false;
            // 如果第二部分是6位或更多位數字，可能是帳號
            if (parts[1].length >= 6) return false;
        }
    }
    
    // 3. 純數字且長度不合理（如 "431254", "08"）
    if (/^\d+$/.test(text) && (text.length < 3 || text.length > 6)) return false;
    
    // 4. 包含明顯非日期字符（如 "12 10O", "80 17D"）
    if (/^\d+\s+\d+[A-Z]$/.test(text)) return false;
    
    // 5. 標準日期格式（DD-MMM, DD-MMM-YY 等）
    const monthAbbreviations = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    
    // 檢查 DD-MMM 格式（如 "6-Oct", "8-Dec"）
    const ddmmyPattern = /^\d{1,2}[\-\s]+(\w{3})$/;
    const ddmmyMatch = text.match(ddmmyPattern);
    if (ddmmyMatch) {
        const monthPart = ddmmyMatch[1].toLowerCase();
        // 必須是有效的月份縮寫
        if (monthAbbreviations.includes(monthPart)) {
            return true;
        }
        // 如果不是月份縮寫，可能是帳號的一部分，返回 false
        return false;
    }
    
    // 檢查 DD-MMM-YY 格式（如 "6-Oct-25", "8-Dec-2024"）
    const ddmmyyPattern = /^\d{1,2}[\-\s]+(\w{3})[\-\s]+\d{2,4}$/;
    const ddmmyyMatch = text.match(ddmmyyPattern);
    if (ddmmyyMatch) {
        const monthPart = ddmmyyMatch[1].toLowerCase();
        // 必須是有效的月份縮寫
        if (monthAbbreviations.includes(monthPart)) {
            return true;
        }
        return false;
    }
    
    // 其他日期格式
    const otherDatePatterns = [
        /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/, // 06/10/25, 08-12-2024
        /^\d{1,2}\s+\w{3}\s+\d{2,4}$/, // 6 Oct 2024
        /^\w{3}\s+\d{1,2},?\s+\d{2,4}$/ // Oct 6, 2024
    ];
    
    return otherDatePatterns.some(pattern => {
        const match = text.match(pattern);
        if (match) {
            // 如果包含月份縮寫，驗證它是否有效
            const monthMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
            if (monthMatch) {
                return monthAbbreviations.includes(monthMatch[1].toLowerCase());
            }
            // 如果沒有月份縮寫，可能是純數字日期格式（如 "06/10/25"），允許通過
            return true;
        }
        return false;
    });
}

// 檢查字符串中是否包含帳號格式模式（即使有前綴，如 "CR TO 445-3-019137"）
function containsAccountNumberPattern(text) {
    if (!text || text.trim() === '') return false;
    const trimmed = text.trim();
    
    // 帳號格式模式（在字符串中查找，不要求從開頭開始）：
    // - 數字-數字-數字（如 "445-3-019137", "805-659968-833"）
    const accountPatterns = [
        /\d{1,3}-\d{1,6}(-\d{1,6})?/, // 基本帳號格式（如 "445-3-019137", "805-659968-833"）
        /\d{2,3}-\d{3,9}/, // 2-3位數字-3-9位數字
        /\d{1,3}-\d{1,2}-\d{3,9}/ // 1-3位-1-2位-3-9位（如 "445-3-019137"）
    ];
    
    for (const pattern of accountPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
            const matchedAccount = match[0];
            const parts = matchedAccount.split('-');
            // 如果第一部分是3位或更多位數字，且第二部分是1-2位數字，可能是帳號
            if (parts.length >= 2 && parts[0].length >= 3 && parts[1].length <= 2) {
                return true;
            }
            // 如果第二部分是6位或更多位數字，可能是帳號
            if (parts.length >= 2 && parts[1].length >= 6) {
                return true;
            }
            // 如果第一部分是2位數字，第二部分是3-6位數字，且沒有月份關鍵字，可能是帳號
            if (parts.length >= 2 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6) {
                const monthKeywords = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                if (!monthKeywords.some(month => matchedAccount.toLowerCase().includes(month))) {
                    return true;
                }
            }
            // 如果第一部分是2位數字，第二部分是3-5位數字，第三部分是3-9位數字，可能是帳號（如 "805-659968-833"）
            if (parts.length >= 3 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6 && parts[2].length >= 3) {
                return true;
            }
        }
    }
    
    return false;
}

// 檢查是否為帳號格式（輔助函數）
function isAccountNumber(text) {
    if (!text || text.trim() === '') return false;
    const trimmed = text.trim();
    
    // 如果字符串包含帳號格式模式，也視為帳號
    if (containsAccountNumberPattern(trimmed)) {
        return true;
    }
    
    // 帳號格式模式：
    // - 數字-數字-數字（如 "445-3-019137", "805-659968-833"）
    // - 數字-多位數字（如 "05-659"）
    const accountPatterns = [
        /^\d{1,3}-\d{1,6}(-\d{1,6})?$/, // 基本帳號格式
        /^\d{2,3}-\d{3,9}$/, // 2-3位數字-3-9位數字
        /^\d{1,3}-\d{1,2}-\d{3,9}$/ // 1-3位-1-2位-3-9位（如 "445-3-019137"）
    ];
    
    for (const pattern of accountPatterns) {
        if (pattern.test(trimmed)) {
            const parts = trimmed.split('-');
            // 如果第一部分是3位或更多位數字，且第二部分是1-2位數字，可能是帳號
            if (parts.length >= 2 && parts[0].length >= 3 && parts[1].length <= 2) {
                return true;
            }
            // 如果第二部分是6位或更多位數字，可能是帳號
            if (parts.length >= 2 && parts[1].length >= 6) {
                return true;
            }
            // 如果第一部分是2位數字，第二部分是3-6位數字，且沒有月份關鍵字，可能是帳號
            if (parts.length >= 2 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6) {
                const monthKeywords = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                if (!monthKeywords.some(month => trimmed.toLowerCase().includes(month))) {
                    return true;
                }
            }
            // 如果第一部分是2位數字，第二部分是3-5位數字，第三部分是3-9位數字，可能是帳號（如 "805-659968-833"）
            if (parts.length >= 3 && parts[0].length === 2 && parts[1].length >= 3 && parts[1].length <= 6 && parts[2].length >= 3) {
                return true;
            }
        }
    }
    
    return false;
}

// 根據配置提取日期
function extractDateByConfig(line, detailsIndex, dateConfig) {
    if (detailsIndex < 0 || detailsIndex >= line.length) return '';
    
    let date = '';
    
    if (dateConfig.searchDirection === 'left') {
        // 從 Details 往左找
        // 先嘗試匹配標準日期格式
        for (let i = detailsIndex - 1; i >= 0; i--) {
            const itemText = line[i].text.trim();
            if (dateConfig.patterns && dateConfig.patterns.some(pattern => pattern.test(itemText))) {
                // 驗證提取的日期是否有效
                if (isValidDate(itemText)) {
                    date = itemText;
                    break;
                }
            }
        }
        
        // 如果沒找到標準日期格式，檢查 Details 本身是否包含日期（匯豐銀行格式：日期和詳情可能連在一起）
        // 注意：只在 Details 開頭查找日期，避免從帳號中提取（如 "805-659968-833"）
        if (!date && detailsIndex >= 0 && detailsIndex < line.length) {
            const detailsText = line[detailsIndex].text.trim();
            // 只在開頭檢查日期格式（如 "12-Dec TO PAYME"）
            for (const pattern of dateConfig.patterns || []) {
                // 只在開頭匹配
                const match = detailsText.match(new RegExp('^' + pattern.source));
                if (match) {
                    const matchedDate = match[0];
                    // 驗證提取的日期是否有效，且不是帳號格式
                    if (isValidDate(matchedDate) && !isAccountNumber(matchedDate)) {
                        date = matchedDate;
                        break;
                    }
                }
            }
        }
        
        // 如果沒找到標準日期格式，使用備用方案（但只接受有效的日期格式）
        if (!date && dateConfig.fallback === 'first-number') {
            for (let i = detailsIndex - 1; i >= 0; i--) {
                const itemText = line[i].text.trim();
                // 只接受符合日期格式的內容，且不是帳號格式
                if (dateConfig.patterns && dateConfig.patterns.some(pattern => pattern.test(itemText))) {
                    if (isValidDate(itemText) && !isAccountNumber(itemText)) {
                        date = itemText;
                        break;
                    }
                }
            }
        }
    }
    // 可以在這裡添加其他方向的搜索（如 'right'）
    
    return date;
}

// 根據配置提取金額
function extractAmountsByConfig(line, detailsIndex, headerXPositions, amountsConfig, detailsText = '') {
    const result = {
        deposit: '',
        withdrawal: '',
        balance: ''
    };
    
    if (detailsIndex < 0 || detailsIndex >= line.length) return result;
    
    // 檢查 Details 是否包含 Deposit 關鍵字（匯豐銀行：如 "CREDIT INTEREST", "THE GOVT OF HKSAR MONTH PAYS"）
    const detailsUpper = (detailsText || line[detailsIndex]?.text || '').toUpperCase();
    const isDepositTransaction = detailsUpper.includes('CREDIT') || 
                                 detailsUpper.includes('INTEREST') ||
                                 detailsUpper.includes('MONTH PAYS') ||
                                 (detailsUpper.includes('THE GOVT') && detailsUpper.includes('HKSAR'));
    
    // 檢查是否為 B/F BALANCE 或 C/F BALANCE 行（特殊處理：金額應該在 Balance 欄位）
    const isBalanceForward = detailsUpper.includes('B/F BALANCE') || 
                            detailsUpper.includes('C/F BALANCE') ||
                            detailsUpper.includes('B/F BAL') ||
                            detailsUpper.includes('C/F BAL');
    
    // 從 Details 右邊開始找所有金額
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
    
    // 調試：顯示找到的金額
    if (amounts.length > 0) {
        console.log(`  找到 ${amounts.length} 個金額:`, amounts.map(a => `${a.text}@${a.x.toFixed(0)}`).join(', '));
        console.log(`  欄位範圍: deposit[${headerXPositions.deposit.start.toFixed(0)}-${headerXPositions.deposit.end.toFixed(0)}], withdrawal[${headerXPositions.withdrawal.start.toFixed(0)}-${headerXPositions.withdrawal.end.toFixed(0)}], balance[${headerXPositions.balance.start.toFixed(0)}-∞]`);
        if (isDepositTransaction) {
            console.log(`  → 檢測到 Deposit 交易（根據 Details 關鍵字）`);
        }
        if (isBalanceForward) {
            console.log(`  → 檢測到 B/F 或 C/F BALANCE 行（金額應在 Balance 欄位）`);
        }
    }
    
    // 如果是 B/F BALANCE 或 C/F BALANCE 行，將所有金額強制放在 Balance 欄位
    // 這是因為這些行的金額必定是 Balance，不管 X 座標在哪裡，也不管有幾個金額
    if (isBalanceForward && amounts.length > 0) {
        // 對於 B/F/C/F BALANCE 行，通常只有一個金額，應該在 Balance 欄位
        const firstAmount = amounts[0];
        result.balance = firstAmount.text;
        console.log(`  → Balance (B/F/C/F BALANCE 特殊處理): ${firstAmount.text} (X=${firstAmount.x.toFixed(0)})`);
        return result;
    }
    
    // 根據X座標將金額分配到對應欄位
    // 先按 X 座標排序，確保從左到右處理
    const sortedAmounts = [...amounts].sort((a, b) => a.x - b.x);
    
    for (const amount of sortedAmounts) {
        // Deposit欄
        if (amount.x >= headerXPositions.deposit.start && 
            amount.x < headerXPositions.withdrawal.start) {
            if (!result.deposit) {
                result.deposit = amount.text;
                console.log(`  → Deposit: ${amount.text} (X=${amount.x.toFixed(0)})`);
            }
        }
        // Withdrawal欄
        else if (amount.x >= headerXPositions.withdrawal.start && 
                 amount.x < headerXPositions.balance.start) {
            // 如果 Details 包含 Deposit 關鍵字，且金額在 Withdrawal 範圍內，可能是 Deposit
            if (isDepositTransaction && !result.deposit) {
                result.deposit = amount.text;
                console.log(`  → Deposit (特殊處理): ${amount.text} (X=${amount.x.toFixed(0)}, 根據 Details 判斷)`);
            } else if (!result.withdrawal) {
                result.withdrawal = amount.text;
                console.log(`  → Withdrawal: ${amount.text} (X=${amount.x.toFixed(0)})`);
            }
        }
        // Balance欄：在 Withdrawal 之後的所有金額都可能是 Balance
        // 匯豐銀行格式：Balance 可能在 withdrawal.end 之後，不一定在 balance.start 之後
        else if (amount.x >= headerXPositions.withdrawal.end || 
                 amount.x >= headerXPositions.balance.start) {
            // 如果已經有 Deposit 或 Withdrawal，且這個金額在它們之後，應該是 Balance
            if ((result.deposit || result.withdrawal) && !result.balance) {
                result.balance = amount.text;
                console.log(`  → Balance: ${amount.text} (X=${amount.x.toFixed(0)})`);
            } else if (!result.balance) {
                result.balance = amount.text;
                console.log(`  → Balance: ${amount.text} (X=${amount.x.toFixed(0)})`);
            }
        } else {
            console.log(`  → 未分配: ${amount.text} (X=${amount.x.toFixed(0)}, 不在任何欄位範圍內)`);
        }
    }
    
    // 匯豐銀行特殊處理：如果有多個金額，第二個應該是 Balance
    // 但如果第二個金額被誤識別為 Withdrawal（如 CREDIT INTEREST 的情況），需要修正
    if (sortedAmounts.length >= 2) {
        const firstAmount = result.deposit || result.withdrawal;
        if (firstAmount) {
            const secondAmount = sortedAmounts.find(a => 
                a.text !== firstAmount && 
                a.x > headerXPositions.withdrawal.start
            );
            if (secondAmount) {
                // 如果第二個金額被誤識別為 Withdrawal，且 Details 包含 Deposit 關鍵字，應該是 Balance
                if (secondAmount.text === result.withdrawal && isDepositTransaction && !result.balance) {
                    // 將 Withdrawal 改為 Balance
                    result.balance = result.withdrawal;
                    result.withdrawal = '';
                    console.log(`  → Balance (修正): ${secondAmount.text} (X=${secondAmount.x.toFixed(0)}, 從 Withdrawal 修正為 Balance)`);
                } else if (!result.balance) {
                    result.balance = secondAmount.text;
                    console.log(`  → Balance (特殊處理): ${secondAmount.text} (X=${secondAmount.x.toFixed(0)}, 第二個金額)`);
                }
            }
        }
    }
    
    // 處理 Balance 未找到的情況
    if (!result.balance && amountsConfig.ifBalanceNotFound === 'empty') {
        // 留空，不做任何處理
    }
    // 可以在這裡添加其他處理方式
    
    return result;
}

// 檢查是否為參考號行（匯豐銀行格式：如 "HC125A2689170335 | 26OCT", "T251007IY848(07OCT25)"）
function isReferenceNumberLine(details) {
    if (!details || details.trim() === '') return false;
    const detailsUpper = details.toUpperCase();
    
    // 參考號格式：
    // 1. HC125... 開頭
    // 2. T25... 開頭
    // 3. NA... 開頭
    // 4. 包含日期格式在末尾（如 "26OCT", "07OCT25"）
    const refPatterns = [
        /^HC\d+[A-Z0-9]*\s*\d{2,3}[A-Z]{3}/, // HC125A2689170335 26OCT
        /^T25\d+[A-Z0-9]*\([0-9A-Z]+\)/, // T251007IY848(07OCT25)
        /^NA\d+\([0-9A-Z]+\)/, // NA1977286072(19OCT25)
        /^\d{6,}$/ // 純數字參考號（如 431254）
    ];
    
    return refPatterns.some(pattern => pattern.test(detailsUpper));
}

// 驗證提取的數據
function validateExtractedData(extracted, validationConfig) {
    if (!validationConfig) return true;
    
    // 如果日期存在，驗證日期是否有效
    if (extracted.date && extracted.date.trim() !== '') {
        if (!isValidDate(extracted.date)) {
            // 日期無效，清空日期
            extracted.date = '';
        }
    }
    
    // 如果是參考號行，放寬驗證（允許沒有金額）
    if (isReferenceNumberLine(extracted.details)) {
        // 參考號行只需要有 Details 即可
        return extracted.details && extracted.details.trim() !== '';
    }
    
    // 檢查是否為 Deposit 交易（Deposit 交易可能沒有 Balance）
    const detailsUpper = (extracted.details || '').toUpperCase();
    const isDepositTransaction = detailsUpper.includes('CREDIT') || 
                                 detailsUpper.includes('INTEREST') ||
                                 detailsUpper.includes('MONTH PAYS') ||
                                 (detailsUpper.includes('THE GOVT') && detailsUpper.includes('HKSAR'));
    
    if (validationConfig.requireDateOrBalance) {
        const hasDate = extracted.date && isValidDate(extracted.date);
        const hasBalance = extracted.balance && /\d/.test(extracted.balance);
        const hasDeposit = extracted.deposit && /\d/.test(extracted.deposit);
        const hasWithdrawal = extracted.withdrawal && /\d/.test(extracted.withdrawal);
        
        // Deposit 交易：需要日期或 Deposit 金額
        if (isDepositTransaction) {
            if (!hasDate && !hasDeposit) {
                return false;
            }
        } else {
            // 其他交易：需要日期或餘額
            if (!hasDate && !hasBalance) {
                return false;
            }
        }
    }
    
    return true;
}

// 判斷是否為金額格式（從 script.js 複製，確保一致性）
function isAmount(text) {
    if (!text) return false;
    
    // 排除帳號格式（如 "805-659968-833", "445-3-019137"）
    if (isAccountNumber(text)) {
        return false;
    }
    
    // 排除純數字參考號（如 "431254"）- 這些通常是參考號，不是金額
    // 如果純數字長度在 6-12 位之間，且沒有小數點或逗號，可能是參考號
    if (/^\d{6,12}$/.test(text.trim())) {
        return false;
    }
    
    // 金額通常包含數字、小數點、逗號、貨幣符號等
    const amountPattern = /^[\$€£¥]?[\d,]+\.?\d*[\-]?$/;
    const hasNumbers = /\d/.test(text);
    // 金額必須包含小數點或逗號（千位分隔符），或者有貨幣符號
    // 純數字且沒有小數點/逗號的，不應被視為金額（可能是參考號）
    const looksLikeAmount = amountPattern.test(text.replace(/\s/g, '')) || 
                           (hasNumbers && (text.includes('.') || text.includes(',')));
    
    return looksLikeAmount && !isDate(text);
}

// 判斷是否為日期格式（從 script.js 複製，確保一致性）
function isDate(text) {
    if (!text || !/\d/.test(text)) return false;
    
    const datePatterns = [
        /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/,
        /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,
        /\d{1,2}\s+\w{3}\s+\d{2,4}/,
        /\d{1,2}\s+\w+\s+\d{2,4}/,
        /\w{3}\s+\d{1,2},?\s+\d{2,4}/,
    ];
    
    return datePatterns.some(pattern => pattern.test(text));
}
