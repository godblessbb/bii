let stockData = [];
let currentSortColumn = 'pct-change-1';
let isAscending = false;
let activeFilters = {
    industry: []
};

document.addEventListener('DOMContentLoaded', function() {
    fetch('top_100_stocks.csv')
        .then(response => response.text())
        .then(data => {
            stockData = parseCSV(data);
            sortStocks('pct-change-1');  // 默认排序
            updateSortIndicators(document.getElementById('pct-change-1'));  // 更新按钮状态
            displayStockData(stockData);
            updateDateTime();
            setupIndustryFilter();
        })
        .catch(error => console.error('Error loading CSV data:', error));
});

document.addEventListener('navigationGenerated', function() {
    setupSortListeners();
});

function parseCSV(csv) {
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(header => header.trim());

    return lines.slice(1).map(line => {
        const values = [];
        let currentValue = '';
        let insideQuotes = false;

        for (let char of line) {
            if (char === '"') {
                insideQuotes = !insideQuotes;
            } else if (char === ',' && !insideQuotes) {
                values.push(currentValue.trim());
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        values.push(currentValue.trim());  // 添加最后一个字段

        // 移除所有字段中的引号
        const cleanedValues = values.map(value => value.replace(/^"(.*)"$/, '$1').replace(/"/g, ''));

        return headers.reduce((obj, header, index) => {
            obj[header] = cleanedValues[index] || '';
            return obj;
        }, {});
    });
}

function setupIndustryFilter() {
    const industries = {};
    stockData.forEach(stock => {
        if (stock.industry) {
            industries[stock.industry] = (industries[stock.industry] || 0) + 1;
        }
    });

    const topIndustries = Object.entries(industries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(entry => entry[0]);

    const filterContainer = document.createElement('div');
    filterContainer.className = 'filter-section';
    filterContainer.innerHTML = `
        <hr class="filter-divider">
        <h3 class="section-title">Industry</h3>
        <div class="checkbox-group" data-name="Industry">
            ${topIndustries.map(industry => `
                <label>
                    <input type="checkbox" value="${industry}"> ${industry}
                </label>
            `).join('')}
        </div>
    `;

    document.getElementById('filters-container').appendChild(filterContainer);

    filterContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                activeFilters.industry.push(this.value);
            } else {
                activeFilters.industry = activeFilters.industry.filter(v => v !== this.value);
            }
            applyFilters();
        });
    });
}

function applyFilters() {
    const filteredData = stockData.filter(stock => {
        return activeFilters.industry.length === 0 || activeFilters.industry.includes(stock.industry);
    });
    displayStockData(filteredData);
}

function displayStockData(stocks) {
    const tableBody = document.querySelector('#product-list table tbody');
    tableBody.innerHTML = '';

    stocks.forEach(stock => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(stock['stock_code'])}</td>
            <td>${escapeHtml(stock['shortName'])}</td>
            <td>${escapeHtml(stock['industry'])}</td>
            <td>${formatDate(stock['Date0'])}</td>
            <td>${formatPrice(stock['Close0'])}</td>
            <td>${formatPercentage(stock['PCT_Change1'])}</td>
            <td>${formatPercentage(stock['PCT_Change3'])}</td>
            <td>${formatPercentage(stock['PCT_Change5'])}</td>
            <td>${formatPercentage(stock['PCT_Change10'])}</td>
            <td>${formatVolume(stock['Volume'])}</td>
            <td>${formatTurnoverRate(stock['Turnover_Rate'])}</td>
        `;
        tableBody.appendChild(tr);
    });
    updateDealsCount(stocks.length);
}

// 添加一个新的函数来格式化日期（如果需要的话）
function formatDate(dateString) {
    // 假设日期格式是 'YYYY-MM-DD'
    // 如果需要不同的格式，可以在这里进行转换
    return dateString;
}
// 格式化Volume，使用千位分隔符
function formatVolume(value) {
    return new Intl.NumberFormat().format(parseInt(value));
}

// 格式化Turnover Rate，转换为百分数并保留两位小数
function formatTurnoverRate(value) {
    return (parseFloat(value) * 100).toFixed(2) + '%';
}

// 辅助函数：转义 HTML 特殊字符
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function formatPercentage(value) {
    return (parseFloat(value) * 100).toFixed(2) + '%';
}

function formatPrice(value) {
    return parseFloat(value).toFixed(2);
}

function updateDealsCount(count) {
    document.getElementById('dealsCount').textContent = `${count} Stocks Found`;
}

function updateDateTime() {
    const now = new Date();
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'America/Los_Angeles'
    };
    const formattedDate = now.toLocaleString('en-US', options) + ' PST';
    document.getElementById('update-time').textContent = formattedDate;
}

function setupSortListeners() {
    console.log("Setting up sort listeners");
    document.querySelectorAll('.tags .tag').forEach(tag => {
        console.log("Adding listener to:", tag.id);
        tag.addEventListener('click', function(e) {
            e.preventDefault();
            console.log("Tag clicked:", this.id);
            const column = this.id;
            if (currentSortColumn === column) {
                isAscending = !isAscending;
            } else {
                currentSortColumn = column;
                isAscending = false;
            }
            sortStocks(column);
            updateSortIndicators(this);
        });
    });
}

function sortStocks(column) {
    console.log("Sorting by column:", column);
    const pctChangeMap = {
        'latest-trade-date': 'Date0',
        'pct-change-1': 'PCT_Change1',
        'pct-change-3': 'PCT_Change3',
        'pct-change-5': 'PCT_Change5',
        'pct-change-10': 'PCT_Change10',
        'volume': 'Volume',
        'turnover-rate': 'Turnover_Rate'
    };

    stockData.sort((a, b) => {
        let aValue = a[pctChangeMap[column]];
        let bValue = b[pctChangeMap[column]];

        if (column === 'latest-trade-date') {
            // 对于日期，我们可以直接比较字符串（假设格式是 'YYYY-MM-DD'）
            return isAscending ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
        } else if (column === 'volume') {
            aValue = parseInt(aValue);
            bValue = parseInt(bValue);
        } else {
            aValue = parseFloat(aValue);
            bValue = parseFloat(bValue);
        }

        console.log(`Comparing: ${aValue} and ${bValue}`);
        return isAscending ? aValue - bValue : bValue - aValue;
    });

    displayStockData(stockData);
}

function updateSortIndicators(clickedTag) {
    document.querySelectorAll('.tags .tag').forEach(tag => {
        tag.classList.remove('active', 'asc', 'desc');
    });
    clickedTag.classList.add('active');
    clickedTag.classList.add(isAscending ? 'asc' : 'desc');
}

// Update time every minute
setInterval(updateDateTime, 60000);