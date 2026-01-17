// 銀行模板配置文件
// 當銀行格式變更時，只需修改此文件中的配置，無需修改代碼

const BANK_TEMPLATE_CONFIGS = {
    hangseng: {
        name: '恒生銀行',
        version: '1.0',
        
        // 欄位識別配置（用於識別標題行中的欄位）
        fieldMatching: {
            date: { 
                keywords: ['date', '日期', '交易日期', '交易日', 'posting date', 'value date']
            },
            deposit: { 
                keywords: ['deposit', '存入', '存款', 'credit', '收入', '收款']
            },
            withdrawal: { 
                keywords: ['withdrawal', 'withdraw', '支出', '提取', '提款', 'debit', '付款', '支付']
            },
            balance: { 
                keywords: ['balance', '餘額', '結餘', '結存', 'balance b/f', 'balance c/f']
            }
        },
        
        // 提取邏輯配置
        extraction: {
            // 提取策略：'details-first' = 從 Details 開始，往左找日期，往右找金額
            strategy: 'details-first',
            
            // 標題行跳過容差（Y座標容差，用於判斷是否為標題行）
            headerSkipTolerance: 5,
            
            // Details 提取配置
            details: {
                method: 'x-range', // 使用 X 座標範圍判斷
                collectAll: true, // 收集範圍內所有文字項目
                allowNumbers: true, // 允許包含數字
                allowSymbols: true, // 允許包含符號
                // 如果嚴格範圍內找不到，是否放寬條件
                fallbackToLooseRange: true
            },
            
            // 日期提取配置
            date: {
                searchDirection: 'left', // 從 Details 往左找
                patterns: [
                    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/, // DD/MM/YYYY, DD-MM-YY 等
                    /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/, // YYYY-MM-DD 等
                    /\d{1,2}\s+\w{3}\s+\d{2,4}/, // 01 Jan 2024
                    /\d{1,2}\s+\w+\s+\d{2,4}/, // 01 January 2024
                    /\w{3}\s+\d{1,2},?\s+\d{2,4}/ // Jan 01, 2024
                ],
                // 備用方案：如果沒找到標準日期格式
                fallback: 'first-number' // 'first-number' = 使用第一個包含數字的元素
            },
            
            // 金額提取配置
            amounts: {
                searchDirection: 'right', // 從 Details 往右找
                // 各欄位的範圍定義
                fieldRanges: {
                    deposit: { 
                        after: 'date', // 在 Date 之後
                        before: 'withdrawal' // 在 Withdrawal 之前
                    },
                    withdrawal: { 
                        after: 'deposit', // 在 Deposit 之後
                        before: 'balance' // 在 Balance 之前
                    },
                    balance: { 
                        after: 'withdrawal', // 在 Withdrawal 之後
                        position: 'rightmost' // 位置：最右邊
                    }
                },
                // Balance 未找到時的處理方式
                ifBalanceNotFound: 'empty' // 'empty' = 留空，不強行使用最右邊的金額
            },
            
            // 驗證規則
            validation: {
                // 至少要有日期或餘額才認為是有效數據行
                requireDateOrBalance: true,
                // 跳過包含標題關鍵字的行
                skipHeaderKeywords: true,
                // 跳過分隔線
                skipSeparators: true
            }
        }
    },
    
    // 匯豐銀行模板配置
    hsbc: {
        name: '匯豐銀行',
        version: '1.0',
        
        // 欄位識別配置（用於識別標題行中的欄位）
        fieldMatching: {
            date: { 
                keywords: ['date', '日期', '交易日期', '交易日', 'value date', 'posting date']
            },
            deposit: { 
                keywords: ['deposit', '存入', '存款', 'credit', '收入', '收款']
            },
            withdrawal: { 
                keywords: ['withdrawal', 'withdraw', '支出', '提取', '提款', 'debit', '付款', '支付']
            },
            balance: { 
                keywords: ['balance', '餘額', '結餘', '結存', 'balance b/f', 'balance c/f']
            }
        },
        
        // 提取邏輯配置（可以根據匯豐銀行的實際格式調整）
        extraction: {
            // 提取策略：'details-first' = 從 Details 開始，往左找日期，往右找金額
            strategy: 'details-first',
            
            // 標題行跳過容差（Y座標容差，用於判斷是否為標題行）
            headerSkipTolerance: 5,
            
            // Details 提取配置
            details: {
                method: 'x-range', // 使用 X 座標範圍判斷
                collectAll: true, // 收集範圍內所有文字項目
                allowNumbers: true, // 允許包含數字
                allowSymbols: true, // 允許包含符號
                // 如果嚴格範圍內找不到，是否放寬條件
                fallbackToLooseRange: true
            },
            
            // 日期提取配置
            date: {
                searchDirection: 'left', // 從 Details 往左找
                patterns: [
                    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/, // DD/MM/YYYY, DD-MM-YY 等
                    /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/, // YYYY-MM-DD 等
                    /\d{1,2}\s+\w{3}\s+\d{2,4}/, // 01 Jan 2024
                    /\d{1,2}\s+\w+\s+\d{2,4}/, // 01 January 2024
                    /\w{3}\s+\d{1,2},?\s+\d{2,4}/ // Jan 01, 2024
                ],
                // 備用方案：如果沒找到標準日期格式
                fallback: 'first-number' // 'first-number' = 使用第一個包含數字的元素
            },
            
            // 金額提取配置
            amounts: {
                searchDirection: 'right', // 從 Details 往右找
                // 各欄位的範圍定義
                fieldRanges: {
                    deposit: { 
                        after: 'date', // 在 Date 之後
                        before: 'withdrawal' // 在 Withdrawal 之前
                    },
                    withdrawal: { 
                        after: 'deposit', // 在 Deposit 之後
                        before: 'balance' // 在 Balance 之前
                    },
                    balance: { 
                        after: 'withdrawal', // 在 Withdrawal 之後
                        position: 'rightmost' // 位置：最右邊
                    }
                },
                // Balance 未找到時的處理方式
                ifBalanceNotFound: 'empty' // 'empty' = 留空，不強行使用最右邊的金額
            },
            
            // 驗證規則
            validation: {
                // 至少要有日期或餘額才認為是有效數據行
                requireDateOrBalance: true,
                // 跳過包含標題關鍵字的行
                skipHeaderKeywords: true,
                // 跳過分隔線
                skipSeparators: true
            }
        }
    }
};

// 導出配置（如果使用模塊系統）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BANK_TEMPLATE_CONFIGS;
}
