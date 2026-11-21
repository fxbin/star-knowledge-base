/**
 * Star Knowledge Base 前端逻辑
 *
 * 设计原则:
 *   - Vanilla JS，零依赖，零构建步骤
 *   - 客户端全量过滤、中英文相关度排序与 URL 状态同步
 *   - stale-while-revalidate 本地缓存秒开 + no-cache 后台拉新
 *   - 高密度表格主视图 + 语义缩放星图，所有交互走安全转义与事件委托
 *
 * author: fxbin
 */

// ========== 常量定义（禁止魔法值） ==========

const DATA_URL = './data.json';
const PAGE_SIZE = 50;
const MIN_QUERY_LENGTH = 1;
const PAGINATION_COMPACT_THRESHOLD = 7;

const HIGH_SCORE_THRESHOLD = 4;
const LOW_SCORE_THRESHOLD = 2;
const SCORE_DOT_COUNT = 5;

const DATA_CACHE_KEY = 'skb_data_v1';
const VISIT_SNAPSHOT_KEY = 'skb_visit_snapshot_v2';
const USER_NOTES_KEY = 'skb_user_notes_v1';
const NO_LANGUAGE_VALUE = '__none__';

const SKELETON_ROW_COUNT = 8;
const SKELETON_STAGGER_MS = 40;

const FLIP_DURATION_MS = 200;
const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const TOPIC_FACET_MAX = 12;
const TOPIC_TAG_PER_ROW = 3;
const TOPIC_FACET_PER_ENTRY = 3;
const PALETTE_RESULT_MAX = 8;

const DEFAULT_SORT_FIELD = 'starred_at';
const DEFAULT_SORT_ORDER = 'desc';
const DEFAULT_OWNER = 'fxbin';

const LANGUAGE_COLORS = {
    Python: '#3776ab',
    JavaScript: '#f7df1e',
    TypeScript: '#3178c6',
    Go: '#00add8',
    Java: '#ed8b00',
    Rust: '#dea584',
    C: '#555555',
    'C++': '#f34b7d',
    'C#': '#178600',
    Shell: '#89e051',
    HTML: '#e34c26',
    CSS: '#563d7c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Dart: '#00b4ab',
    Swift: '#f05138',
    Kotlin: '#a97bff',
    Scala: '#c22d40',
    Ruby: '#701516',
    PHP: '#4f5d95',
    Lua: '#000080',
    'Jupyter Notebook': '#da5b0b',
    Dockerfile: '#384d54',
    HCL: '#844fba',
    SQL: '#e38c00',
    R: '#198ce7',
    Zig: '#ec915c',
    Elixir: '#6e4a7e',
    无语言: '#a8a29e',
    其他语言: '#a8a29e',
    Other: '#a8a29e',
};
const DEFAULT_LANGUAGE_COLOR = '#a8a29e';

const SORT_ARROW_ASC = '<svg class="sort-arrow" width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M4 1.5l3 4.5H1z"/></svg>';
const SORT_ARROW_DESC = '<svg class="sort-arrow" width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M4 6.5L1 2h6z"/></svg>';

const STAR_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.7 7.7 8.1.1-6.5 4.8 2.4 7.7L12 18.3 5.3 22.8l2.4-7.7-6.5-4.8 8.1-.1z"/></svg>';
const PIN_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-label="已置顶"><path d="M16 3l5 5-2 2-1.5-.5-3.5 3.5 1 4-2 2-3.5-3.5-4.5 4.5-1-1 4.5-4.5L5 11l2-2 4 1 3.5-3.5L14 5l2-2z"/></svg>';
const CHEVRON_SVG = '<svg class="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
const CODE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';

const AI_SUMMARY_SYSTEM_PROMPT = '你是代码库摘要助手。用一句话（不超过 60 字）概括项目的核心功能和适用场景，语气客观、不夸大。';

const ZOOM_MIN_SCALE = 0.3;
const ZOOM_MAX_SCALE = 5;
const ZOOM_WHEEL_FACTOR = 0.0015;
const ZOOM_CLUSTER_RADIUS_BASE = 56;
const ZOOM_CLUSTER_MAX = 12;
const ZOOM_NODE_RADIUS = 4;
const ZOOM_NODE_RADIUS_HOVER = 7;
const ZOOM_CLUSTER_LABEL_MAX_SCALE = 1.6;
const ZOOM_TOP_NODE_LABEL_SCALE = 1.2;
const ZOOM_ALL_LABEL_SCALE = 2.2;
const ZOOM_DRAG_THRESHOLD_PX = 4;

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

const CJK_GLUE_REGEX = /[的了和与或及在是有为]+/g;
const CJK_STOPWORDS = new Set([
    '一个', '一些', '用于', '用来', '可以', '能够', '如何', '怎么',
    '什么', '哪些', '推荐', '帮我', '寻找', '查找', '需要', '支持',
    '实现', '关于', '相关', '项目', '仓库', '代码', '那个', '这个',
]);

// ========== 纯工具函数（可供浏览器与 Node 单测直接复用） ==========

/**
 * 显式转义 5 个 HTML 关键字符，避免属性与文本节点 XSS
 * @param {unknown} text
 * @returns {string}
 */
function escapeHtml(text) {
    if (text == null) return '';
    return String(text).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
}

/**
 * 校验外部链接仅允许 http/https 协议
 * @param {unknown} raw
 * @returns {string}
 */
function safeExternalUrl(raw) {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return trimmed;
        }
    } catch {
        return '';
    }
    return '';
}

/**
 * 将中英文混合查询拆分为检索词元
 * @param {string} query
 * @returns {Array<string>}
 */
