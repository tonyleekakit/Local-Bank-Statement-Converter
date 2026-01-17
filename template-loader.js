// 銀行模板載入器
// 此文件定義全局配置對象，各個銀行模板配置文件會將自己的配置註冊到此對象中

const BANK_TEMPLATE_CONFIGS = {};

// 導出配置（如果使用模塊系統）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BANK_TEMPLATE_CONFIGS;
}
