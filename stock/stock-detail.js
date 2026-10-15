document.addEventListener('DOMContentLoaded', function() {
    const stockSymbol = getStockSymbolFromURL();
    if (stockSymbol) {
        document.getElementById('stockSymbol').textContent = stockSymbol;
        loadStockDetails(stockSymbol);
        loadNewsData(stockSymbol);
        setupTabSwitching();
    } else {
        displayError('No stock symbol provided');
    }
});

function getStockSymbolFromURL() {
    const q = new URLSearchParams(window.location.search).get('symbol');
    if (q) return q;
    const parts = window.location.pathname.split('/');
    const last = parts[parts.length - 1];
    return last && !last.endsWith('.html') ? last : '';
}

function loadStockDetails(symbol) {
    fetch('stock_info_lite.csv')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(data => {
            const stockData = parseCSV(data);
            const stock = stockData.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
            if (stock) {
                displayStockDetails(stock);
            } else {
                displayError('Stock not found');
            }
        })
        .catch(error => {
            console.error('Error loading stock data:', error);
            displayError('Failed to load stock data: ' + error.message);
        });
}

function parseCSV(csv) {
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(header => header.trim());
    return lines.slice(1).map(line => {
        const values = [];
        let insideQuotes = false;
        let currentValue = '';
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
        values.push(currentValue.trim());
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || '';
            return obj;
        }, {});
    }).filter(obj => Object.values(obj).some(val => val !== ''));
}

function displayStockDetails(stock) {
    document.getElementById('stockName').textContent = stock.shortName;
    document.getElementById('businessSummary').textContent = stock.longBusinessSummary;
    document.title = `${stock.symbol} - Stock Details`;

    const infoContainer = document.getElementById('stockInfo');
    infoContainer.innerHTML = `
        <p><strong>Industry:</strong> ${stock.industry}</p>
        <p><strong>Sector:</strong> ${stock.sector}</p>
        <p><strong>Country:</strong> ${stock.country}</p>
        <p><strong>State:</strong> ${stock.state}</p>
        <p><strong>City:</strong> ${stock.city}</p>
        <p><strong>Website:</strong> <a href="${stock.website}" target="_blank">${stock.website}</a></p>
    `;
}

function displayError(message) {
    document.getElementById('stockName').textContent = 'Error';
    document.getElementById('businessSummary').textContent = message;
    document.getElementById('stockInfo').innerHTML = '';
}

function loadNewsData(symbol) {
    fetch(`news/${symbol}.csv`)
        .then(response => response.text())
        .then(data => {
            const newsData = parseCSV(data);
            displayNewsTable(newsData);
        })
        .catch(error => {
            console.error('Error loading news data:', error);
            document.getElementById('news-table-body').innerHTML = '<tr><td colspan="5">Failed to load news data</td></tr>';
        });
}

function displayNewsTable(newsData) {
    const tableBody = document.getElementById('news-table-body');
    tableBody.innerHTML = '';

    newsData.forEach(news => {
        if (isValidDateFormat(news.published_at)) {
            const row = tableBody.insertRow();
            row.innerHTML = `
                <td>${news.published_at}</td>
                <td>${news.source}</td>
                <td>${news.title}</td>
                <td>${news.summary}</td>
                <td><a href="${news.link}" target="_blank">Link</a></td>
            `;
        }
    });
}

function isValidDateFormat(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    return regex.test(dateString);
}

function setupTabSwitching() {
    const newsTab = document.getElementById('news-tab');
    const chartTab = document.getElementById('chart-tab');
    const newsContent = document.getElementById('news-content');
    const chartContent = document.getElementById('chart-content');

    newsTab.addEventListener('click', function(e) {
        e.preventDefault();
        newsTab.classList.add('active');
        chartTab.classList.remove('active');
        newsContent.style.display = 'block';
        chartContent.style.display = 'none';
    });

    chartTab.addEventListener('click', function(e) {
        e.preventDefault();
        chartTab.classList.add('active');
        newsTab.classList.remove('active');
        chartContent.style.display = 'block';
        newsContent.style.display = 'none';
    });
}