function tokenizeSearchQuery(query) {
    if (!query || typeof query !== 'string') return [];
    const lowered = query.trim().toLowerCase();
    if (!lowered) return [];

    const tokens = [];
    const seen = new Set();
    const add = tok => {
        const cleaned = tok.replace(/^\.+|\.+$/g, '');
        if (!cleaned || seen.has(cleaned)) return;
        seen.add(cleaned);
        tokens.push(cleaned);
    };

    const asciiMatches = lowered.match(/[a-z0-9][a-z0-9_+#.-]*/g) || [];
    for (const tok of asciiMatches) {
        add(tok);
        if (tok.includes('-') || tok.includes('/')) {
            for (const part of tok.split(/[-/]+/)) {
                if (part.length >= 2) add(part);
            }
        }
    }

    const cjkRuns = lowered.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of cjkRuns) {
        const segments = run.split(CJK_GLUE_REGEX).filter(Boolean);
        for (const seg of segments) {
            if (seg.length <= 2) {
                if (!CJK_STOPWORDS.has(seg)) add(seg);
            } else {
                if (seg.length <= 8 && !CJK_STOPWORDS.has(seg)) add(seg);
                for (let i = 0; i < seg.length - 1; i++) {
                    const bigram = seg.slice(i, i + 2);
                    if (!CJK_STOPWORDS.has(bigram)) add(bigram);
                }
            }
        }
    }

    return tokens;
}

/**
 * 判断单个条目是否满足空格分隔词及中文片段匹配规则
 * @param {Object} entry
 * @param {string} query
 * @returns {boolean}
 */
function matchesSearchQuery(entry, query) {
    const trimmed = (query || '').trim().toLowerCase();
    if (!trimmed) return true;

    const haystack = [
        entry.full_name || '',
        entry.description || '',
        entry.summary || '',
        entry.language || '',
        entry.category || '',
        entry.note || '',
        (entry.topics || []).join(' '),
        (entry.use_cases || []).join(' '),
    ].join(' ').toLowerCase();

    const words = trimmed.split(/\s+/).filter(Boolean);
    return words.every(word => {
        if (/^[\u4e00-\u9fff]+$/.test(word) || /[\u4e00-\u9fff]/.test(word)) {
            if (haystack.includes(word)) return true;
            const segTokens = tokenizeSearchQuery(word);
            if (segTokens.length === 0) return true;
            // 对于无空格中文短语，所有非虚词双字片断有半数以上命中（或纯 ASCII 子词全部命中）即可匹配
            const asciiSubs = word.match(/[a-z0-9][a-z0-9_+#.-]*/g) || [];
            if (!asciiSubs.every(sub => haystack.includes(sub))) return false;
            const cjkSubs = segTokens.filter(t => /[\u4e00-\u9fff]/.test(t));
            if (cjkSubs.length === 0) return true;
            const hits = cjkSubs.filter(t => haystack.includes(t)).length;
            return hits >= Math.max(1, Math.ceil(cjkSubs.length * 0.5));
        }
        return haystack.includes(word);
    });
}

/**
 * 计算条目与查询的相关度得分（用于搜索默认排序）
 * @param {Object} entry
 * @param {Array<string>} tokens
 * @param {string} rawQuery
 * @returns {number}
 */
function scoreEntryMatch(entry, tokens, rawQuery) {
    const name = (entry.full_name || '').toLowerCase();
    const desc = (entry.description || '').toLowerCase();
    const summary = (entry.summary || '').toLowerCase();
    const lang = (entry.language || '').toLowerCase();
    const cat = (entry.category || '').toLowerCase();
    const note = (entry.note || '').toLowerCase();
    const topics = (entry.topics || []).join(' ').toLowerCase();
    const useCases = (entry.use_cases || []).join(' ').toLowerCase();

    let score = 0;
    let distinctHits = 0;
    for (const token of tokens) {
        let hit = false;
        if (name.includes(token)) {
            score += 4;
            hit = true;
        }
        if (topics.includes(token) || useCases.includes(token) || cat.includes(token)) {
            score += 3;
            hit = true;
        }
        if (summary.includes(token) || note.includes(token)) {
            score += 2;
            hit = true;
        }
        if (desc.includes(token) || lang.includes(token)) {
            score += 1;
            hit = true;
        }
        if (hit) distinctHits++;
    }

    score += distinctHits * 3;
    const raw = (rawQuery || '').trim().toLowerCase();
    if (raw.length >= 2) {
        if (name.includes(raw)) score += 6;
        else if (summary.includes(raw) || desc.includes(raw)) score += 4;
    }
    if (entry.pinned) score += 1;
    return score;
}

/**
 * 安全高亮匹配关键词（先切分原文再分别 escapeHtml，防止注入 HTML）
 * @param {string} text
 * @param {Array<string>} tokens
 * @returns {string}
 */
function highlightText(text, tokens) {
    const str = text == null ? '' : String(text);
    if (!str || !tokens || tokens.length === 0) {
        return escapeHtml(str);
    }

    const candidates = Array.from(
        new Set(tokens.map(t => String(t).trim()).filter(t => t.length >= 2 || /^[a-z0-9]$/i.test(t)))
    ).sort((a, b) => b.length - a.length);

    if (candidates.length === 0) return escapeHtml(str);

    const escapedRegex = candidates.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(${escapedRegex})`, 'gi');

    let out = '';
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
        if (match.index > lastIndex) {
            out += escapeHtml(str.slice(lastIndex, match.index));
        }
        out += `<mark class="search-hl">${escapeHtml(match[0])}</mark>`;
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < str.length) {
        out += escapeHtml(str.slice(lastIndex));
    }
    return out;
}

/**
 * 合并原始条目与本地个人备注/置顶状态
 * @param {Object} entry
 * @param {Object} userNotesMap
 * @returns {Object}
 */
function mergeEntryWithNote(entry, userNotesMap) {
    const override = userNotesMap && userNotesMap[entry.full_name];
    if (!override) return entry;
    const hasPinned = Object.prototype.hasOwnProperty.call(override, 'pinned');
    const hasNote = Object.prototype.hasOwnProperty.call(override, 'note');
    return {
        ...entry,
        pinned: hasPinned ? Boolean(override.pinned) : Boolean(entry.pinned),
        note: hasNote ? String(override.note || '') : String(entry.note || ''),
    };
}

/**
 * 计算当前数据与基线快照的增量变化（不截断数量，杜绝误报新增）
 * @param {Array<Object>} currentEntries
 * @param {Object|null} baselineSnapshot
 * @returns {Object|null}
 */
function computeWhatsNew(currentEntries, baselineSnapshot) {
    if (!baselineSnapshot || !baselineSnapshot.stars || typeof baselineSnapshot.stars !== 'object') {
        return null;
    }
    const oldStarsMap = baselineSnapshot.stars;
    const newProjects = [];
    const starsGrew = [];

    for (const entry of currentEntries) {
        const key = entry.full_name;
        if (!Object.prototype.hasOwnProperty.call(oldStarsMap, key)) {
            newProjects.push(entry);
        } else {
            const oldStars = Number(oldStarsMap[key]) || 0;
            const currStars = Number(entry.stargazers_count) || 0;
            if (currStars > oldStars) {
                starsGrew.push({
                    name: key,
                    delta: currStars - oldStars,
                    current: currStars,
                });
            }
        }
    }

    return {
        newProjects,
        starsGrew,
        lastVisit: baselineSnapshot.timestamp,
    };
}

/**
 * 计算语义缩放滚轮放大缩小时保持光标处世界坐标不变的新偏移量
 * @param {{x: number, y: number}} pos
 * @param {{width: number, height: number}} size
 * @param {number} oldScale
 * @param {number} newScale
 * @param {{x: number, y: number}} oldOffset
 * @returns {{x: number, y: number}}
 */
function computeWheelZoomOffset(pos, size, oldScale, newScale, oldOffset) {
    const scaleRatio = newScale / oldScale;
    const dx = pos.x - size.width / 2;
    const dy = pos.y - size.height / 2;
    return {
        x: dx - (dx - oldOffset.x) * scaleRatio,
        y: dy - (dy - oldOffset.y) * scaleRatio,
    };
}

/**
 * 解析 URL 查询参数
 * @param {string} searchStr
 * @returns {Object}
 */
function parseUrlParams(searchStr) {
    const params = new URLSearchParams(searchStr || '');
    const q = params.get('q') || '';
    const explicitSort = params.get('sort');
    const sort = explicitSort || (q.trim() ? 'relevance' : DEFAULT_SORT_FIELD);
    const order = params.get('order') || (sort === 'full_name' ? 'asc' : DEFAULT_SORT_ORDER);
    return {
        q,
        lang: params.get('lang') || '',
        cat: params.get('cat') || '',
        topic: params.get('topic') || '',
        sort,
        order: order === 'asc' ? 'asc' : 'desc',
        view: params.get('view') === 'zoom' ? 'zoom' : 'table',
        hideArchived: params.get('hideArchived') === '1',
        pinned: params.get('pinned') === '1',
    };
}

/**
 * 序列化当前筛选与视图状态为 URL 查询字符串（默认值自动省略）
 * @param {Object} s
 * @returns {string}
 */
function serializeUrlParams(s) {
    const params = new URLSearchParams();
    if (s.q) params.set('q', s.q);
    if (s.lang) params.set('lang', s.lang);
    if (s.cat) params.set('cat', s.cat);
    if (s.topic) params.set('topic', s.topic);
    if (s.sort && s.sort !== DEFAULT_SORT_FIELD) params.set('sort', s.sort);
    if (s.order && s.order !== DEFAULT_SORT_ORDER && (s.sort !== 'full_name' || s.order !== 'asc')) {
        params.set('order', s.order);
    } else if (s.sort === 'full_name' && s.order === 'desc') {
        params.set('order', 'desc');
    }
    if (s.view === 'zoom') params.set('view', 'zoom');
    if (s.hideArchived) params.set('hideArchived', '1');
    if (s.pinned) params.set('pinned', '1');
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

// ========== 全局状态与 DOM（仅浏览器环境初始化） ==========

const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

const state = {
    allEntries: [],
    rawEntries: [],
    filteredEntries: [],
    currentPage: 1,
    languages: new Set(),
    languageCounts: new Map(),
    categoryCounts: new Map(),
    noLanguageCount: 0,
    archivedCount: 0,
    pinnedCount: 0,
    selectedLanguage: '',
    selectedCategory: '',
    activeTopic: '',
    hideArchived: false,
    pinnedOnly: false,
    specialFilter: '', // '' | 'new' | 'grew'
    specialFilterNames: new Set(),
    whatsNewChanges: null,
    expandedKey: '',
    selectedIndex: -1,
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
    manualSortDuringQuery: false,
    preSearchSort: null,
    paletteOpen: false,
    paletteIndex: 0,
    paletteItems: [],
    viewMode: 'table',
    desiredViewMode: 'table',
    username: DEFAULT_OWNER,
    userNotes: {},
    aiAvailability: null,
    voiceRecognition: null,
    voiceListening: false,
    zoomScale: 1,
    zoomOffsetX: 0,
    zoomOffsetY: 0,
    zoomNodes: [],
    zoomClusters: [],
    zoomHoveredNode: null,
    zoomPointerDown: false,
    zoomDragMoved: false,
    zoomDownX: 0,
    zoomDownY: 0,
    zoomLastMouseX: 0,
    zoomLastMouseY: 0,
};

let dom = {};

function collectDom() {
    dom = {
        searchInput: document.getElementById('searchInput'),
        resetButton: document.getElementById('resetButton'),
        languageFilter: document.getElementById('languageFilter'),
        categoryFilterGroup: document.getElementById('categoryFilterGroup'),
        categoryFilter: document.getElementById('categoryFilter'),
        sortSelect: document.getElementById('sortSelect'),
        hideArchivedBtn: document.getElementById('hideArchivedBtn'),
        pinnedOnlyBtn: document.getElementById('pinnedOnlyBtn'),
        bannerFilterPill: document.getElementById('bannerFilterPill'),
        bannerFilterText: document.getElementById('bannerFilterText'),
        bannerFilterClear: document.getElementById('bannerFilterClear'),
        statsCount: document.getElementById('statsCount'),
        pageInfo: document.getElementById('pageInfo'),
        facetNav: document.getElementById('facetNav'),
        tableWrap: document.getElementById('tableWrap'),
        results: document.getElementById('results'),
        status: document.getElementById('status'),
        pagination: document.getElementById('pagination'),
        totalCount: document.getElementById('totalCount'),
        langCount: document.getElementById('langCount'),
        updateTime: document.getElementById('updateTime'),
        repoLink: document.getElementById('repoLink'),
        footerAuthorLink: document.getElementById('footerAuthorLink'),
        accessButton: document.getElementById('accessButton'),
        accessModal: document.getElementById('accessModal'),
        modalClose: document.getElementById('modalClose'),
        mcpConfigPre: document.getElementById('mcp-config'),
        skillCmdPre: document.getElementById('skill-cmd'),
        paletteOverlay: document.getElementById('paletteOverlay'),
        paletteInput: document.getElementById('paletteInput'),
        paletteList: document.getElementById('paletteList'),
        notesImportInput: document.getElementById('notesImportInput'),
        voiceBtn: document.getElementById('voiceBtn'),
        whatsNew: document.getElementById('whatsNew'),
        whatsNewBody: document.getElementById('whatsNewBody'),
        whatsNewDismiss: document.getElementById('whatsNewDismiss'),
        viewTableBtn: document.getElementById('viewTableBtn'),
        viewZoomBtn: document.getElementById('viewZoomBtn'),
        zoomContainer: document.getElementById('zoomContainer'),
        zoomCanvas: document.getElementById('zoomCanvas'),
        zoomEmpty: document.getElementById('zoomEmpty'),
        zoomTooltip: document.getElementById('zoomTooltip'),
        zoomInBtn: document.getElementById('zoomInBtn'),
        zoomOutBtn: document.getElementById('zoomOutBtn'),
        zoomResetBtn: document.getElementById('zoomResetBtn'),
    };
}

// ========== 数据加载、缓存与个人备注 ==========

function showStatus(message, isError = false) {
    dom.status.textContent = message;
    dom.status.className = isError ? 'status error' : 'status';
    dom.status.style.display = message ? 'block' : 'none';
}

function readDataCache() {
    try {
        const raw = localStorage.getItem(DATA_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        return cache && cache.data ? cache : null;
    } catch {
        return null;
    }
}

function writeDataCache(data) {
    try {
        localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
    } catch {
        // localStorage 满或禁用，静默忽略
    }
}

function readVisitSnapshot() {
    try {
        const raw = localStorage.getItem(VISIT_SNAPSHOT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.stars) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveVisitSnapshot(entries) {
    try {
        const stars = {};
        for (const entry of entries) {
            if (entry && entry.full_name) {
                stars[entry.full_name] = entry.stargazers_count || 0;
            }
        }
        localStorage.setItem(
            VISIT_SNAPSHOT_KEY,
            JSON.stringify({ stars, timestamp: Date.now() })
        );
    } catch {
        // localStorage 满或禁用，静默忽略
    }
}

function readUserNotes() {
    try {
        const raw = localStorage.getItem(USER_NOTES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeUserNotes(notes) {
    try {
        localStorage.setItem(USER_NOTES_KEY, JSON.stringify(notes));
    } catch {
        // 静默忽略
    }
}

async function loadData() {
    const baselineSnapshot = readVisitSnapshot();
    const cached = readDataCache();

    if (cached) {
        applyData(cached.data, { baselineSnapshot: null, persistSnapshot: false });
        showStatus('');
    } else {
        showSkeleton();
    }

    try {
        const response = await fetch(DATA_URL, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const freshData = await response.json();
        writeDataCache(freshData);
        applyData(freshData, { baselineSnapshot, persistSnapshot: true });
        showStatus('');
    } catch (error) {
        if (!cached) {
            showStatus('数据加载失败：' + error.message + '。请确认 GitHub Actions 已运行并部署到 Pages。', true);
            state.allEntries = [];
            dom.statsCount.textContent = '0';
            dom.results.innerHTML = '';
        }
    }
}

function rebuildEntriesWithNotes() {
    state.allEntries = state.rawEntries.map(e => mergeEntryWithNote(e, state.userNotes));
    recomputeDatasetStats();
    populateLanguageFilter();
    populateCategoryFilter();
    updateToggleButtons();
    renderFacets();
}

function recomputeDatasetStats() {
    const langCounts = new Map();
    const catCounts = new Map();
    let noLang = 0;
    let archived = 0;
    let pinned = 0;

    for (const entry of state.allEntries) {
        if (entry.language) {
            langCounts.set(entry.language, (langCounts.get(entry.language) || 0) + 1);
        } else {
            noLang++;
        }
        if (entry.category) {
            catCounts.set(entry.category, (catCounts.get(entry.category) || 0) + 1);
        }
        if (entry.archived) archived++;
        if (entry.pinned) pinned++;
    }

    state.languages = new Set(Array.from(langCounts.keys()).sort());
    state.languageCounts = langCounts;
    state.categoryCounts = catCounts;
    state.noLanguageCount = noLang;
    state.archivedCount = archived;
    state.pinnedCount = pinned;
}

function applyData(data, options = {}) {
    state.rawEntries = data.entries || [];
    if (data.username && typeof data.username === 'string' && data.username.trim()) {
        state.username = data.username.trim();
        updateOwnerLinks();
    }
    rebuildEntriesWithNotes();
    updateHeaderStats(data);
    updateAccessModalSnippets();

    if (options.baselineSnapshot) {
        const changes = computeWhatsNew(state.rawEntries, options.baselineSnapshot);
        if (changes && (changes.newProjects.length > 0 || changes.starsGrew.length > 0)) {
            state.whatsNewChanges = changes;
            renderWhatsNew(changes);
        }
    }
    if (options.persistSnapshot) {
        saveVisitSnapshot(state.rawEntries);
    }

    applyFilters({ flip: false, syncUrl: false });

    if (state.desiredViewMode === 'zoom' && state.viewMode !== 'zoom') {
        state.desiredViewMode = 'table';
        switchView('zoom', { syncUrl: false });
    }
}

function updateOwnerLinks() {
    const owner = state.username || DEFAULT_OWNER;
    if (dom.repoLink) {
        dom.repoLink.href = `https://github.com/${encodeURIComponent(owner)}/star-knowledge-base`;
    }
    if (dom.footerAuthorLink) {
        dom.footerAuthorLink.href = `https://github.com/${encodeURIComponent(owner)}`;
        dom.footerAuthorLink.textContent = owner;
    }
}

function updateAccessModalSnippets() {
    const owner = state.username || DEFAULT_OWNER;
    const dataJsonUrl = new URL(DATA_URL, window.location.href).href;
    if (dom.mcpConfigPre) {
        dom.mcpConfigPre.textContent = JSON.stringify(
            {
                mcpServers: {
                    'star-knowledge': {
                        command: 'python',
                        args: ['/path/to/star-knowledge-base/src/mcp_server.py'],
                        env: {
                            STAR_DATA_URL: dataJsonUrl,
                        },
                    },
                },
            },
            null,
            2
        );
    }
    if (dom.skillCmdPre) {
        dom.skillCmdPre.textContent = `npx skills add ${owner}/star-knowledge-base --skill star-first-habit`;
    }
}

function showSkeleton() {
    const rows = [];
    for (let i = 0; i < SKELETON_ROW_COUNT; i++) {
        rows.push(
            `<tr class="skeleton-row">` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block name"></div></td>` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block lang"></div></td>` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block stars"></div></td>` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block score"></div></td>` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block topics"></div></td>` +
                `<td style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"></td>` +
            `</tr>`
        );
    }
    dom.results.innerHTML = rows.join('');
    dom.pagination.style.display = 'none';
    dom.statsCount.textContent = '…';
}

function updateHeaderStats(data) {
    dom.totalCount.textContent = data.total || state.allEntries.length;
    dom.langCount.textContent = state.languages.size;
    if (data.generated_at) {
        const date = new Date(data.generated_at);
        dom.updateTime.textContent = date.toLocaleDateString('zh-CN');
    }
}

function populateLanguageFilter() {
    const desired = state.selectedLanguage;
    dom.languageFilter.innerHTML = '<option value="">全部</option>';

    const sortedLangs = Array.from(state.languageCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [lang, count] of sortedLangs) {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = `${lang} (${count})`;
        dom.languageFilter.appendChild(option);
    }

    if (state.noLanguageCount > 0) {
        const noneOpt = document.createElement('option');
        noneOpt.value = NO_LANGUAGE_VALUE;
        noneOpt.textContent = `无语言 / 文档 (${state.noLanguageCount})`;
        dom.languageFilter.appendChild(noneOpt);
    }

    if (desired && Array.from(dom.languageFilter.options).some(o => o.value === desired)) {
        dom.languageFilter.value = desired;
    } else {
        dom.languageFilter.value = '';
    }
}

function populateCategoryFilter() {
    if (state.categoryCounts.size === 0) {
        dom.categoryFilterGroup.style.display = 'none';
        return;
    }
    dom.categoryFilterGroup.style.display = 'flex';
    const desired = state.selectedCategory;
    dom.categoryFilter.innerHTML = '<option value="">全部</option>';

    const sortedCats = Array.from(state.categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCats) {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = `${cat} (${count})`;
        dom.categoryFilter.appendChild(option);
    }

    if (desired && Array.from(dom.categoryFilter.options).some(o => o.value === desired)) {
        dom.categoryFilter.value = desired;
    } else {
        dom.categoryFilter.value = '';
    }
}

function updateToggleButtons() {
    dom.hideArchivedBtn.style.display = state.archivedCount > 0 ? '' : 'none';
    dom.hideArchivedBtn.classList.toggle('active', state.hideArchived);
    dom.hideArchivedBtn.setAttribute('aria-pressed', String(state.hideArchived));

    dom.pinnedOnlyBtn.style.display = state.pinnedCount > 0 ? '' : 'none';
    dom.pinnedOnlyBtn.classList.toggle('active', state.pinnedOnly);
    dom.pinnedOnlyBtn.setAttribute('aria-pressed', String(state.pinnedOnly));
}

function syncSortSelect() {
    const val = `${state.sortField}:${state.sortOrder}`;
    if (Array.from(dom.sortSelect.options).some(o => o.value === val)) {
        dom.sortSelect.value = val;
    }
}

function computeFacets() {
    const topicMap = new Map();
    for (const entry of state.allEntries) {
        const topics = (entry.topics || []).slice(0, TOPIC_FACET_PER_ENTRY);
        for (const topic of topics) {
            if (!topicMap.has(topic)) {
                topicMap.set(topic, { name: topic, count: 0, highCount: 0 });
            }
            const facet = topicMap.get(topic);
            facet.count++;
            if ((entry.quality_score || 0) >= HIGH_SCORE_THRESHOLD) {
                facet.highCount++;
            }
        }
    }
    return Array.from(topicMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, TOPIC_FACET_MAX);
}

function renderFacets() {
    const facets = computeFacets();
    const maxCount = facets.length > 0 ? facets[0].count : 1;

    const chips = [];
    chips.push(
        `<button type="button" class="facet-chip${state.activeTopic === '' ? ' active' : ''}" data-topic="">` +
            `<span class="facet-chip-top">` +
                `<span class="facet-chip-name">全部</span>` +
                `<span class="facet-chip-count">${state.allEntries.length}</span>` +
            `</span>` +
        `</button>`
    );

    for (const facet of facets) {
        const countPct = Math.round((facet.count / maxCount) * 100);
        const highPct = facet.count > 0 ? Math.round((facet.highCount / facet.count) * 100) : 0;
        chips.push(
            `<button type="button" class="facet-chip${state.activeTopic === facet.name ? ' active' : ''}" data-topic="${escapeHtml(facet.name)}">` +
                `<span class="facet-chip-top">` +
                    `<span class="facet-chip-name">${escapeHtml(facet.name)}</span>` +
                    `<span class="facet-chip-count">${facet.count}</span>` +
                `</span>` +
                `<span class="facet-bar">` +
                    `<span class="facet-bar-count" style="width: ${countPct}%">` +
                        `<span class="facet-bar-high" style="width: ${highPct}%"></span>` +
                    `</span>` +
                `</span>` +
            `</button>`
        );
    }

    dom.facetNav.innerHTML = chips.join('');
}

// ========== 过滤、排序与 URL 同步 ==========

function syncStateToUrl() {
    if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
    const qs = serializeUrlParams({
        q: dom.searchInput.value.trim(),
        lang: state.selectedLanguage,
        cat: state.selectedCategory,
        topic: state.activeTopic,
        sort: state.sortField,
        order: state.sortOrder,
        view: state.viewMode,
        hideArchived: state.hideArchived,
        pinned: state.pinnedOnly,
    });
    const newUrl = window.location.pathname + qs + window.location.hash;
    window.history.replaceState(null, '', newUrl);
}

function applyFilters(options = { flip: true, syncUrl: true }) {
    const query = dom.searchInput.value.trim();
    const language = state.selectedLanguage;
    const category = state.selectedCategory;

    let filtered = state.allEntries.slice();

    if (state.specialFilter && state.specialFilterNames.size > 0) {
        filtered = filtered.filter(entry => state.specialFilterNames.has(entry.full_name));
    }

    if (state.activeTopic) {
        filtered = filtered.filter(entry => (entry.topics || []).includes(state.activeTopic));
    }

    if (language) {
        if (language === NO_LANGUAGE_VALUE) {
            filtered = filtered.filter(entry => !entry.language);
        } else {
            filtered = filtered.filter(entry => entry.language === language);
        }
    }

    if (category) {
        filtered = filtered.filter(entry => entry.category === category);
    }

    if (state.hideArchived) {
        filtered = filtered.filter(entry => !entry.archived);
    }

    if (state.pinnedOnly) {
        filtered = filtered.filter(entry => Boolean(entry.pinned));
    }

    const queryTokens = query.length >= MIN_QUERY_LENGTH ? tokenizeSearchQuery(query) : [];
    if (query.length >= MIN_QUERY_LENGTH) {
        filtered = filtered.filter(entry => matchesSearchQuery(entry, query));
    }

    const useRelevanceSort =
        query.length >= MIN_QUERY_LENGTH &&
        (state.sortField === 'relevance' || !state.manualSortDuringQuery);

    if (useRelevanceSort && queryTokens.length > 0) {
        const scores = new Map();
        for (const entry of filtered) {
            scores.set(entry.full_name, scoreEntryMatch(entry, queryTokens, query));
        }
        filtered.sort((a, b) => {
            const diff = (scores.get(b.full_name) || 0) - (scores.get(a.full_name) || 0);
            if (diff !== 0) return diff;
            return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        });
    } else {
        const sortField = state.sortField === 'relevance' ? DEFAULT_SORT_FIELD : state.sortField;
        const sortOrder = state.sortOrder;
        filtered.sort((a, b) => {
            if (state.sortField === DEFAULT_SORT_FIELD && !query) {
                const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
                if (pinDiff !== 0) return pinDiff;
            }
            let valueA = a[sortField];
            let valueB = b[sortField];
            if (valueA == null) return 1;
            if (valueB == null) return -1;
            if (typeof valueA === 'string') {
                valueA = valueA.toLowerCase();
                valueB = valueB.toLowerCase();
            }
            if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1;
            if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    state.filteredEntries = filtered;
    state.currentPage = 1;
    state.selectedIndex = -1;
    state.expandedKey = '';
    syncSortSelect();

    if (options.syncUrl !== false) {
        syncStateToUrl();
    }

    if (state.viewMode === 'zoom') {
        dom.statsCount.textContent = filtered.length;
        dom.pageInfo.textContent = '';
        initZoomCanvas();
    } else {
        renderResults({ flip: options.flip !== false });
    }
}

function renderResults(options = {}) {
    const total = state.filteredEntries.length;
    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
    if (state.currentPage > totalPages) {
        state.currentPage = totalPages;
    }
    const start = (state.currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageEntries = state.filteredEntries.slice(start, end);

    dom.statsCount.textContent = total;
    dom.pageInfo.textContent = total > 0 ? `，第 ${state.currentPage}/${totalPages} 页` : '';

    updateSortIndicators();

    if (total === 0) {
        dom.results.innerHTML = '';
        showStatus('没有匹配的项目。试试其他关键词或重置过滤条件。');
        dom.pagination.style.display = 'none';
        return;
    }

    showStatus('');

    const maxStars = pageEntries.reduce(
        (max, entry) => Math.max(max, entry.stargazers_count || 0),
        1
    );

    const query = dom.searchInput.value.trim();
    const highlightTokens = query ? tokenizeSearchQuery(query) : [];

    const shouldFlip = options.flip && !prefersReducedMotion;
    const oldPositions = shouldFlip ? captureRowPositions() : null;

    dom.results.innerHTML = pageEntries
        .map(entry => entryToRowHtml(entry, maxStars, highlightTokens))
        .join('');

    if (shouldFlip) {
        playFlipAnimation(oldPositions);
    }

    if (options.fade && !prefersReducedMotion) {
        dom.tableWrap.classList.add('fading');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                dom.tableWrap.classList.remove('fading');
            });
        });
    }

    renderPagination(totalPages);
}

function captureRowPositions() {
    const positions = new Map();
    dom.results.querySelectorAll('tr.data-row').forEach(row => {
        positions.set(row.dataset.key, row.getBoundingClientRect().top);
    });
    return positions;
}

function playFlipAnimation(oldPositions) {
    const rows = dom.results.querySelectorAll('tr.data-row');
    rows.forEach(row => {
        const oldTop = oldPositions.get(row.dataset.key);
        if (oldTop == null) return;
        const deltaY = oldTop - row.getBoundingClientRect().top;
        if (deltaY === 0) return;
        row.style.transition = 'none';
        row.style.transform = `translateY(${deltaY}px)`;
    });
    dom.results.offsetHeight;
    rows.forEach(row => {
        if (!row.style.transform) return;
        row.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`;
        row.style.transform = '';
    });
}

function updateSortIndicators() {
    dom.tableWrap.querySelectorAll('thead th.sortable').forEach(th => {
        const slot = th.querySelector('.sort-slot');
        if (th.dataset.sort === state.sortField) {
            th.classList.add('sorted');
            slot.innerHTML = state.sortOrder === 'asc' ? SORT_ARROW_ASC : SORT_ARROW_DESC;
        } else {
            th.classList.remove('sorted');
            slot.innerHTML = '';
        }
    });
}

function entryToRowHtml(entry, maxStars, highlightTokens) {
    const score = Math.round(entry.quality_score || 0);
    const scoreClass = score >= HIGH_SCORE_THRESHOLD ? 'high'
        : score >= LOW_SCORE_THRESHOLD ? 'mid'
        : 'low';

    const stars = entry.stargazers_count || 0;
    const starsPct = Math.max(Math.round((stars / maxStars) * 100), 2);

    const topics = (entry.topics || []).slice(0, TOPIC_TAG_PER_ROW);
    const moreCount = (entry.topics || []).length - topics.length;

    const dots = [];
    for (let i = 0; i < SCORE_DOT_COUNT; i++) {
        dots.push(`<span class="score-dot${i < score ? ' filled' : ''}"></span>`);
    }

    const safeHref = safeExternalUrl(entry.html_url) || '#';
    const pinBadge = entry.pinned ? `<span class="badge-pinned" title="已置顶">${PIN_ICON_SVG}</span>` : '';
    const archivedBadge = entry.archived ? `<span class="badge-archived">已归档</span>` : '';
    const descOrSummary = entry.description || entry.summary || '';

    return (
        `<tr class="data-row" data-key="${escapeHtml(entry.full_name)}" tabindex="0">` +
            `<td><span class="cell-name">` +
                pinBadge +
                `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${highlightText(entry.full_name, highlightTokens)}</a>` +
                archivedBadge +
                `<span class="cell-desc">${highlightText(descOrSummary, highlightTokens)}</span>` +
            `</span></td>` +
            `<td>${entry.language
                ? `<span class="cell-lang"><span class="lang-dot" style="background-color: ${getLanguageColor(entry.language)}"></span>${escapeHtml(entry.language)}</span>`
                : ''}</td>` +
            `<td><span class="cell-stars">` +
                `<span class="stars-icon">${STAR_ICON_SVG}</span>` +
                `<span class="cell-stars-num">${stars}</span>` +
                `<span class="stars-bar"><span class="stars-bar-fill" style="width: ${starsPct}%"></span></span>` +
            `</span></td>` +
            `<td><span class="cell-score">` +
                `<span class="score-dots ${scoreClass}">${dots.join('')}</span>` +
                `<span class="cell-score-num">${score}/${SCORE_DOT_COUNT}</span>` +
            `</span></td>` +
            `<td><span class="cell-topics">` +
                topics.map(topic => `<button type="button" class="tag clickable" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('') +
                (moreCount > 0 ? `<span class="tag-more">+${moreCount}</span>` : '') +
            `</span></td>` +
            `<td class="cell-chevron">${CHEVRON_SVG}</td>` +
        `</tr>`
    );
}

function detailRowHtml(entry) {
    const query = dom.searchInput.value.trim();
    const highlightTokens = query ? tokenizeSearchQuery(query) : [];

    const categoryBadge = entry.category
        ? `<span class="tag category-tag">${escapeHtml(entry.category)}</span>`
        : '';
    const topics = (entry.topics || [])
        .map(topic => `<button type="button" class="tag clickable" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`)
        .join('');
    const useCases = (entry.use_cases || [])
        .map(useCase => `<button type="button" class="tag use-case clickable" data-usecase="${escapeHtml(useCase)}">${escapeHtml(useCase)}</button>`)
        .join('');

    const summaryBlock = entry.summary
        ? `<div class="detail-summary"><div class="detail-summary-label">摘要</div>${highlightText(entry.summary, highlightTokens)}</div>`
        : '';

    const aiButton = state.aiAvailability === 'available'
        ? `<button type="button" class="ai-summary-btn" data-repo="${escapeHtml(entry.full_name)}">` +
            `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"></path></svg>` +
            `本地 AI 深度分析` +
          `</button>`
        : state.aiAvailability === 'downloadable'
            ? `<span class="ai-summary-fallback">浏览器 AI 模型未就绪，可等待自动下载</span>`
            : '';

    const repoUrl = safeExternalUrl(entry.html_url);
    const homepageUrl = safeExternalUrl(entry.homepage);
    const deepwikiUrl = safeExternalUrl(entry.deepwiki_url);
    const zreadUrl = safeExternalUrl(entry.zread_url);
    const cloneCmd = repoUrl ? `git clone ${repoUrl}.git` : '';

    return (
        `<tr class="detail-row"><td colspan="6"><div class="detail-inner">` +
            `<p class="detail-desc">${highlightText(entry.description || '（无描述）', highlightTokens)}</p>` +
            summaryBlock +
            (aiButton ? `<div class="ai-summary-area">${aiButton}</div>` : '') +
            `<div class="detail-meta">` +
                (entry.language ? `<span>${escapeHtml(entry.language)}</span>` : '<span>无主语言</span>') +
                `<span>star ${entry.stargazers_count || 0}</span>` +
                `<span>fork ${entry.forks_count || 0}</span>` +
                (entry.license ? `<span>协议 ${escapeHtml(entry.license)}</span>` : '') +
                `<span>更新 ${formatDate(entry.pushed_at)}</span>` +
                `<span>starred ${formatDate(entry.starred_at)}</span>` +
            `</div>` +
            (categoryBadge || topics || useCases ? `<div class="detail-tags">${categoryBadge}${topics}${useCases}</div>` : '') +
            `<div class="detail-actions">` +
                (repoUrl ? `<a class="action-button" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener">${CODE_ICON_SVG}源码</a>` : '') +
                (homepageUrl ? `<a class="action-button" href="${escapeHtml(homepageUrl)}" target="_blank" rel="noopener">官网</a>` : '') +
                (deepwikiUrl ? `<a class="action-button deepwiki" href="${escapeHtml(deepwikiUrl)}" target="_blank" rel="noopener">DeepWiki</a>` : '') +
                (zreadUrl ? `<a class="action-button zread" href="${escapeHtml(zreadUrl)}" target="_blank" rel="noopener">Zread</a>` : '') +
                (cloneCmd ? `<button type="button" class="action-button copy-clone-btn" data-clone="${escapeHtml(cloneCmd)}">复制 clone</button>` : '') +
                `<button type="button" class="action-button pin-toggle-btn${entry.pinned ? ' active' : ''}" data-repo="${escapeHtml(entry.full_name)}">${entry.pinned ? '已置顶' : '置顶'}</button>` +
            `</div>` +
            `<div class="note-editor">` +
                `<input type="text" class="note-input" data-repo="${escapeHtml(entry.full_name)}" value="${escapeHtml(entry.note || '')}" placeholder="记录一句话备注（仅本地保存，可通过 ⌘K 导出 notes.json）">` +
                `<button type="button" class="action-button note-save-btn" data-repo="${escapeHtml(entry.full_name)}">保存备注</button>` +
                `<span class="note-save-status"></span>` +
            `</div>` +
        `</div></td></tr>`
    );
}

function toggleExpand(key) {
    const entry = state.filteredEntries.find(item => item.full_name === key);
    if (!entry) return;

    const existingDetail = dom.results.querySelector('tr.detail-row');
    const previousExpanded = dom.results.querySelector('tr.data-row.expanded');
    if (existingDetail) existingDetail.remove();
    if (previousExpanded) previousExpanded.classList.remove('expanded');

    if (state.expandedKey === key) {
        state.expandedKey = '';
        return;
    }

    state.expandedKey = key;
    const row = dom.results.querySelector(`tr.data-row[data-key="${cssEscape(key)}"]`);
    if (!row) return;
    row.classList.add('expanded');
    row.insertAdjacentHTML('afterend', detailRowHtml(entry));
}

function renderPagination(totalPages) {
    if (totalPages <= 1) {
        dom.pagination.style.display = 'none';
        return;
    }
    dom.pagination.style.display = 'flex';
    dom.pagination.innerHTML = '';

    const current = state.currentPage;

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.textContent = '←';
    prevButton.className = 'nav-btn';
    prevButton.title = '上一页（←）';
    prevButton.disabled = current === 1;
    prevButton.addEventListener('click', () => goToPage(current - 1));
    dom.pagination.appendChild(prevButton);

    const pageItems = buildPageItems(current, totalPages);
    for (const item of pageItems) {
        if (item === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '…';
            dom.pagination.appendChild(ellipsis);
        } else {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = String(item);
            if (item === current) {
                btn.classList.add('active');
            } else {
                btn.addEventListener('click', () => goToPage(item));
            }
            dom.pagination.appendChild(btn);
        }
    }

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = '→';
    nextButton.className = 'nav-btn';
    nextButton.title = '下一页（→）';
    nextButton.disabled = current === totalPages;
    nextButton.addEventListener('click', () => goToPage(current + 1));
    dom.pagination.appendChild(nextButton);

    const pageInfo = document.createElement('span');
    pageInfo.className = 'pagination-info';
    pageInfo.textContent = `${current} / ${totalPages}`;
    dom.pagination.appendChild(pageInfo);
}

function buildPageItems(current, total) {
    if (total <= PAGINATION_COMPACT_THRESHOLD) {
        const all = [];
        for (let i = 1; i <= total; i++) all.push(i);
        return all;
    }

    const items = [];
    const range = 2;
    const left = Math.max(1, current - range);
    const right = Math.min(total, current + range);

    for (let i = 1; i <= total; i++) {
        if (i === 1 || i === total || (i >= left && i <= right)) {
            items.push(i);
        } else if (items[items.length - 1] !== '...') {
            items.push('...');
        }
    }
    return items;
}

function goToPage(page) {
    const totalPages = Math.ceil(state.filteredEntries.length / PAGE_SIZE) || 1;
    if (page < 1 || page > totalPages || page === state.currentPage) return;
    state.currentPage = page;
    state.selectedIndex = -1;
    state.expandedKey = '';
    renderResults({ fade: true });
}

function cssEscape(text) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(text);
    return String(text).replace(/"/g, '\\"');
}

function formatDate(isoString) {
    if (!isoString) return '未知';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '未知';
    return date.toLocaleDateString('zh-CN');
}

function getLanguageColor(language) {
    if (!language) return DEFAULT_LANGUAGE_COLOR;
    return LANGUAGE_COLORS[language] || DEFAULT_LANGUAGE_COLOR;
}

// ========== 个人备注 & 置顶管理 ==========

function updatePersonalNote(fullName, patch) {
    const current = state.userNotes[fullName] || {};
    state.userNotes[fullName] = { ...current, ...patch };
    writeUserNotes(state.userNotes);

    const keepExpanded = state.expandedKey;
    rebuildEntriesWithNotes();
    applyFilters({ flip: false, syncUrl: false });
    if (keepExpanded) {
        state.expandedKey = '';
        toggleExpand(keepExpanded);
    }
}

function exportPersonalNotes() {
    const payload = {};
    for (const entry of state.allEntries) {
        if (entry.pinned || (entry.note && entry.note.trim())) {
            payload[entry.full_name] = {
                pinned: Boolean(entry.pinned),
                note: (entry.note || '').trim(),
            };
        }
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notes.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleNotesImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(String(reader.result || '{}'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('无效格式');
            }
            const nextNotes = { ...state.userNotes };
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'string') {
                    nextNotes[key] = { pinned: false, note: value };
                } else if (value && typeof value === 'object') {
                    nextNotes[key] = {
                        pinned: Boolean(value.pinned),
                        note: String(value.note || ''),
                    };
                }
            }
            state.userNotes = nextNotes;
            writeUserNotes(state.userNotes);
            rebuildEntriesWithNotes();
            applyFilters({ flip: false });
        } catch {
            showStatus('导入 notes.json 失败：请确认文件是合法的 JSON 对象。', true);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ========== 剪贴板与 Modal ==========

function copyTextWithFeedback(text, button, copiedLabel = '已复制') {
    const showCopied = () => {
        const original = button.textContent;
        button.textContent = copiedLabel;
        button.classList.add('copied');
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove('copied');
        }, 1500);
    };

    const copyFallback = () => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } catch {
            // 忽略
        }
        document.body.removeChild(textarea);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied).catch(() => {
            copyFallback();
            showCopied();
        });
    } else {
        copyFallback();
        showCopied();
    }
}

