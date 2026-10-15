const pages = [
    { id: "latest-trade-date", title: "Latest Trade Date", url: "index.html", source: "top_100_stocks.csv" },
    { id: "pct-change-1", title: "PCT Change (1 day)", url: "index.html", source: "top_100_stocks.csv" },
    { id: "pct-change-3", title: "PCT Change (3 days)", url: "index.html", source: "top_100_stocks.csv" },
    { id: "pct-change-5", title: "PCT Change (5 days)", url: "index.html", source: "top_100_stocks.csv" },
    { id: "pct-change-10", title: "PCT Change (10 days)", url: "index.html", source: "top_100_stocks.csv" },
    { id: "volume", title: "Volume", url: "index.html", source: "top_100_stocks.csv" },
    { id: "turnover-rate", title: "Turnover Rate", url: "index.html", source: "top_100_stocks.csv" }
];

function generateNavigation(currentPageId) {
    console.log("Generating navigation with currentPageId:", currentPageId);
    const navContainer = document.querySelector('.tags');
    let navHtml = '';
    pages.forEach(page => {
        const isActive = currentPageId === page.id;
        navHtml += `<a href="#" class="tag${isActive ? ' active' : ''}" id="${page.id}" data-csv="${page.source}">${page.title}</a>`;
    });
    navContainer.innerHTML = navHtml;
    console.log("Navigation HTML generated:", navHtml);

    // 触发自定义事件，通知导航已生成
    document.dispatchEvent(new Event('navigationGenerated'));
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired");
    const currentPageId = "pct-change-1"; // 默认为第一个选项
    generateNavigation(currentPageId);
});

function loadFilters() {
    fetch('filters.html')
        .then(response => response.text())
        .then(html => {
            document.getElementById('filters-container').innerHTML = html;
            // 动态加载后可能需要重新绑定事件或执行某些初始化逻辑
            listenForCheckboxChanges();
            listenForPriceChange();
            // 加载当前页面的CSV数据
            loadCurrentPageData();
        })
        .catch(error => {
            console.error('Error loading the filters:', error);
        });
}

function loadCurrentPageData() {
    const currentPageId = document.body.id; // 从body的id获取当前页面的ID
    const currentPage = pages.find(page => page.id === currentPageId);
    if (currentPage) {
        loadTableData(currentPage.source);
    }
}

// 确保document加载后执行
document.addEventListener('DOMContentLoaded', () => {
    const currentPageId = "pct-change-1"; // 默认为第一个选项
    generateNavigation(currentPageId);
    // 触发一个自定义事件，表示导航已生成
    document.dispatchEvent(new Event('navigationGenerated'));
});
