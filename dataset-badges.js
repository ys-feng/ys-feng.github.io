(() => {
    const group = document.getElementById('openaoe-badges');
    if (!group) return;

    const downloadsBadge = document.getElementById('modelscope-downloads');
    const rankBadge = document.getElementById('modelscope-rank');
    const huggingFaceBadge = document.getElementById('huggingface-downloads');
    const refreshInterval = 15 * 60 * 1000;
    const staleAfter = 3 * 24 * 60 * 60 * 1000;
    const compactNumber = new Intl.NumberFormat('en', {
        notation: 'compact', maximumFractionDigits: 2,
    });
    const compactTotal = new Intl.NumberFormat('en', {
        notation: 'compact', maximumFractionDigits: 1,
    });
    let loading = false;
    let lastAttempt = 0;
    let lastModelScope = null;
    let lastHuggingFace = null;

    function setBadge(badge, value, description, state) {
        badge.querySelector('.metric-badge-value').textContent = value;
        badge.title = description;
        badge.setAttribute('aria-label', description);
        badge.dataset.state = state;
    }

    async function loadStats(path) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(path, {
                cache: 'no-store', signal: controller.signal,
            });
            if (!response.ok) throw new Error('Statistics request failed');
            const data = await response.json();
            const updatedAt = Date.parse(data.updatedAt);
            const age = Date.now() - updatedAt;
            if (data.schemaVersion !== 1 || data.dataset !== 'inclusionAI/OpenAoE-2000h'
                || !Number.isFinite(updatedAt) || age < -5 * 60 * 1000) {
                throw new Error('Statistics are invalid');
            }
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    function freshness(data, refreshFailed) {
        const updated = new Date(data.updatedAt).toLocaleString('en', { timeZoneName: 'short' });
        const stale = Date.now() - Date.parse(data.updatedAt) > staleAfter;
        const syncStatus = stale ? 'Update delayed (over 3 days since verification).' : 'Verified snapshot.';
        const refreshStatus = refreshFailed ? ' Latest refresh unavailable; showing last verified data.' : '';
        return {
            state: stale ? 'stale' : 'ready',
            description: `Sync status: ${syncStatus}${refreshStatus} Last verified ${updated}. Scheduled to refresh daily.`,
        };
    }

    function showModelScope(data, refreshFailed = false) {
        const status = freshness(data, refreshFailed);
        setBadge(downloadsBadge, compactNumber.format(data.downloads),
            `OpenAoE-2000h: ${data.downloads.toLocaleString('en')} downloads on ModelScope. ${status.description} View dataset.`, status.state);
        setBadge(rankBadge, `#${data.rank}`,
            `OpenAoE-2000h: #${data.rank} among all ${data.totalDatasets.toLocaleString('en')} ModelScope datasets by downloads. ${status.description} View ranking.`, status.state);
    }

    function showHuggingFace(data, refreshFailed = false) {
        const status = freshness(data, refreshFailed);
        setBadge(huggingFaceBadge, compactTotal.format(data.downloadsAllTime),
            `OpenAoE-2000h: ${data.downloadsAllTime.toLocaleString('en')} all-time downloads on Hugging Face since the repository was created. ${status.description} View dataset.`, status.state);
    }

    async function refreshModelScope() {
        try {
            const data = await loadStats('data/modelscope-openaoe.json');
            if (!Number.isSafeInteger(data.downloads) || data.downloads < 0
                || !Number.isSafeInteger(data.rank) || data.rank < 1
                || !Number.isSafeInteger(data.totalDatasets) || data.totalDatasets < data.rank) {
                throw new Error('Invalid ModelScope statistics');
            }
            lastModelScope = data;
            showModelScope(data);
        } catch {
            if (lastModelScope) {
                showModelScope(lastModelScope, true);
                return;
            }
            setBadge(downloadsBadge, '—',
                'Current ModelScope download count is temporarily unavailable. View dataset for the latest count.', 'unavailable');
            setBadge(rankBadge, '—',
                'Current rank among all ModelScope datasets by downloads is temporarily unavailable. View the ranking for the latest position.', 'unavailable');
        }
    }

    async function refreshHuggingFace() {
        try {
            const data = await loadStats('data/huggingface-openaoe.json');
            if (!Number.isSafeInteger(data.downloadsAllTime) || data.downloadsAllTime < 0) {
                throw new Error('Invalid Hugging Face cumulative downloads');
            }
            lastHuggingFace = data;
            showHuggingFace(data);
        } catch {
            if (lastHuggingFace) {
                showHuggingFace(lastHuggingFace, true);
                return;
            }
            setBadge(huggingFaceBadge, '—',
                'Hugging Face cumulative download count is temporarily unavailable. View dataset.', 'unavailable');
        }
    }

    async function refresh() {
        if (loading) return;
        loading = true;
        lastAttempt = Date.now();
        group.setAttribute('aria-busy', 'true');
        try {
            await Promise.all([refreshModelScope(), refreshHuggingFace()]);
        } finally {
            loading = false;
            group.setAttribute('aria-busy', 'false');
        }
    }

    refresh();
    setInterval(() => {
        if (!document.hidden) refresh();
    }, refreshInterval);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastAttempt >= refreshInterval) refresh();
    });
})();