function openAccessModal() {
    dom.accessModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeAccessModal() {
    dom.accessModal.classList.remove('active');
    document.body.style.overflow = '';
}

function copyCodeBlock(button) {
    const targetId = button.getAttribute('data-copy-target');
    const codeEl = document.getElementById(targetId);
    if (!codeEl) return;
    copyTextWithFeedback(codeEl.textContent, button);
}

// ========== 命令面板（⌘K） ==========

function buildPaletteCommands() {
    const commands = [];
    const hasFilters = dom.searchInput.value.trim() !== ''
        || state.selectedLanguage !== ''
        || state.selectedCategory !== ''
        || state.activeTopic !== ''
        || state.hideArchived
        || state.pinnedOnly
        || state.specialFilter !== ''
        || state.sortField !== DEFAULT_SORT_FIELD;

    if (hasFilters) {
        commands.push({
            id: 'reset-all',
            title: '重置全部过滤与排序',
            hint: '',
            action: resetAll,
        });
    }

    if (state.activeTopic) {
        commands.push({
            id: 'clear-topic',
            title: `清除 topic 筛选（${state.activeTopic}）`,
            hint: '',
            action: () => {
                state.activeTopic = '';
                renderFacets();
                applyFilters();
            },
        });
    }

    commands.push({
        id: 'sort-starred',
        title: '排序：最近 star',
        hint: state.sortField === 'starred_at' ? '当前' : '',
        action: () => setSort('starred_at', 'desc'),
    });
    commands.push({
        id: 'sort-stars',
        title: '排序：Star 数（高→低）',
        hint: state.sortField === 'stargazers_count' ? '当前' : '',
        action: () => setSort('stargazers_count', 'desc'),
    });
    commands.push({
        id: 'sort-score',
        title: '排序：质量评分（高→低）',
        hint: state.sortField === 'quality_score' ? '当前' : '',
        action: () => setSort('quality_score', 'desc'),
    });
    commands.push({
        id: 'sort-pushed',
        title: '排序：最近更新',
        hint: state.sortField === 'pushed_at' ? '当前' : '',
        action: () => setSort('pushed_at', 'desc'),
    });

    if (state.archivedCount > 0) {
        commands.push({
            id: 'toggle-archived',
            title: state.hideArchived ? '显示已归档项目' : '隐藏已归档项目',
            hint: `${state.archivedCount}`,
            action: () => {
                state.hideArchived = !state.hideArchived;
                updateToggleButtons();
                applyFilters();
            },
        });
    }

    if (state.pinnedCount > 0) {
        commands.push({
            id: 'toggle-pinned',
            title: state.pinnedOnly ? '查看全部项目' : '仅看置顶项目',
            hint: `${state.pinnedCount}`,
            action: () => {
                state.pinnedOnly = !state.pinnedOnly;
                updateToggleButtons();
                applyFilters();
            },
        });
    }

    const totalPages = Math.ceil(state.filteredEntries.length / PAGE_SIZE) || 1;
    if (state.viewMode === 'table' && state.currentPage < totalPages) {
        commands.push({
            id: 'next-page',
            title: '下一页',
            hint: '→',
            action: () => goToPage(state.currentPage + 1),
        });
    }
    if (state.viewMode === 'table' && state.currentPage > 1) {
        commands.push({
            id: 'prev-page',
            title: '上一页',
            hint: '←',
            action: () => goToPage(state.currentPage - 1),
        });
    }

    commands.push({
        id: 'export-notes',
        title: '导出个人备注与置顶（notes.json）',
        hint: '',
        action: exportPersonalNotes,
    });
    commands.push({
        id: 'import-notes',
        title: '导入个人备注（notes.json）',
        hint: '',
        action: () => dom.notesImportInput.click(),
    });
    commands.push({
        id: 'open-access',
        title: '打开 Agent 接入说明',
        hint: '',
        action: openAccessModal,
    });
    commands.push({
        id: 'view-table',
        title: '切换到表格视图',
        hint: state.viewMode === 'table' ? '当前' : '',
        action: () => switchView('table'),
    });
    commands.push({
        id: 'view-zoom',
        title: '切换到星图视图',
        hint: state.viewMode === 'zoom' ? '当前' : '',
        action: () => switchView('zoom'),
    });

    return commands;
}

function setSort(field, order) {
    state.sortField = field;
    state.sortOrder = order;
    state.manualSortDuringQuery = Boolean(dom.searchInput.value.trim());
    applyFilters();
}

function clearBannerFilter() {
    state.specialFilter = '';
    state.specialFilterNames = new Set();
    dom.bannerFilterPill.style.display = 'none';
}

function resetAll() {
    dom.searchInput.value = '';
    state.selectedLanguage = '';
    state.selectedCategory = '';
    dom.languageFilter.value = '';
    dom.categoryFilter.value = '';
    state.activeTopic = '';
    state.hideArchived = false;
    state.pinnedOnly = false;
    state.manualSortDuringQuery = false;
    state.preSearchSort = null;
    clearBannerFilter();
    state.sortField = DEFAULT_SORT_FIELD;
    state.sortOrder = DEFAULT_SORT_ORDER;
    updateToggleButtons();
    renderFacets();
    applyFilters({ flip: false });
}

function openPalette() {
    state.paletteOpen = true;
    dom.paletteOverlay.classList.add('active');
    dom.paletteInput.value = '';
    renderPaletteList('');
    dom.paletteInput.focus();
}

function closePalette() {
    state.paletteOpen = false;
    dom.paletteOverlay.classList.remove('active');
    dom.searchInput.focus();
}

function togglePalette() {
    if (state.paletteOpen) {
        closePalette();
    } else {
        openPalette();
    }
}

function renderPaletteList(query) {
    const normalized = query.trim().toLowerCase();
    const commands = buildPaletteCommands();
    const matchedCommands = normalized
        ? commands.filter(cmd => cmd.title.toLowerCase().includes(normalized))
        : commands;

    const items = matchedCommands.map(cmd => ({
        kind: 'command',
        title: cmd.title,
        hint: cmd.hint,
        action: cmd.action,
    }));

    if (normalized) {
        const matchedEntries = state.allEntries
            .filter(entry => matchesSearchQuery(entry, normalized))
            .slice(0, PALETTE_RESULT_MAX);
        for (const entry of matchedEntries) {
            items.push({
                kind: 'entry',
                title: entry.full_name,
                hint: `star ${entry.stargazers_count || 0}`,
                url: safeExternalUrl(entry.html_url),
            });
        }
    }

    state.paletteItems = items;
    state.paletteIndex = 0;

    if (items.length === 0) {
        dom.paletteList.innerHTML = '<div class="palette-empty">没有匹配的命令或项目</div>';
        return;
    }

    const html = [];
    let entryHeaderShown = false;
    items.forEach((item, index) => {
        if (item.kind === 'entry' && !entryHeaderShown && normalized) {
            html.push('<div class="palette-section">项目</div>');
            entryHeaderShown = true;
        }
        if (item.kind === 'command' && index === 0 && normalized && items.some(i => i.kind === 'entry')) {
            html.push('<div class="palette-section">命令</div>');
        }
        html.push(
            `<div class="palette-item${index === state.paletteIndex ? ' active' : ''}" data-index="${index}">` +
                `<span class="palette-item-title">${escapeHtml(item.title)}</span>` +
                (item.hint ? `<span class="palette-item-hint">${escapeHtml(item.hint)}</span>` : '') +
            `</div>`
        );
    });
    dom.paletteList.innerHTML = html.join('');
}

function movePaletteSelection(delta) {
    const count = state.paletteItems.length;
    if (count === 0) return;
    state.paletteIndex = (state.paletteIndex + delta + count) % count;
    dom.paletteList.querySelectorAll('.palette-item').forEach(item => {
        item.classList.toggle('active', Number(item.dataset.index) === state.paletteIndex);
    });
    const activeItem = dom.paletteList.querySelector('.palette-item.active');
    if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
    }
}

function executePaletteSelection() {
    const item = state.paletteItems[state.paletteIndex];
    if (!item) return;
    closePalette();
    if (item.kind === 'entry') {
        if (item.url) window.open(item.url, '_blank', 'noopener');
    } else {
        item.action();
    }
}

// ========== 键盘导航 ==========

function moveRowSelection(delta) {
    const rows = Array.from(dom.results.querySelectorAll('tr.data-row'));
    if (rows.length === 0) return;

    state.selectedIndex = Math.min(Math.max(state.selectedIndex + delta, 0), rows.length - 1);
    rows.forEach((row, index) => {
        row.classList.toggle('selected', index === state.selectedIndex);
    });
    const selectedRow = rows[state.selectedIndex];
    selectedRow.focus({ preventScroll: true });
    selectedRow.scrollIntoView({ block: 'nearest' });
}

function toggleSelectedRow() {
    const rows = dom.results.querySelectorAll('tr.data-row');
    if (state.selectedIndex < 0 || state.selectedIndex >= rows.length) return;
    toggleExpand(rows[state.selectedIndex].dataset.key);
}

// ========== F1: 浏览器内 AI 摘要 ==========

async function checkAIAvailability() {
    if (state.aiAvailability !== null) return state.aiAvailability;
    try {
        if (!('LanguageModel' in window)) {
            state.aiAvailability = 'unavailable';
            return state.aiAvailability;
        }
        const status = await LanguageModel.availability();
        state.aiAvailability = status;
        return status;
    } catch {
        state.aiAvailability = 'unavailable';
        return state.aiAvailability;
    }
}

async function generateAISummary(fullName, button) {
    const entry = state.allEntries.find(e => e.full_name === fullName);
    if (!entry) return;

    const container = button.closest('.ai-summary-area');
    if (!container) return;

    button.disabled = true;
    const loadingEl = document.createElement('span');
    loadingEl.className = 'ai-summary-loading';
    loadingEl.textContent = '本地推理中';
    container.appendChild(loadingEl);

    try {
        const prompt = [
            `项目：${entry.full_name}`,
            entry.description ? `描述：${entry.description}` : '',
            entry.language ? `语言：${entry.language}` : '',
            (entry.topics || []).length > 0 ? `标签：${entry.topics.join(', ')}` : '',
            entry.summary ? `已有摘要：${entry.summary}` : '',
        ].filter(Boolean).join('\n');

        const session = await LanguageModel.create({
            initialPrompts: [{ role: 'system', content: AI_SUMMARY_SYSTEM_PROMPT }],
        });
        const result = await session.prompt(prompt);
        session.destroy();

        container.innerHTML = `<div class="ai-summary-result">${escapeHtml(result)}</div>`;
    } catch {
        container.innerHTML = entry.summary
            ? `<div class="ai-summary-result">${escapeHtml(entry.summary)}</div>` +
              `<div class="ai-summary-fallback">本地 AI 不可用，已显示静态摘要</div>`
            : `<div class="ai-summary-fallback">本地 AI 不可用</div>`;
    }
}

// ========== F2: 上下文首屏 ==========

function renderWhatsNew(changes) {
    if (!changes) return;
    const items = [];

    if (changes.newProjects.length > 0) {
        items.push(
            `<button type="button" class="whats-new-link" data-action="filter-new">` +
                `新增 <span class="whats-new-item-value">${changes.newProjects.length}</span> 个项目` +
            `</button>`
        );
    }

    if (changes.starsGrew.length > 0) {
        const totalDelta = changes.starsGrew.reduce((sum, item) => sum + item.delta, 0);
        items.push(
            `<button type="button" class="whats-new-link" data-action="filter-grew">` +
                `<span class="whats-new-item-value">+${totalDelta}</span> stars（${changes.starsGrew.length} 个项目增长）` +
            `</button>`
        );
    }

    if (items.length === 0) return;

    const lastVisitDate = new Date(changes.lastVisit);
    const lastVisitStr = lastVisitDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    dom.whatsNewBody.innerHTML =
        `<div class="whats-new-title">自 ${escapeHtml(lastVisitStr)} 以来的变化（点击可筛选）</div>` +
        `<div class="whats-new-items">${items.join('')}</div>`;
    dom.whatsNew.style.display = 'flex';
}

function dismissWhatsNew() {
    dom.whatsNew.style.display = 'none';
}

// ========== F3: 语音输入 ==========

function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    dom.voiceBtn.style.display = 'flex';

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    state.voiceRecognition = recognition;

    recognition.onresult = event => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        dom.searchInput.value = transcript;
        if (event.results[event.results.length - 1].isFinal) {
            applyFilters();
        }
    };

    recognition.onerror = () => stopVoiceInput();
    recognition.onend = () => stopVoiceInput();
    dom.voiceBtn.addEventListener('click', toggleVoiceInput);
}

function toggleVoiceInput() {
    if (state.voiceListening) {
        state.voiceRecognition.stop();
        stopVoiceInput();
    } else {
        try {
            state.voiceRecognition.start();
            state.voiceListening = true;
            dom.voiceBtn.classList.add('listening');
        } catch {
            // 连续点击防护
        }
    }
}

function stopVoiceInput() {
    state.voiceListening = false;
    dom.voiceBtn.classList.remove('listening');
}

// ========== F4: 语义缩放（星图视图） ==========

function switchView(mode, options = {}) {
    state.viewMode = mode;
    if (mode === 'zoom') {
        dom.viewTableBtn.classList.remove('active');
        dom.viewZoomBtn.classList.add('active');
        dom.tableWrap.style.display = 'none';
        dom.pagination.style.display = 'none';
        dom.zoomContainer.classList.add('active');
        initZoomCanvas();
    } else {
        dom.viewTableBtn.classList.add('active');
        dom.viewZoomBtn.classList.remove('active');
        dom.zoomContainer.classList.remove('active');
        dom.tableWrap.style.display = '';
        renderResults({ flip: false });
    }
    if (options.syncUrl !== false) {
        syncStateToUrl();
    }
}

function initZoomCanvas() {
    const canvas = dom.zoomCanvas;
    const container = dom.zoomContainer;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(500, Math.min(window.innerHeight - 300, 700));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    computeZoomLayout(width, height);
    renderZoomCanvas(ctx, width, height);
}

function computeZoomLayout(width, height) {
    const entries = state.filteredEntries;
    if (entries.length === 0) {
        state.zoomNodes = [];
        state.zoomClusters = [];
        dom.zoomEmpty.style.display = 'flex';
        return;
    }
    dom.zoomEmpty.style.display = 'none';

    const langMap = new Map();
    for (const entry of entries) {
        const lang = entry.language || '无语言';
        if (!langMap.has(lang)) langMap.set(lang, []);
        langMap.get(lang).push(entry);
    }

    const sortedGroups = Array.from(langMap.entries()).sort((a, b) => b[1].length - a[1].length);
    let finalGroups = sortedGroups;
    if (sortedGroups.length > ZOOM_CLUSTER_MAX) {
        finalGroups = sortedGroups.slice(0, ZOOM_CLUSTER_MAX - 1);
        const tailItems = [];
        for (let i = ZOOM_CLUSTER_MAX - 1; i < sortedGroups.length; i++) {
            tailItems.push(...sortedGroups[i][1]);
        }
        finalGroups.push(['其他语言', tailItems]);
    }

    const clusterCount = finalGroups.length;
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = width * 0.34;
    const radiusY = height * 0.32;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    const clusters = [];
    const nodes = [];

    finalGroups.forEach(([lang, rawItems], idx) => {
        const items = rawItems.slice().sort((a, b) => {
            const qDiff = (b.quality_score || 0) - (a.quality_score || 0);
            if (qDiff !== 0) return qDiff;
            return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        });

        let cx = centerX;
        let cy = centerY;
        if (clusterCount > 1) {
            const angle = (idx / clusterCount) * Math.PI * 2 - Math.PI / 2;
            cx = centerX + Math.cos(angle) * radiusX;
            cy = centerY + Math.sin(angle) * radiusY;
        }
        const color = getLanguageColor(lang);
        const haloRadius = Math.max(ZOOM_CLUSTER_RADIUS_BASE, 16 + Math.sqrt(items.length) * 6);

        clusters.push({
            lang,
            x: cx,
            y: cy,
            count: items.length,
            color,
            haloRadius,
        });

        items.forEach((entry, i) => {
            const itemAngle = i * goldenAngle;
            const itemRadius = i === 0 ? 0 : 6 + Math.sqrt(i) * 5.2;
            nodes.push({
                x: cx + Math.cos(itemAngle) * itemRadius,
                y: cy + Math.sin(itemAngle) * itemRadius,
                entry,
                color,
                lang,
                isHighlightNode: i < 2,
            });
        });
    });

    state.zoomNodes = nodes;
    state.zoomClusters = clusters;
    state.zoomScale = 1;
    state.zoomOffsetX = 0;
    state.zoomOffsetY = 0;
}

function renderZoomCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    if (state.zoomNodes.length === 0) return;

    ctx.save();
    ctx.translate(width / 2 + state.zoomOffsetX, height / 2 + state.zoomOffsetY);
    ctx.scale(state.zoomScale, state.zoomScale);
    ctx.translate(-width / 2, -height / 2);

    for (const cluster of state.zoomClusters) {
        ctx.strokeStyle = 'rgba(0,0,0,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2);
        ctx.lineTo(cluster.x, cluster.y);
        ctx.stroke();
    }

    for (const cluster of state.zoomClusters) {
        const r = cluster.haloRadius;
        const grad = ctx.createRadialGradient(cluster.x, cluster.y, 0, cluster.x, cluster.y, r);
        grad.addColorStop(0, cluster.color + '20');
        grad.addColorStop(1, cluster.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cluster.x, cluster.y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    if (state.zoomScale < ZOOM_CLUSTER_LABEL_MAX_SCALE) {
        ctx.font = '600 11px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#57534e';
        for (const cluster of state.zoomClusters) {
            ctx.fillText(
                `${cluster.lang} (${cluster.count})`,
                cluster.x,
                cluster.y - Math.min(cluster.haloRadius * 0.72, 48)
            );
        }
    }

    const showTopLabels = state.zoomScale >= ZOOM_TOP_NODE_LABEL_SCALE;
    const showAllLabels = state.zoomScale >= ZOOM_ALL_LABEL_SCALE;

    for (const node of state.zoomNodes) {
        const isHovered = state.zoomHoveredNode === node;
        const r = isHovered ? ZOOM_NODE_RADIUS_HOVER : ZOOM_NODE_RADIUS;

        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (isHovered) {
            ctx.strokeStyle = '#1c1917';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        if (isHovered || showAllLabels || (showTopLabels && node.isHighlightNode)) {
            ctx.font = '500 10px -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#1c1917';
            ctx.fillText(node.entry.full_name, node.x + r + 3, node.y + 3);
        }
    }

    ctx.restore();
}

function screenToWorld(screenX, screenY, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    return {
        x: ((screenX - cx - state.zoomOffsetX) / state.zoomScale) + cx,
        y: ((screenY - cy - state.zoomOffsetY) / state.zoomScale) + cy,
    };
}

function findNodeAt(worldX, worldY) {
    const hitRadius = Math.max(ZOOM_NODE_RADIUS_HOVER, ZOOM_NODE_RADIUS / state.zoomScale);
    for (let i = state.zoomNodes.length - 1; i >= 0; i--) {
        const node = state.zoomNodes[i];
        const dx = node.x - worldX;
        const dy = node.y - worldY;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
            return node;
        }
    }
    return null;
}

function bindZoomCanvasEvents() {
    const canvas = dom.zoomCanvas;
    const ctx = canvas.getContext('2d');

    const getMousePos = e => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const getCanvasSize = () => {
        const dpr = window.devicePixelRatio || 1;
        return { width: canvas.width / dpr, height: canvas.height / dpr };
    };

    canvas.addEventListener('mousedown', e => {
        const pos = getMousePos(e);
        state.zoomPointerDown = true;
        state.zoomDragMoved = false;
        state.zoomDownX = pos.x;
        state.zoomDownY = pos.y;
        state.zoomLastMouseX = pos.x;
        state.zoomLastMouseY = pos.y;
    });

    canvas.addEventListener('mousemove', e => {
        const pos = getMousePos(e);
        const size = getCanvasSize();

        if (state.zoomPointerDown) {
            if (Math.hypot(pos.x - state.zoomDownX, pos.y - state.zoomDownY) > ZOOM_DRAG_THRESHOLD_PX) {
                state.zoomDragMoved = true;
            }
            if (state.zoomDragMoved) {
                state.zoomOffsetX += pos.x - state.zoomLastMouseX;
                state.zoomOffsetY += pos.y - state.zoomLastMouseY;
                renderZoomCanvas(ctx, size.width, size.height);
            }
            state.zoomLastMouseX = pos.x;
            state.zoomLastMouseY = pos.y;
            return;
        }

        const world = screenToWorld(pos.x, pos.y, size.width, size.height);
        const hovered = findNodeAt(world.x, world.y);
        if (hovered !== state.zoomHoveredNode) {
            state.zoomHoveredNode = hovered;
            renderZoomCanvas(ctx, size.width, size.height);
        }
        if (hovered) {
            dom.zoomTooltip.textContent = `${hovered.entry.full_name} — ${hovered.entry.summary || hovered.entry.description || ''}`;
            dom.zoomTooltip.style.display = 'block';
            const tipWidth = dom.zoomTooltip.offsetWidth || 200;
            const left = Math.max(8, Math.min(pos.x + 12, size.width - tipWidth - 8));
            const top = Math.max(8, pos.y - 28);
            dom.zoomTooltip.style.left = `${left}px`;
            dom.zoomTooltip.style.top = `${top}px`;
        } else {
            dom.zoomTooltip.style.display = 'none';
        }
    });

    canvas.addEventListener('mouseup', () => {
        state.zoomPointerDown = false;
    });

    canvas.addEventListener('mouseleave', () => {
        state.zoomPointerDown = false;
        state.zoomDragMoved = false;
        state.zoomHoveredNode = null;
        dom.zoomTooltip.style.display = 'none';
        const size = getCanvasSize();
        renderZoomCanvas(ctx, size.width, size.height);
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const pos = getMousePos(e);
        const size = getCanvasSize();
        const delta = -e.deltaY * ZOOM_WHEEL_FACTOR;
        const newScale = Math.min(Math.max(state.zoomScale * (1 + delta), ZOOM_MIN_SCALE), ZOOM_MAX_SCALE);
        const nextOffset = computeWheelZoomOffset(
            pos,
            size,
            state.zoomScale,
            newScale,
            { x: state.zoomOffsetX, y: state.zoomOffsetY }
        );
        state.zoomOffsetX = nextOffset.x;
        state.zoomOffsetY = nextOffset.y;
        state.zoomScale = newScale;
        renderZoomCanvas(ctx, size.width, size.height);
    }, { passive: false });

    canvas.addEventListener('click', e => {
        if (state.zoomDragMoved) {
            state.zoomDragMoved = false;
            return;
        }
        const pos = getMousePos(e);
        const size = getCanvasSize();
        const world = screenToWorld(pos.x, pos.y, size.width, size.height);
        const node = findNodeAt(world.x, world.y);
        if (!node) return;

        const targetKey = node.entry.full_name;
        const entryIndex = state.filteredEntries.findIndex(item => item.full_name === targetKey);
        if (entryIndex < 0) return;

        switchView('table');
        state.currentPage = Math.floor(entryIndex / PAGE_SIZE) + 1;
        renderResults({ flip: false });
        toggleExpand(targetKey);
        const row = dom.results.querySelector(`tr.data-row[data-key="${cssEscape(targetKey)}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
    });
}

// ========== 事件绑定与启动 ==========

function applyUrlState(parsed) {
    dom.searchInput.value = parsed.q;
    state.selectedLanguage = parsed.lang;
    state.selectedCategory = parsed.cat;
    state.activeTopic = parsed.topic;
    state.sortField = parsed.sort;
    state.sortOrder = parsed.order;
    state.hideArchived = parsed.hideArchived;
    state.pinnedOnly = parsed.pinned;
    state.desiredViewMode = parsed.view;
}

function bindEvents() {
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            togglePalette();
            return;
        }

        if (event.key === 'Escape') {
            if (state.paletteOpen) {
                closePalette();
            } else if (dom.accessModal.classList.contains('active')) {
                closeAccessModal();
            } else if (state.expandedKey) {
                toggleExpand(state.expandedKey);
            } else if (document.activeElement === dom.searchInput) {
                dom.searchInput.blur();
            }
            return;
        }

        if (state.paletteOpen || dom.accessModal.classList.contains('active')) return;

        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if (
            tag === 'INPUT' ||
            tag === 'SELECT' ||
            tag === 'TEXTAREA' ||
            tag === 'BUTTON' ||
            tag === 'A' ||
            (active && active.isContentEditable)
        ) {
            return;
        }

        if (event.key === '/') {
            event.preventDefault();
            dom.searchInput.focus();
            return;
        }

        if (state.viewMode !== 'table') return;

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goToPage(state.currentPage - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            goToPage(state.currentPage + 1);
        } else if (event.key === 'j') {
            event.preventDefault();
            moveRowSelection(1);
        } else if (event.key === 'k') {
            event.preventDefault();
            moveRowSelection(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            toggleSelectedRow();
        }
    });

    dom.paletteInput.addEventListener('input', () => renderPaletteList(dom.paletteInput.value));
    dom.paletteInput.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            movePaletteSelection(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            movePaletteSelection(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            executePaletteSelection();
        }
    });
    dom.paletteOverlay.addEventListener('click', event => {
        if (event.target === dom.paletteOverlay) closePalette();
    });
    dom.paletteList.addEventListener('click', event => {
        const item = event.target.closest('.palette-item');
        if (!item) return;
        state.paletteIndex = Number(item.dataset.index);
        executePaletteSelection();
    });

    dom.notesImportInput.addEventListener('change', handleNotesImportFile);

    dom.tableWrap.querySelectorAll('thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (state.sortField === field) {
                state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortField = field;
                state.sortOrder = field === 'full_name' ? 'asc' : 'desc';
            }
            state.manualSortDuringQuery = Boolean(dom.searchInput.value.trim());
            applyFilters();
        });
    });

    // 表格与详情区事件委托（无内联 onclick）
    dom.results.addEventListener('click', event => {
        const aiBtn = event.target.closest('.ai-summary-btn');
        if (aiBtn) {
            generateAISummary(aiBtn.dataset.repo, aiBtn);
            return;
        }

        const topicBtn = event.target.closest('.tag[data-topic]');
        if (topicBtn) {
            event.stopPropagation();
            state.activeTopic = state.activeTopic === topicBtn.dataset.topic ? '' : topicBtn.dataset.topic;
            renderFacets();
            applyFilters();
            return;
        }

        const useCaseBtn = event.target.closest('.tag[data-usecase]');
        if (useCaseBtn) {
            event.stopPropagation();
            dom.searchInput.value = useCaseBtn.dataset.usecase;
            applyFilters();
            return;
        }

        const cloneBtn = event.target.closest('.copy-clone-btn');
        if (cloneBtn) {
            copyTextWithFeedback(cloneBtn.dataset.clone, cloneBtn);
            return;
        }

        const pinBtn = event.target.closest('.pin-toggle-btn');
        if (pinBtn) {
            const repoKey = pinBtn.dataset.repo;
            const entry = state.allEntries.find(e => e.full_name === repoKey);
            if (entry) {
                updatePersonalNote(repoKey, { pinned: !entry.pinned });
            }
            return;
        }

        const saveNoteBtn = event.target.closest('.note-save-btn');
        if (saveNoteBtn) {
            const repoKey = saveNoteBtn.dataset.repo;
            const editor = saveNoteBtn.closest('.note-editor');
            const input = editor && editor.querySelector('.note-input');
            const noteVal = input ? input.value.trim() : '';
            updatePersonalNote(repoKey, { note: noteVal });
            return;
        }

        if (event.target.closest('a, button, input, textarea, .detail-row')) return;

        const row = event.target.closest('tr.data-row');
        if (!row) return;
        toggleExpand(row.dataset.key);
    });

    dom.results.addEventListener('focusin', event => {
        const row = event.target.closest('tr.data-row');
        if (!row) return;
        const rows = Array.from(dom.results.querySelectorAll('tr.data-row'));
        state.selectedIndex = rows.indexOf(row);
        rows.forEach((item, index) => {
            item.classList.toggle('selected', index === state.selectedIndex);
        });
    });

    dom.results.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.classList.contains('note-input')) {
            event.preventDefault();
            event.stopPropagation();
            updatePersonalNote(event.target.dataset.repo, { note: event.target.value.trim() });
            return;
        }

        const row = event.target.closest('tr.data-row');
        if (!row) return;
        if (event.key === 'Enter' && event.target === row) {
            event.preventDefault();
            event.stopPropagation();
            toggleExpand(row.dataset.key);
        }
    });

    dom.facetNav.addEventListener('click', event => {
        const chip = event.target.closest('.facet-chip');
        if (!chip) return;
        state.activeTopic = chip.dataset.topic;
        renderFacets();
        applyFilters();
    });

    dom.whatsNewBody.addEventListener('click', event => {
        const actionBtn = event.target.closest('.whats-new-link');
        if (!actionBtn || !state.whatsNewChanges) return;
        const action = actionBtn.dataset.action;
        if (action === 'filter-new') {
            state.specialFilter = 'new';
            state.specialFilterNames = new Set(state.whatsNewChanges.newProjects.map(e => e.full_name));
            dom.bannerFilterText.textContent = `新增项目 (${state.specialFilterNames.size})`;
            dom.bannerFilterPill.style.display = 'inline-flex';
            applyFilters();
        } else if (action === 'filter-grew') {
            state.specialFilter = 'grew';
            state.specialFilterNames = new Set(state.whatsNewChanges.starsGrew.map(e => e.name));
            dom.bannerFilterText.textContent = `Star 增长 (${state.specialFilterNames.size})`;
            dom.bannerFilterPill.style.display = 'inline-flex';
            applyFilters();
        }
    });

    dom.bannerFilterClear.addEventListener('click', () => {
        clearBannerFilter();
        applyFilters();
    });

    dom.searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') applyFilters();
    });

    let debounceTimer = null;
    dom.searchInput.addEventListener('input', () => {
        const query = dom.searchInput.value.trim();
        if (!query) {
            if (state.preSearchSort) {
                state.sortField = state.preSearchSort.field;
                state.sortOrder = state.preSearchSort.order;
                state.preSearchSort = null;
            }
            state.manualSortDuringQuery = false;
        } else {
            if (!state.preSearchSort) {
                state.preSearchSort = { field: state.sortField, order: state.sortOrder };
            }
            if (!state.manualSortDuringQuery) {
                state.sortField = 'relevance';
                state.sortOrder = 'desc';
            }
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applyFilters(), 220);
    });

    dom.languageFilter.addEventListener('change', () => {
        state.selectedLanguage = dom.languageFilter.value;
        applyFilters();
    });
    dom.categoryFilter.addEventListener('change', () => {
        state.selectedCategory = dom.categoryFilter.value;
        applyFilters();
    });
    dom.sortSelect.addEventListener('change', () => {
        const [field, order] = dom.sortSelect.value.split(':');
        setSort(field || DEFAULT_SORT_FIELD, order || DEFAULT_SORT_ORDER);
    });
    dom.hideArchivedBtn.addEventListener('click', () => {
        state.hideArchived = !state.hideArchived;
        updateToggleButtons();
        applyFilters();
    });
    dom.pinnedOnlyBtn.addEventListener('click', () => {
        state.pinnedOnly = !state.pinnedOnly;
        updateToggleButtons();
        applyFilters();
    });
    dom.resetButton.addEventListener('click', resetAll);

    dom.accessButton.addEventListener('click', openAccessModal);
    dom.modalClose.addEventListener('click', closeAccessModal);
    dom.accessModal.addEventListener('click', event => {
        if (event.target === dom.accessModal) closeAccessModal();
    });
    document.querySelectorAll('.copy-button').forEach(btn => {
        btn.addEventListener('click', () => copyCodeBlock(btn));
    });

    dom.whatsNewDismiss.addEventListener('click', dismissWhatsNew);
    dom.viewTableBtn.addEventListener('click', () => switchView('table'));
    dom.viewZoomBtn.addEventListener('click', () => switchView('zoom'));

    const zoomAroundCenter = factor => {
        const dpr = window.devicePixelRatio || 1;
        const w = dom.zoomCanvas.width / dpr;
        const h = dom.zoomCanvas.height / dpr;
        const newScale = Math.min(Math.max(state.zoomScale * factor, ZOOM_MIN_SCALE), ZOOM_MAX_SCALE);
        const nextOffset = computeWheelZoomOffset(
            { x: w / 2, y: h / 2 },
            { width: w, height: h },
            state.zoomScale,
            newScale,
            { x: state.zoomOffsetX, y: state.zoomOffsetY }
        );
        state.zoomScale = newScale;
        state.zoomOffsetX = nextOffset.x;
        state.zoomOffsetY = nextOffset.y;
        renderZoomCanvas(dom.zoomCanvas.getContext('2d'), w, h);
    };

    dom.zoomInBtn.addEventListener('click', () => zoomAroundCenter(1.3));
    dom.zoomOutBtn.addEventListener('click', () => zoomAroundCenter(1 / 1.3));
    dom.zoomResetBtn.addEventListener('click', () => {
        state.zoomScale = 1;
        state.zoomOffsetX = 0;
        state.zoomOffsetY = 0;
        const dpr = window.devicePixelRatio || 1;
        renderZoomCanvas(dom.zoomCanvas.getContext('2d'), dom.zoomCanvas.width / dpr, dom.zoomCanvas.height / dpr);
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (state.viewMode !== 'zoom') return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => initZoomCanvas(), 120);
    });

    window.addEventListener('popstate', () => {
        applyUrlState(parseUrlParams(window.location.search));
        populateLanguageFilter();
        populateCategoryFilter();
        updateToggleButtons();
        renderFacets();
        applyFilters({ flip: false, syncUrl: false });
        if (state.desiredViewMode !== state.viewMode) {
            switchView(state.desiredViewMode, { syncUrl: false });
        }
    });
}

function init() {
    collectDom();
    state.userNotes = readUserNotes();
    applyUrlState(parseUrlParams(window.location.search));
    updateOwnerLinks();
    updateAccessModalSnippets();
    bindEvents();
    checkAIAvailability();
    initVoiceInput();
    bindZoomCanvasEvents();
    loadData();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        safeExternalUrl,
        tokenizeSearchQuery,
        matchesSearchQuery,
        scoreEntryMatch,
        highlightText,
        mergeEntryWithNote,
        computeWhatsNew,
        computeWheelZoomOffset,
        parseUrlParams,
        serializeUrlParams,
    };
}
