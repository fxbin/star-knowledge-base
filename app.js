/**
 * Star Knowledge Base 前端逻辑
 *
 * 设计原则:
 *   - Vanilla JS，零依赖，零构建步骤
 *   - 两栏工作台 + 三视图切换（高密度表格 / 卡片画廊 / 语义星图）+ 滑出式检视抽屉
 *   - 客户端全量过滤、中英文相关度排序、URL 状态同步与双主题支持
 *   - stale-while-revalidate 本地缓存秒开 + no-cache 后台拉新
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
const THEME_STORAGE_KEY = 'skb_theme_v1';
const DENSITY_STORAGE_KEY = 'skb_density_v1';
const VIEW_STORAGE_KEY = 'skb_view_v1';
const NO_LANGUAGE_VALUE = '__none__';

const SKELETON_ROW_COUNT = 8;
const SKELETON_STAGGER_MS = 35;

const FLIP_DURATION_MS = 200;
const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const TOPIC_FACET_MAX = 14;
const TOPIC_TAG_PER_ROW = 2;
const TOPIC_TAG_PER_CARD = 3;
const TOPIC_FACET_PER_ENTRY = 3;
const SIDEBAR_LANG_LIMIT = 8;
const PALETTE_RESULT_MAX = 8;

const RECENT_ACTIVE_DAYS = 90;
const STALE_REPO_DAYS = 365;
const MS_PER_DAY = 86400000;

const DEFAULT_SORT_FIELD = 'starred_at';
const DEFAULT_SORT_ORDER = 'desc';
const DEFAULT_OWNER = 'fxbin';

const LANGUAGE_COLORS = {
    Python: '#3776ab',
    JavaScript: '#eab308',
    TypeScript: '#3178c6',
    Go: '#00add8',
    Java: '#ed8b00',
    Rust: '#dea584',
    C: '#64748b',
    'C++': '#f34b7d',
    'C#': '#178600',
    Shell: '#22c55e',
    HTML: '#e34c26',
    CSS: '#6366f1',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Dart: '#00b4ab',
    Swift: '#f05138',
    Kotlin: '#a97bff',
    Scala: '#c22d40',
    Ruby: '#dc2626',
    PHP: '#6366f1',
    Lua: '#3b82f6',
    'Jupyter Notebook': '#da5b0b',
    Dockerfile: '#0ea5e9',
    HCL: '#844fba',
    SQL: '#e38c00',
    R: '#198ce7',
    Zig: '#ec915c',
    Elixir: '#8b5cf6',
    无语言: '#8c8b85',
    其他语言: '#8c8b85',
    Other: '#8c8b85',
};
const DEFAULT_LANGUAGE_COLOR = '#8c8b85';

const CATEGORY_COLORS = {
    'AI/Agent': '#0d9488',
    '后端/框架': '#3b82f6',
    '前端/UI': '#ec4899',
    '开发工具': '#f59e0b',
    '数据/存储': '#8b5cf6',
    '运维/安全': '#10b981',
    '学习/资源': '#f97316',
    '其他': '#78716c',
};

const SORT_ARROW_ASC = '<svg class="sort-arrow" width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M4 1.5l3 4.5H1z"/></svg>';
const SORT_ARROW_DESC = '<svg class="sort-arrow" width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M4 6.5L1 2h6z"/></svg>';

const STAR_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.7 7.7 8.1.1-6.5 4.8 2.4 7.7L12 18.3 5.3 22.8l2.4-7.7-6.5-4.8 8.1-.1z"/></svg>';
const PIN_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
const PIN_OUTLINE_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
const COPY_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const EXTERNAL_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
const SUN_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
const MOON_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
const CODE_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';

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
 * 格式化 Star 数量（如 44672 -> 44.7k）
 * @param {number} count
 * @returns {string}
 */
function formatStarCount(count) {
    const n = Number(count) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) {
        const k = n / 1000;
        if (k >= 100) return `${Math.round(k)}k`;
        return `${k.toFixed(1).replace(/\.0$/, '')}k`;
    }
    const m = n / 1000000;
    return `${m.toFixed(1).replace(/\.0$/, '')}m`;
}

/**
 * 格式化相对时间（今天 / 昨天 / N天前 / N个月前 / N年前）
 * @param {string} isoString
 * @param {number} nowMs
 * @returns {string}
 */
function formatRelativeTime(isoString, nowMs = Date.now()) {
    if (!isoString) return '未知';
    const ts = new Date(isoString).getTime();
    if (Number.isNaN(ts)) return '未知';
    const diffDays = Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY));
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 30) return `${diffDays}天前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
    return `${Math.floor(diffDays / 365)}年前`;
}

/**
 * 判断仓库最近推送活跃度档位
 * @param {string} isoString
 * @param {number} nowMs
 * @returns {'fresh'|'warm'|'stale'|'unknown'}
 */
function getFreshnessLevel(isoString, nowMs = Date.now()) {
    if (!isoString) return 'unknown';
    const ts = new Date(isoString).getTime();
    if (Number.isNaN(ts)) return 'unknown';
    const diffDays = Math.max(0, (nowMs - ts) / MS_PER_DAY);
    if (diffDays < RECENT_ACTIVE_DAYS) return 'fresh';
    if (diffDays < STALE_REPO_DAYS) return 'warm';
    return 'stale';
}

/**
 * 拆分 owner/repo 名称
 * @param {string} fullName
 * @returns {{owner: string, repo: string}}
 */
function splitRepoName(fullName) {
    const str = String(fullName || '').trim();
    const idx = str.indexOf('/');
    if (idx === -1) return { owner: '', repo: str };
    return {
        owner: str.slice(0, idx),
        repo: str.slice(idx + 1),
    };
}

/**
 * 为仓库名生成 2 字符字母徽标（用于卡片视图视觉识别）
 * @param {string} fullName
 * @returns {string}
 */
function getRepoMonogram(fullName) {
    const { repo } = splitRepoName(fullName);
    const cleaned = (repo || fullName || 'ST').replace(/[^a-zA-Z0-9_-]/g, '');
    const parts = cleaned.split(/[-_]+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    const base = parts[0] || cleaned || 'ST';
    return base.slice(0, 2).toUpperCase();
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
        if (/[\u4e00-\u9fff]/.test(word)) {
            if (haystack.includes(word)) return true;
            const segTokens = tokenizeSearchQuery(word);
            if (segTokens.length === 0) return true;
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
 * 计算条目与查询的相关度得分
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
    const rawView = params.get('view');
    const view = rawView === 'zoom' || rawView === 'cards' ? rawView : 'table';
    return {
        q,
        lang: params.get('lang') || '',
        cat: params.get('cat') || '',
        topic: params.get('topic') || '',
        sort,
        order: order === 'asc' ? 'asc' : 'desc',
        view,
        hideArchived: params.get('hideArchived') === '1',
        pinned: params.get('pinned') === '1',
        active90: params.get('active90') === '1',
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
    if (s.view === 'zoom' || s.view === 'cards') params.set('view', s.view);
    if (s.hideArchived) params.set('hideArchived', '1');
    if (s.pinned) params.set('pinned', '1');
    if (s.active90) params.set('active90', '1');
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

// ========== 全局状态与 DOM ==========

const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

const state = {
    allEntries: [],
    rawEntries: [],
    filteredEntries: [],
    currentPage: 1,
    languageCounts: new Map(),
    categoryCounts: new Map(),
    noLanguageCount: 0,
    archivedCount: 0,
    pinnedCount: 0,
    recentActiveCount: 0,
    langExpanded: false,
    selectedLanguage: '',
    selectedCategory: '',
    activeTopic: '',
    hideArchived: false,
    pinnedOnly: false,
    recentActiveOnly: false,
    specialFilter: '',
    specialFilterNames: new Set(),
    whatsNewChanges: null,
    inspectedKey: '',
    drawerFromZoom: false,
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
    zoomClusterBy: 'category',
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
        sidebarBackdrop: document.getElementById('sidebarBackdrop'),
        sidebar: document.getElementById('sidebar'),
        sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
        totalCount: document.getElementById('totalCount'),
        navAllBtn: document.getElementById('navAllBtn'),
        navAllCount: document.getElementById('navAllCount'),
        navPinnedBtn: document.getElementById('navPinnedBtn'),
        navPinnedCount: document.getElementById('navPinnedCount'),
        navRecentActiveBtn: document.getElementById('navRecentActiveBtn'),
        navRecentCount: document.getElementById('navRecentCount'),
        sidebarCategoriesSection: document.getElementById('sidebarCategoriesSection'),
        sidebarCategoriesList: document.getElementById('sidebarCategoriesList'),
        sidebarLanguagesList: document.getElementById('sidebarLanguagesList'),
        sidebarLangExpandBtn: document.getElementById('sidebarLangExpandBtn'),
        hideArchivedBtn: document.getElementById('hideArchivedBtn'),
        accessButton: document.getElementById('accessButton'),
        shortcutsButton: document.getElementById('shortcutsButton'),
        repoLink: document.getElementById('repoLink'),

        searchInput: document.getElementById('searchInput'),
        searchClearBtn: document.getElementById('searchClearBtn'),
        voiceBtn: document.getElementById('voiceBtn'),
        viewTableBtn: document.getElementById('viewTableBtn'),
        viewCardsBtn: document.getElementById('viewCardsBtn'),
        viewZoomBtn: document.getElementById('viewZoomBtn'),
        sortSelect: document.getElementById('sortSelect'),
        densityToggleBtn: document.getElementById('densityToggleBtn'),
        themeToggleBtn: document.getElementById('themeToggleBtn'),
        paletteTriggerBtn: document.getElementById('paletteTriggerBtn'),

        whatsNew: document.getElementById('whatsNew'),
        whatsNewBody: document.getElementById('whatsNewBody'),
        whatsNewDismiss: document.getElementById('whatsNewDismiss'),
        activeFiltersBar: document.getElementById('activeFiltersBar'),
        facetNav: document.getElementById('facetNav'),
        statsCount: document.getElementById('statsCount'),
        pageInfo: document.getElementById('pageInfo'),
        langCount: document.getElementById('langCount'),
        updateTime: document.getElementById('updateTime'),

        zoomContainer: document.getElementById('zoomContainer'),
        zoomModeCategoryBtn: document.getElementById('zoomModeCategoryBtn'),
        zoomModeLangBtn: document.getElementById('zoomModeLangBtn'),
        zoomStatsBadge: document.getElementById('zoomStatsBadge'),
        zoomScaleBadge: document.getElementById('zoomScaleBadge'),
        zoomCanvas: document.getElementById('zoomCanvas'),
        zoomEmpty: document.getElementById('zoomEmpty'),
        zoomTooltip: document.getElementById('zoomTooltip'),
        zoomInBtn: document.getElementById('zoomInBtn'),
        zoomOutBtn: document.getElementById('zoomOutBtn'),
        zoomResetBtn: document.getElementById('zoomResetBtn'),

        cardsGrid: document.getElementById('cardsGrid'),
        tableWrap: document.getElementById('tableWrap'),
        results: document.getElementById('results'),
        status: document.getElementById('status'),
        pagination: document.getElementById('pagination'),
        footerAuthorLink: document.getElementById('footerAuthorLink'),

        drawerBackdrop: document.getElementById('drawerBackdrop'),
        detailDrawer: document.getElementById('detailDrawer'),
        accessModal: document.getElementById('accessModal'),
        modalClose: document.getElementById('modalClose'),
        mcpConfigPre: document.getElementById('mcp-config'),
        skillCmdPre: document.getElementById('skill-cmd'),
        shortcutsModal: document.getElementById('shortcutsModal'),
        shortcutsClose: document.getElementById('shortcutsClose'),
        paletteOverlay: document.getElementById('paletteOverlay'),
        paletteInput: document.getElementById('paletteInput'),
        paletteList: document.getElementById('paletteList'),
        notesImportInput: document.getElementById('notesImportInput'),
        toastContainer: document.getElementById('toastContainer'),
    };
}

// ========== 主题、密度与 Toast 提示 ==========

function getCurrentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function updateThemeButton() {
    if (!dom.themeToggleBtn) return;
    const isDark = getCurrentTheme() === 'dark';
    dom.themeToggleBtn.innerHTML = isDark ? SUN_ICON_SVG : MOON_ICON_SVG;
    dom.themeToggleBtn.title = isDark ? '切换到浅色模式' : '切换到深色模式';
    dom.themeToggleBtn.setAttribute('aria-label', dom.themeToggleBtn.title);
}

function toggleTheme() {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
        // 静默忽略
    }
    updateThemeButton();
    if (state.viewMode === 'zoom') {
        const dpr = window.devicePixelRatio || 1;
        renderZoomCanvas(dom.zoomCanvas.getContext('2d'), dom.zoomCanvas.width / dpr, dom.zoomCanvas.height / dpr);
    }
    showToast(next === 'dark' ? '已切换至深色工作台' : '已切换至浅色工作台');
}

function getCurrentDensity() {
    return document.documentElement.dataset.density === 'compact' ? 'compact' : 'standard';
}

function updateDensityButton() {
    if (!dom.densityToggleBtn) return;
    const isCompact = getCurrentDensity() === 'compact';
    dom.densityToggleBtn.textContent = isCompact ? '紧凑行高' : '标准行高';
}

function toggleDensity() {
    const next = getCurrentDensity() === 'compact' ? 'standard' : 'compact';
    document.documentElement.dataset.density = next;
    try {
        localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
        // 静默忽略
    }
    updateDensityButton();
    showToast(next === 'compact' ? '已切换为紧凑密度 (30px)' : '已切换为标准密度 (40px)');
}

function showToast(message, type = 'info') {
    if (!dom.toastContainer || !message) return;
    const toast = document.createElement('div');
    toast.className = `toast${type === 'success' ? ' success' : type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 160);
    }, 2200);
}

// ========== 侧边栏移动端抽屉 ==========

function openSidebar() {
    dom.sidebar.classList.add('open');
    dom.sidebarBackdrop.classList.add('active');
}

function closeSidebar() {
    dom.sidebar.classList.remove('open');
    dom.sidebarBackdrop.classList.remove('active');
}

// ========== 数据加载与缓存 ==========

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
        // 静默忽略
    }
}

function readVisitSnapshot() {
    try {
        const raw = localStorage.getItem(VISIT_SNAPSHOT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.stars ? parsed : null;
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
        localStorage.setItem(VISIT_SNAPSHOT_KEY, JSON.stringify({ stars, timestamp: Date.now() }));
    } catch {
        // 静默忽略
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
    renderSidebar();
    renderFacets();
}

function recomputeDatasetStats() {
    const langCounts = new Map();
    const catCounts = new Map();
    let noLang = 0;
    let archived = 0;
    let pinned = 0;
    let recentActive = 0;
    const nowMs = Date.now();

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
        if (getFreshnessLevel(entry.pushed_at, nowMs) === 'fresh') recentActive++;
    }

    state.languageCounts = langCounts;
    state.categoryCounts = catCounts;
    state.noLanguageCount = noLang;
    state.archivedCount = archived;
    state.pinnedCount = pinned;
    state.recentActiveCount = recentActive;
    if (catCounts.size === 0 && state.zoomClusterBy === 'category') {
        state.zoomClusterBy = 'language';
    }
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

    if (state.desiredViewMode !== state.viewMode) {
        const nextView = state.desiredViewMode;
        state.desiredViewMode = 'table';
        switchView(nextView, { syncUrl: false });
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
                        env: { STAR_DATA_URL: dataJsonUrl },
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
                `<td class="td-updated-cell" style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block updated"></div></td>` +
                `<td class="td-score-cell" style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block score"></div></td>` +
                `<td class="td-topics-cell" style="--skeleton-delay: ${i * SKELETON_STAGGER_MS}ms"><div class="skeleton-block topics"></div></td>` +
            `</tr>`
        );
    }
    dom.results.innerHTML = rows.join('');
    dom.pagination.style.display = 'none';
    dom.statsCount.textContent = '…';
}

function updateHeaderStats(data) {
    dom.totalCount.textContent = data.total || state.allEntries.length;
    dom.langCount.textContent = state.languageCounts.size;
    if (data.generated_at) {
        const date = new Date(data.generated_at);
        dom.updateTime.textContent = Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN');
    }
}

// ========== 侧边栏与分面渲染 ==========

function renderSidebar() {
    dom.navAllCount.textContent = state.allEntries.length;
    dom.navPinnedCount.textContent = state.pinnedCount;
    dom.navRecentCount.textContent = state.recentActiveCount;

    const isAllMode =
        !state.pinnedOnly &&
        !state.recentActiveOnly &&
        !state.selectedCategory &&
        !state.selectedLanguage;
    dom.navAllBtn.classList.toggle('active', isAllMode);
    dom.navPinnedBtn.classList.toggle('active', state.pinnedOnly);
    dom.navRecentActiveBtn.classList.toggle('active', state.recentActiveOnly);

    // 分类目录
    if (state.categoryCounts.size === 0) {
        dom.sidebarCategoriesSection.style.display = 'none';
    } else {
        dom.sidebarCategoriesSection.style.display = '';
        const sortedCats = Array.from(state.categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
        dom.sidebarCategoriesList.innerHTML = sortedCats
            .map(([cat, count]) => {
                const color = CATEGORY_COLORS[cat] || DEFAULT_LANGUAGE_COLOR;
                const active = state.selectedCategory === cat ? ' active' : '';
                return (
                    `<button type="button" class="sidebar-item${active}" data-sidebar-category="${escapeHtml(cat)}">` +
                        `<span class="sidebar-item-left">` +
                            `<span class="lang-dot" style="background-color:${color}"></span>` +
                            `<span class="sidebar-item-label">${escapeHtml(cat)}</span>` +
                        `</span>` +
                        `<span class="sidebar-item-count">${count}</span>` +
                    `</button>`
                );
            })
            .join('');
    }

    // 编程语言
    const sortedLangs = Array.from(state.languageCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (state.noLanguageCount > 0) {
        sortedLangs.push([NO_LANGUAGE_VALUE, state.noLanguageCount]);
    }

    let visibleLangs = state.langExpanded ? sortedLangs : sortedLangs.slice(0, SIDEBAR_LANG_LIMIT);
    if (!state.langExpanded && state.selectedLanguage) {
        const hasSelected = visibleLangs.some(([lang]) => lang === state.selectedLanguage);
        if (!hasSelected) {
            const found = sortedLangs.find(([lang]) => lang === state.selectedLanguage);
            if (found) visibleLangs = [...visibleLangs, found];
        }
    }

    dom.sidebarLanguagesList.innerHTML = visibleLangs
        .map(([lang, count]) => {
            const label = lang === NO_LANGUAGE_VALUE ? '无语言 / 文档' : lang;
            const color = lang === NO_LANGUAGE_VALUE ? DEFAULT_LANGUAGE_COLOR : getLanguageColor(lang);
            const active = state.selectedLanguage === lang ? ' active' : '';
            return (
                `<button type="button" class="sidebar-item${active}" data-sidebar-language="${escapeHtml(lang)}">` +
                    `<span class="sidebar-item-left">` +
                        `<span class="lang-dot" style="background-color:${color}"></span>` +
                        `<span class="sidebar-item-label">${escapeHtml(label)}</span>` +
                    `</span>` +
                    `<span class="sidebar-item-count">${count}</span>` +
                `</button>`
            );
        })
        .join('');

    if (sortedLangs.length > SIDEBAR_LANG_LIMIT) {
        dom.sidebarLangExpandBtn.style.display = '';
        dom.sidebarLangExpandBtn.textContent = state.langExpanded
            ? '收起语言列表'
            : `展开全部语言 (${sortedLangs.length})`;
    } else {
        dom.sidebarLangExpandBtn.style.display = 'none';
    }

    // 隐藏已归档开关
    dom.hideArchivedBtn.style.display = state.archivedCount > 0 ? 'flex' : 'none';
    dom.hideArchivedBtn.classList.toggle('active', state.hideArchived);
    dom.hideArchivedBtn.setAttribute('aria-pressed', String(state.hideArchived));
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
                `<span class="facet-chip-name">全部 Topic</span>` +
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

function renderActiveFilters() {
    const chips = [];
    const q = dom.searchInput.value.trim();

    if (q) {
        chips.push({ key: 'q', label: `搜索: ${q}` });
    }
    if (state.selectedCategory) {
        chips.push({ key: 'cat', label: `分类: ${state.selectedCategory}` });
    }
    if (state.selectedLanguage) {
        const langLabel = state.selectedLanguage === NO_LANGUAGE_VALUE ? '无语言 / 文档' : state.selectedLanguage;
        chips.push({ key: 'lang', label: `语言: ${langLabel}` });
    }
    if (state.activeTopic) {
        chips.push({ key: 'topic', label: `Topic: #${state.activeTopic}` });
    }
    if (state.pinnedOnly) {
        chips.push({ key: 'pinned', label: '仅看已置顶' });
    }
    if (state.recentActiveOnly) {
        chips.push({ key: 'active90', label: '近期活跃 (90天)' });
    }
    if (state.hideArchived) {
        chips.push({ key: 'hideArchived', label: '已隐藏归档' });
    }
    if (state.specialFilter) {
        const label = state.specialFilter === 'new'
            ? `新增项目 (${state.specialFilterNames.size})`
            : `Star 增长 (${state.specialFilterNames.size})`;
        chips.push({ key: 'special', label });
    }

    if (chips.length === 0) {
        dom.activeFiltersBar.classList.remove('visible');
        dom.activeFiltersBar.innerHTML = '';
        return;
    }

    dom.activeFiltersBar.classList.add('visible');
    dom.activeFiltersBar.innerHTML =
        chips
            .map(
                c =>
                    `<span class="active-filter-chip">` +
                        `<span>${escapeHtml(c.label)}</span>` +
                        `<button type="button" class="active-filter-remove" data-clear-filter="${escapeHtml(c.key)}" aria-label="移除筛选">×</button>` +
                    `</span>`
            )
            .join('') +
        `<button type="button" class="active-filters-reset" data-clear-filter="all">清除全部</button>`;
}

// ========== 过滤、排序与 URL 同步 ==========

function syncSortSelect() {
    const val = `${state.sortField}:${state.sortOrder}`;
    if (Array.from(dom.sortSelect.options).some(o => o.value === val)) {
        dom.sortSelect.value = val;
    }
}

function updateSearchClearBtn() {
    dom.searchClearBtn.classList.toggle('visible', dom.searchInput.value.length > 0);
}

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
        active90: state.recentActiveOnly,
    });
    const newUrl = window.location.pathname + qs + window.location.hash;
    window.history.replaceState(null, '', newUrl);
}

function applyFilters(options = { flip: true, syncUrl: true }) {
    const query = dom.searchInput.value.trim();
    updateSearchClearBtn();

    let filtered = state.allEntries.slice();

    if (state.specialFilter && state.specialFilterNames.size > 0) {
        filtered = filtered.filter(entry => state.specialFilterNames.has(entry.full_name));
    }

    if (state.activeTopic) {
        filtered = filtered.filter(entry => (entry.topics || []).includes(state.activeTopic));
    }

    if (state.selectedLanguage) {
        if (state.selectedLanguage === NO_LANGUAGE_VALUE) {
            filtered = filtered.filter(entry => !entry.language);
        } else {
            filtered = filtered.filter(entry => entry.language === state.selectedLanguage);
        }
    }

    if (state.selectedCategory) {
        filtered = filtered.filter(entry => entry.category === state.selectedCategory);
    }

    if (state.hideArchived) {
        filtered = filtered.filter(entry => !entry.archived);
    }

    if (state.pinnedOnly) {
        filtered = filtered.filter(entry => Boolean(entry.pinned));
    }

    if (state.recentActiveOnly) {
        const nowMs = Date.now();
        filtered = filtered.filter(entry => getFreshnessLevel(entry.pushed_at, nowMs) === 'fresh');
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
    syncSortSelect();
    renderSidebar();
    renderActiveFilters();

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

// ========== 视图渲染（表格 / 卡片 / 分页） ==========

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
    dom.pageInfo.textContent = total > 0 ? `· 第 ${state.currentPage}/${totalPages} 页` : '';

    updateSortIndicators();

    if (total === 0) {
        dom.results.innerHTML = '';
        dom.cardsGrid.innerHTML = '';
        showStatus('没有匹配的项目。试试调整左侧筛选或清除关键词。');
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
    const nowMs = Date.now();

    if (state.viewMode === 'cards') {
        dom.cardsGrid.innerHTML = pageEntries
            .map(entry => entryToCardHtml(entry, highlightTokens, nowMs))
            .join('');

        if (options.fade && !prefersReducedMotion) {
            dom.cardsGrid.classList.add('fading');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => dom.cardsGrid.classList.remove('fading'));
            });
        }
    } else {
        const shouldFlip = options.flip && !prefersReducedMotion;
        const oldPositions = shouldFlip ? captureRowPositions() : null;

        dom.results.innerHTML = pageEntries
            .map(entry => entryToRowHtml(entry, maxStars, highlightTokens, nowMs))
            .join('');

        if (shouldFlip) {
            playFlipAnimation(oldPositions);
        }

        if (options.fade && !prefersReducedMotion) {
            dom.tableWrap.classList.add('fading');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => dom.tableWrap.classList.remove('fading'));
            });
        }
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

function renderSplitRepoTitle(fullName, highlightTokens) {
    const { owner, repo } = splitRepoName(fullName);
    if (!owner) {
        return `<span class="repo-name">${highlightText(repo, highlightTokens)}</span>`;
    }
    return (
        `<span class="repo-owner">${escapeHtml(owner)}</span>` +
        `<span class="repo-sep">/</span>` +
        `<span class="repo-name">${highlightText(repo, highlightTokens)}</span>`
    );
}

function buildScoreDotsHtml(score) {
    const s = Math.max(0, Math.min(SCORE_DOT_COUNT, Math.round(score || 0)));
    const scoreClass = s >= HIGH_SCORE_THRESHOLD ? 'high' : s >= LOW_SCORE_THRESHOLD ? 'mid' : 'low';
    const dots = [];
    for (let i = 0; i < SCORE_DOT_COUNT; i++) {
        dots.push(`<span class="score-dot${i < s ? ' filled' : ''}"></span>`);
    }
    return { scoreClass, html: `<span class="score-dots ${scoreClass}">${dots.join('')}</span>`, score: s };
}

function entryToRowHtml(entry, maxStars, highlightTokens, nowMs) {
    const { html: dotsHtml, score } = buildScoreDotsHtml(entry.quality_score);
    const stars = entry.stargazers_count || 0;
    const starsPct = Math.max(Math.round((stars / maxStars) * 100), 2);
    const topics = (entry.topics || []).slice(0, TOPIC_TAG_PER_ROW);
    const moreCount = (entry.topics || []).length - topics.length;
    const safeHref = safeExternalUrl(entry.html_url) || '#';
    const cloneCmd = safeHref !== '#' ? `git clone ${safeHref}.git` : '';

    const pinBadge = entry.pinned ? `<span class="badge-pinned" title="已置顶">${PIN_ICON_SVG}</span>` : '';
    const archivedBadge = entry.archived ? `<span class="badge-archived">归档</span>` : '';
    const noteDot = entry.note ? `<span class="cell-note-dot" title="备注: ${escapeHtml(entry.note)}"></span>` : '';
    const preview = entry.summary || entry.description || '';

    const relUpdated = formatRelativeTime(entry.pushed_at, nowMs);
    const freshness = getFreshnessLevel(entry.pushed_at, nowMs);
    const isInspected = state.inspectedKey === entry.full_name ? ' active-detail' : '';

    return (
        `<tr class="data-row${isInspected}" data-key="${escapeHtml(entry.full_name)}" tabindex="0">` +
            `<td><span class="cell-name">` +
                pinBadge +
                `<a class="repo-link" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${renderSplitRepoTitle(entry.full_name, highlightTokens)}</a>` +
                archivedBadge +
                noteDot +
                `<span class="cell-desc">${highlightText(preview, highlightTokens)}</span>` +
            `</span></td>` +
            `<td>${entry.language
                ? `<span class="cell-lang"><span class="lang-dot" style="background-color: ${getLanguageColor(entry.language)}"></span>${escapeHtml(entry.language)}</span>`
                : '<span class="cell-lang">—</span>'}</td>` +
            `<td title="${stars.toLocaleString()} stars"><span class="cell-stars">` +
                `<span class="cell-stars-num">${formatStarCount(stars)}</span>` +
                `<span class="stars-bar"><span class="stars-bar-fill" style="width: ${starsPct}%"></span></span>` +
            `</span></td>` +
            `<td class="td-updated-cell" title="${escapeHtml(formatDate(entry.pushed_at))}"><span class="cell-updated">` +
                `<span class="freshness-dot ${freshness}"></span>` +
                `<span>${escapeHtml(relUpdated)}</span>` +
            `</span></td>` +
            `<td class="td-score-cell"><span class="cell-score">` +
                dotsHtml +
                `<span class="cell-score-num">${score}</span>` +
            `</span></td>` +
            `<td class="td-topics-cell">` +
                `<span class="cell-topics">` +
                    topics.map(topic => `<button type="button" class="tag clickable" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('') +
                    (moreCount > 0 ? `<span class="tag-more">+${moreCount}</span>` : '') +
                `</span>` +
                `<span class="row-quick-actions">` +
                    `<button type="button" class="quick-icon-btn pin-toggle-btn${entry.pinned ? ' pinned' : ''}" data-repo="${escapeHtml(entry.full_name)}" title="${entry.pinned ? '取消置顶 (p)' : '置顶 (p)'}" aria-label="置顶">${entry.pinned ? PIN_ICON_SVG : PIN_OUTLINE_SVG}</button>` +
                    (cloneCmd ? `<button type="button" class="quick-icon-btn copy-clone-btn" data-clone="${escapeHtml(cloneCmd)}" title="复制 git clone (c)" aria-label="复制 clone">${COPY_ICON_SVG}</button>` : '') +
                    `<a class="quick-icon-btn" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener" title="在 GitHub 打开 (o)" aria-label="GitHub">${EXTERNAL_ICON_SVG}</a>` +
                `</span>` +
            `</td>` +
        `</tr>`
    );
}

function entryToCardHtml(entry, highlightTokens, nowMs) {
    const safeHref = safeExternalUrl(entry.html_url) || '#';
    const cloneCmd = safeHref !== '#' ? `git clone ${safeHref}.git` : '';
    const langColor = getLanguageColor(entry.language);
    const monogram = getRepoMonogram(entry.full_name);
    const summaryText = entry.summary || entry.description || '（暂无简介）';
    const relUpdated = formatRelativeTime(entry.pushed_at, nowMs);
    const freshness = getFreshnessLevel(entry.pushed_at, nowMs);
    const { html: dotsHtml } = buildScoreDotsHtml(entry.quality_score);
    const topics = (entry.topics || []).slice(0, TOPIC_TAG_PER_CARD);
    const moreCount = (entry.topics || []).length - topics.length;
    const isInspected = state.inspectedKey === entry.full_name ? ' active-detail' : '';

    return (
        `<article class="repo-card${isInspected}" data-key="${escapeHtml(entry.full_name)}" tabindex="0">` +
            `<div class="card-header">` +
                `<div class="card-identity">` +
                    `<div class="repo-monogram" style="background-color:${langColor}1a; color:${langColor}; border-color:${langColor}38;">${escapeHtml(monogram)}</div>` +
                    `<div class="card-title-group">` +
                        `<a class="card-repo-link" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${renderSplitRepoTitle(entry.full_name, highlightTokens)}</a>` +
                        `<div class="card-sub-meta">` +
                            `<span>${escapeHtml(entry.language || '文档 / 无语言')}</span>` +
                            (entry.archived ? `<span class="badge-archived">已归档</span>` : '') +
                        `</div>` +
                    `</div>` +
                `</div>` +
                `<button type="button" class="card-pin-btn pin-toggle-btn${entry.pinned ? ' pinned' : ''}" data-repo="${escapeHtml(entry.full_name)}" title="${entry.pinned ? '取消置顶' : '置顶收藏'}" aria-label="置顶">${entry.pinned ? PIN_ICON_SVG : PIN_OUTLINE_SVG}</button>` +
            `</div>` +
            `<p class="card-summary">${highlightText(summaryText, highlightTokens)}</p>` +
            (entry.note ? `<div class="card-note-pill" title="${escapeHtml(entry.note)}">备注：${highlightText(entry.note, highlightTokens)}</div>` : '') +
            `<div class="card-tags">` +
                (entry.category ? `<button type="button" class="tag category-tag clickable" data-category="${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</button>` : '') +
                topics.map(t => `<button type="button" class="tag clickable" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('') +
                (moreCount > 0 ? `<span class="tag-more">+${moreCount}</span>` : '') +
            `</div>` +
            `<div class="card-footer">` +
                `<div class="card-metrics">` +
                    `<span class="card-metric-item" title="${(entry.stargazers_count || 0).toLocaleString()} stars">${STAR_ICON_SVG} ${formatStarCount(entry.stargazers_count || 0)}</span>` +
                    `<span class="card-metric-item" title="最近推送 ${escapeHtml(formatDate(entry.pushed_at))}"><span class="freshness-dot ${freshness}"></span> ${escapeHtml(relUpdated)}</span>` +
                    `<span class="card-metric-item">${dotsHtml}</span>` +
                `</div>` +
                `<div class="card-actions">` +
                    (cloneCmd ? `<button type="button" class="quick-icon-btn copy-clone-btn" data-clone="${escapeHtml(cloneCmd)}" title="复制 git clone" aria-label="复制 clone">${COPY_ICON_SVG}</button>` : '') +
                    `<a class="quick-icon-btn" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener" title="在 GitHub 打开" aria-label="GitHub">${EXTERNAL_ICON_SVG}</a>` +
                `</div>` +
            `</div>` +
        `</article>`
    );
}

// ========== 右侧滑出式检视抽屉（Inspector Drawer） ==========

function openDrawer(key, options = {}) {
    const entry = state.allEntries.find(item => item.full_name === key);
    if (!entry) return;

    state.inspectedKey = key;
    state.drawerFromZoom = Boolean(options.fromZoom);
    renderDrawer(entry);
    dom.detailDrawer.classList.add('open');
    dom.drawerBackdrop.classList.add('active');
    syncActiveItemHighlight();
}

function closeDrawer() {
    state.inspectedKey = '';
    state.drawerFromZoom = false;
    dom.detailDrawer.classList.remove('open');
    dom.drawerBackdrop.classList.remove('active');
    syncActiveItemHighlight();
}

function syncActiveItemHighlight() {
    dom.results.querySelectorAll('tr.data-row').forEach(row => {
        row.classList.toggle('active-detail', row.dataset.key === state.inspectedKey);
    });
    dom.cardsGrid.querySelectorAll('.repo-card').forEach(card => {
        card.classList.toggle('active-detail', card.dataset.key === state.inspectedKey);
    });
}

function renderDrawer(entry) {
    const query = dom.searchInput.value.trim();
    const highlightTokens = query ? tokenizeSearchQuery(query) : [];
    const safeHref = safeExternalUrl(entry.html_url);
    const homepageUrl = safeExternalUrl(entry.homepage);
    const deepwikiUrl = safeExternalUrl(entry.deepwiki_url);
    const zreadUrl = safeExternalUrl(entry.zread_url);
    const cloneCmd = safeHref ? `git clone ${safeHref}.git` : '';
    const langColor = getLanguageColor(entry.language);
    const monogram = getRepoMonogram(entry.full_name);

    const idx = state.filteredEntries.findIndex(e => e.full_name === entry.full_name);
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < state.filteredEntries.length - 1;

    const { html: dotsHtml, score } = buildScoreDotsHtml(entry.quality_score);
    const relUpdated = formatRelativeTime(entry.pushed_at);
    const freshness = getFreshnessLevel(entry.pushed_at);

    const summaryText = (entry.summary || '').trim();
    const descText = (entry.description || '').trim();
    const showDescSeparately = descText && descText !== summaryText;

    const categoryBadge = entry.category
        ? `<button type="button" class="tag category-tag clickable" data-category="${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</button>`
        : '';
    const topics = (entry.topics || [])
        .map(t => `<button type="button" class="tag clickable" data-topic="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
        .join('');
    const useCases = (entry.use_cases || [])
        .map(u => `<button type="button" class="tag use-case clickable" data-usecase="${escapeHtml(u)}">${escapeHtml(u)}</button>`)
        .join('');

    const aiButton = state.aiAvailability === 'available'
        ? `<button type="button" class="ai-summary-btn" data-repo="${escapeHtml(entry.full_name)}">` +
            `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"></path></svg>` +
            `使用浏览器内置 AI 深度分析` +
          `</button>`
        : state.aiAvailability === 'downloadable'
            ? `<span class="ai-summary-fallback">浏览器内置 AI 模型未就绪</span>`
            : '';

    dom.detailDrawer.innerHTML =
        `<div class="drawer-header">` +
            `<div class="drawer-title-wrap">` +
                `<div class="repo-monogram" style="background-color:${langColor}1a; color:${langColor}; border-color:${langColor}38;">${escapeHtml(monogram)}</div>` +
                `<div style="min-width:0;">` +
                    `<a class="drawer-repo-link" href="${escapeHtml(safeHref || '#')}" target="_blank" rel="noopener">${renderSplitRepoTitle(entry.full_name, highlightTokens)}</a>` +
                    `<div class="drawer-badges">` +
                        (entry.language ? `<span class="tag"><span class="lang-dot" style="display:inline-block;margin-right:4px;background-color:${langColor}"></span>${escapeHtml(entry.language)}</span>` : `<span class="tag">无主语言</span>`) +
                        (entry.archived ? `<span class="badge-archived">已归档</span>` : '') +
                    `</div>` +
                `</div>` +
            `</div>` +
            `<div class="drawer-header-actions">` +
                `<button type="button" class="drawer-icon-btn" data-drawer-nav="-1" ${hasPrev ? '' : 'disabled'} title="上一个项目 (k)" aria-label="上一个">↑</button>` +
                `<button type="button" class="drawer-icon-btn" data-drawer-nav="1" ${hasNext ? '' : 'disabled'} title="下一个项目 (j)" aria-label="下一个">↓</button>` +
                `<button type="button" class="drawer-icon-btn pin-toggle-btn${entry.pinned ? ' pinned' : ''}" data-repo="${escapeHtml(entry.full_name)}" title="${entry.pinned ? '取消置顶 (p)' : '置顶 (p)'}" aria-label="置顶">${entry.pinned ? PIN_ICON_SVG : PIN_OUTLINE_SVG}</button>` +
                `<button type="button" class="drawer-icon-btn" data-drawer-close="1" title="关闭 (Esc)" aria-label="关闭">×</button>` +
            `</div>` +
        `</div>` +
        `<div class="drawer-body">` +
            `<div class="drawer-metrics-grid">` +
                `<div class="drawer-metric-tile"><div class="drawer-metric-label">Stars</div><div class="drawer-metric-value">${STAR_ICON_SVG} ${(entry.stargazers_count || 0).toLocaleString()}</div></div>` +
                `<div class="drawer-metric-tile"><div class="drawer-metric-label">最近更新</div><div class="drawer-metric-value"><span class="freshness-dot ${freshness}"></span> ${escapeHtml(relUpdated)}</div></div>` +
                `<div class="drawer-metric-tile"><div class="drawer-metric-label">质量评分</div><div class="drawer-metric-value">${dotsHtml} <span>${score}/5</span></div></div>` +
                `<div class="drawer-metric-tile"><div class="drawer-metric-label">Forks</div><div class="drawer-metric-value">${(entry.forks_count || 0).toLocaleString()}</div></div>` +
            `</div>` +
            `<div class="drawer-meta-strip">` +
                `<span>推送日期 ${escapeHtml(formatDate(entry.pushed_at))}</span>` +
                `<span>Star 日期 ${escapeHtml(formatDate(entry.starred_at))}</span>` +
                (entry.license ? `<span>协议 ${escapeHtml(entry.license)}</span>` : '') +
            `</div>` +
            (summaryText
                ? `<div><div class="drawer-section-label">摘要</div><div class="drawer-summary-box">${highlightText(summaryText, highlightTokens)}</div></div>`
                : '') +
            (showDescSeparately
                ? `<div><div class="drawer-section-label">原始描述</div><p class="drawer-desc">${highlightText(descText, highlightTokens)}</p></div>`
                : (!summaryText ? `<p class="drawer-desc">（暂无描述）</p>` : '')) +
            (aiButton ? `<div class="ai-summary-area">${aiButton}</div>` : '') +
            ((categoryBadge || topics || useCases)
                ? `<div><div class="drawer-section-label">标签与场景（点击可筛选）</div><div class="drawer-tags">${categoryBadge}${topics}${useCases}</div></div>`
                : '') +
            `<div><div class="drawer-section-label">快捷操作</div><div class="drawer-actions">` +
                (safeHref ? `<a class="action-button primary" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener">${CODE_ICON_SVG}GitHub 源码</a>` : '') +
                (homepageUrl ? `<a class="action-button" href="${escapeHtml(homepageUrl)}" target="_blank" rel="noopener">官网</a>` : '') +
                (deepwikiUrl ? `<a class="action-button deepwiki" href="${escapeHtml(deepwikiUrl)}" target="_blank" rel="noopener">DeepWiki</a>` : '') +
                (zreadUrl ? `<a class="action-button zread" href="${escapeHtml(zreadUrl)}" target="_blank" rel="noopener">Zread</a>` : '') +
                (cloneCmd ? `<button type="button" class="action-button copy-clone-btn" data-clone="${escapeHtml(cloneCmd)}">复制 clone</button>` : '') +
                `<button type="button" class="action-button copy-name-btn" data-name="${escapeHtml(entry.full_name)}">复制名称</button>` +
                (state.drawerFromZoom ? `<button type="button" class="action-button" data-locate-table="${escapeHtml(entry.full_name)}">在表格中定位</button>` : '') +
            `</div></div>` +
            `<div class="note-editor-card">` +
                `<div class="drawer-section-label" style="margin-bottom:0;">个人备注</div>` +
                `<input type="text" class="note-input" data-repo="${escapeHtml(entry.full_name)}" value="${escapeHtml(entry.note || '')}" placeholder="记录为什么 star 它、踩坑或用途（Enter 保存）">` +
                `<div class="note-editor-footer">` +
                    `<span class="note-hint">保存在本地，可通过 ⌘K 导出 notes.json</span>` +
                    `<button type="button" class="action-button note-save-btn" data-repo="${escapeHtml(entry.full_name)}">保存备注</button>` +
                `</div>` +
            `</div>` +
        `</div>`;
}

function locateInTable(fullName) {
    const entryIndex = state.filteredEntries.findIndex(item => item.full_name === fullName);
    if (entryIndex < 0) return;
    switchView('table');
    state.currentPage = Math.floor(entryIndex / PAGE_SIZE) + 1;
    renderResults({ flip: false });
    state.drawerFromZoom = false;
    syncActiveItemHighlight();
    const row = dom.results.querySelector(`tr.data-row[data-key="${cssEscape(fullName)}"]`);
    if (row) {
        row.scrollIntoView({ block: 'center' });
        row.focus({ preventScroll: true });
    }
}

// ========== 分页控件 ==========

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
    renderResults({ fade: true });
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
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

function updatePersonalNote(fullName, patch, toastMessage = '') {
    const current = state.userNotes[fullName] || {};
    state.userNotes[fullName] = { ...current, ...patch };
    writeUserNotes(state.userNotes);

    rebuildEntriesWithNotes();
    applyFilters({ flip: false, syncUrl: false });

    if (state.inspectedKey === fullName) {
        const updated = state.allEntries.find(e => e.full_name === fullName);
        if (updated) renderDrawer(updated);
    }
    if (toastMessage) {
        showToast(toastMessage, 'success');
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
    showToast(`已导出 ${Object.keys(payload).length} 条个人置顶与备注`, 'success');
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
            let importedCount = 0;
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'string') {
                    nextNotes[key] = { pinned: false, note: value };
                    importedCount++;
                } else if (value && typeof value === 'object') {
                    nextNotes[key] = {
                        pinned: Boolean(value.pinned),
                        note: String(value.note || ''),
                    };
                    importedCount++;
                }
            }
            state.userNotes = nextNotes;
            writeUserNotes(state.userNotes);
            rebuildEntriesWithNotes();
            applyFilters({ flip: false });
            showToast(`已导入 ${importedCount} 条备注与置顶`, 'success');
        } catch {
            showToast('导入 notes.json 失败：请确认格式合法', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ========== 剪贴板与 Modal ==========

function copyTextWithFeedback(text, button, toastMsg = '已复制到剪贴板') {
    const done = () => {
        if (button) {
            const original = button.textContent;
            if (original && original.trim().length > 0 && !button.classList.contains('quick-icon-btn')) {
                button.textContent = '已复制';
                setTimeout(() => {
                    button.textContent = original;
                }, 1400);
            }
            button.classList.add('copied');
            setTimeout(() => button.classList.remove('copied'), 1400);
        }
        showToast(toastMsg, 'success');
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
        navigator.clipboard.writeText(text).then(done).catch(() => {
            copyFallback();
            done();
        });
    } else {
        copyFallback();
        done();
    }
}

function openModal(overlay) {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function copyCodeBlock(button) {
    const targetId = button.getAttribute('data-copy-target');
    const codeEl = document.getElementById(targetId);
    if (!codeEl) return;
    copyTextWithFeedback(codeEl.textContent, button, '配置已复制到剪贴板');
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
        || state.recentActiveOnly
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

    commands.push({
        id: 'toggle-theme',
        title: getCurrentTheme() === 'dark' ? '切换为浅色主题' : '切换为深色主题',
        hint: 'Theme',
        action: toggleTheme,
    });
    commands.push({
        id: 'toggle-density',
        title: getCurrentDensity() === 'compact' ? '切换为标准表格密度' : '切换为紧凑表格密度',
        hint: 'Density',
        action: toggleDensity,
    });
    commands.push({
        id: 'view-table',
        title: '切换到高密度表格视图',
        hint: state.viewMode === 'table' ? '当前' : '',
        action: () => switchView('table'),
    });
    commands.push({
        id: 'view-cards',
        title: '切换到卡片画廊视图',
        hint: state.viewMode === 'cards' ? '当前' : '',
        action: () => switchView('cards'),
    });
    commands.push({
        id: 'view-zoom',
        title: '切换到语义星图视图',
        hint: state.viewMode === 'zoom' ? '当前' : '',
        action: () => switchView('zoom'),
    });

    if (state.viewMode === 'zoom') {
        commands.push({
            id: 'zoom-cluster-toggle',
            title: state.zoomClusterBy === 'category' ? '星图切换为按语言聚类' : '星图切换为按分类聚类',
            hint: '',
            action: () => setZoomClusterMode(state.zoomClusterBy === 'category' ? 'language' : 'category'),
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
        id: 'sort-pushed',
        title: '排序：最近更新',
        hint: state.sortField === 'pushed_at' ? '当前' : '',
        action: () => setSort('pushed_at', 'desc'),
    });
    commands.push({
        id: 'sort-score',
        title: '排序：质量评分（高→低）',
        hint: state.sortField === 'quality_score' ? '当前' : '',
        action: () => setSort('quality_score', 'desc'),
    });

    if (state.archivedCount > 0) {
        commands.push({
            id: 'toggle-archived',
            title: state.hideArchived ? '显示已归档项目' : '隐藏已归档项目',
            hint: `${state.archivedCount}`,
            action: () => {
                state.hideArchived = !state.hideArchived;
                applyFilters();
            },
        });
    }

    if (state.pinnedCount > 0) {
        commands.push({
            id: 'toggle-pinned',
            title: state.pinnedOnly ? '查看全部项目' : '仅看已置顶项目',
            hint: `${state.pinnedCount}`,
            action: () => {
                state.pinnedOnly = !state.pinnedOnly;
                state.recentActiveOnly = false;
                applyFilters();
            },
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
        id: 'open-shortcuts',
        title: '查看键盘快捷键速查',
        hint: '?',
        action: () => openModal(dom.shortcutsModal),
    });
    commands.push({
        id: 'open-access',
        title: '打开 Agent / MCP 接入说明',
        hint: '',
        action: () => openModal(dom.accessModal),
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
}

function resetAll() {
    dom.searchInput.value = '';
    state.selectedLanguage = '';
    state.selectedCategory = '';
    state.activeTopic = '';
    state.hideArchived = false;
    state.pinnedOnly = false;
    state.recentActiveOnly = false;
    state.manualSortDuringQuery = false;
    state.preSearchSort = null;
    clearBannerFilter();
    state.sortField = DEFAULT_SORT_FIELD;
    state.sortOrder = DEFAULT_SORT_ORDER;
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
        sub: '',
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
                fullName: entry.full_name,
                title: entry.full_name,
                sub: entry.summary || entry.description || '',
                hint: `${entry.language ? entry.language + ' · ' : ''}★ ${formatStarCount(entry.stargazers_count || 0)}`,
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
    let commandHeaderShown = false;
    items.forEach((item, index) => {
        if (item.kind === 'command' && !commandHeaderShown && normalized && items.some(i => i.kind === 'entry')) {
            html.push('<div class="palette-section">命令</div>');
            commandHeaderShown = true;
        }
        if (item.kind === 'entry' && !entryHeaderShown && normalized) {
            html.push('<div class="palette-section">项目（Enter 打开详情 · ⌘Enter 打开 GitHub）</div>');
            entryHeaderShown = true;
        }
        html.push(
            `<div class="palette-item${index === state.paletteIndex ? ' active' : ''}" data-index="${index}">` +
                `<div class="palette-item-main">` +
                    `<span class="palette-item-title">${escapeHtml(item.title)}</span>` +
                    (item.sub ? `<span class="palette-item-sub">${escapeHtml(item.sub)}</span>` : '') +
                `</div>` +
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

function executePaletteSelection(openExternal = false) {
    const item = state.paletteItems[state.paletteIndex];
    if (!item) return;
    closePalette();
    if (item.kind === 'entry') {
        if (openExternal && item.url) {
            window.open(item.url, '_blank', 'noopener');
        } else {
            openDrawer(item.fullName, { fromZoom: state.viewMode === 'zoom' });
        }
    } else {
        item.action();
    }
}

// ========== 键盘导航 ==========

function getActiveListItems() {
    if (state.viewMode === 'cards') {
        return Array.from(dom.cardsGrid.querySelectorAll('.repo-card'));
    }
    return Array.from(dom.results.querySelectorAll('tr.data-row'));
}

function moveSelection(delta) {
    const items = getActiveListItems();
    if (items.length === 0) return;

    state.selectedIndex = Math.min(Math.max(state.selectedIndex + delta, 0), items.length - 1);
    items.forEach((el, index) => {
        el.classList.toggle('selected', index === state.selectedIndex);
    });
    const selectedEl = items[state.selectedIndex];
    selectedEl.focus({ preventScroll: true });
    selectedEl.scrollIntoView({ block: 'nearest' });

    if (dom.detailDrawer.classList.contains('open')) {
        openDrawer(selectedEl.dataset.key, { fromZoom: false });
    }
}

function getFocusedOrInspectedKey() {
    if (state.inspectedKey) return state.inspectedKey;
    const items = getActiveListItems();
    if (state.selectedIndex >= 0 && state.selectedIndex < items.length) {
        return items[state.selectedIndex].dataset.key;
    }
    return '';
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
        `<span class="whats-new-title">自 ${escapeHtml(lastVisitStr)} 以来的变化</span>` +
        `<span class="whats-new-items">${items.join('')}</span>`;
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
            // 防护
        }
    }
}

function stopVoiceInput() {
    state.voiceListening = false;
    dom.voiceBtn.classList.remove('listening');
}

// ========== F4: 视图切换 & 语义缩放星图 ==========

function switchView(mode, options = {}) {
    state.viewMode = mode;
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
        // 静默忽略
    }

    dom.viewTableBtn.classList.toggle('active', mode === 'table');
    dom.viewCardsBtn.classList.toggle('active', mode === 'cards');
    dom.viewZoomBtn.classList.toggle('active', mode === 'zoom');

    if (mode === 'zoom') {
        dom.tableWrap.style.display = 'none';
        dom.cardsGrid.classList.remove('active');
        dom.pagination.style.display = 'none';
        dom.zoomContainer.classList.add('active');
        initZoomCanvas();
    } else if (mode === 'cards') {
        dom.zoomContainer.classList.remove('active');
        dom.tableWrap.style.display = 'none';
        dom.cardsGrid.classList.add('active');
        renderResults({ flip: false });
    } else {
        dom.zoomContainer.classList.remove('active');
        dom.cardsGrid.classList.remove('active');
        dom.tableWrap.style.display = '';
        renderResults({ flip: false });
    }

    if (options.syncUrl !== false) {
        syncStateToUrl();
    }
}

function setZoomClusterMode(clusterBy) {
    state.zoomClusterBy = clusterBy;
    dom.zoomModeCategoryBtn.classList.toggle('active', clusterBy === 'category');
    dom.zoomModeLangBtn.classList.toggle('active', clusterBy === 'language');
    if (state.viewMode === 'zoom') {
        initZoomCanvas();
    }
}

function readCanvasThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        text: styles.getPropertyValue('--color-text').trim() || '#171717',
        textSecondary: styles.getPropertyValue('--color-text-secondary').trim() || '#525252',
        dotGrid: styles.getPropertyValue('--color-dot-grid').trim() || 'rgba(0,0,0,0.06)',
        border: styles.getPropertyValue('--color-border').trim() || '#e5e5e2',
        card: styles.getPropertyValue('--color-card').trim() || '#ffffff',
    };
}

function initZoomCanvas() {
    const canvas = dom.zoomCanvas;
    const container = dom.zoomContainer;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(500, Math.min(window.innerHeight - 280, 720));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    dom.zoomModeCategoryBtn.classList.toggle('active', state.zoomClusterBy === 'category');
    dom.zoomModeLangBtn.classList.toggle('active', state.zoomClusterBy === 'language');

    computeZoomLayout(width, height);
    renderZoomCanvas(ctx, width, height);
}

function computeZoomLayout(width, height) {
    const entries = state.filteredEntries;
    if (entries.length === 0) {
        state.zoomNodes = [];
        state.zoomClusters = [];
        dom.zoomEmpty.style.display = 'flex';
        dom.zoomStatsBadge.textContent = '0 项目';
        dom.zoomScaleBadge.textContent = '100%';
        return;
    }
    dom.zoomEmpty.style.display = 'none';

    const useCategory = state.zoomClusterBy === 'category' && state.categoryCounts.size > 0;
    const groupMap = new Map();

    for (const entry of entries) {
        const key = useCategory
            ? (entry.category || '其他')
            : (entry.language || '无语言');
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(entry);
    }

    const sortedGroups = Array.from(groupMap.entries()).sort((a, b) => b[1].length - a[1].length);
    let finalGroups = sortedGroups;
    if (!useCategory && sortedGroups.length > ZOOM_CLUSTER_MAX) {
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

    finalGroups.forEach(([groupName, rawItems], idx) => {
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
        const color = useCategory
            ? (CATEGORY_COLORS[groupName] || DEFAULT_LANGUAGE_COLOR)
            : getLanguageColor(groupName);
        const haloRadius = Math.max(ZOOM_CLUSTER_RADIUS_BASE, 18 + Math.sqrt(items.length) * 6);

        clusters.push({
            label: groupName,
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
                group: groupName,
                isHighlightNode: i < 2,
            });
        });
    });

    state.zoomNodes = nodes;
    state.zoomClusters = clusters;
    state.zoomScale = 1;
    state.zoomOffsetX = 0;
    state.zoomOffsetY = 0;
    dom.zoomStatsBadge.textContent = `${entries.length} 项目 · ${clusters.length} 簇`;
    dom.zoomScaleBadge.textContent = '100%';
}

function renderZoomCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    dom.zoomScaleBadge.textContent = `${Math.round(state.zoomScale * 100)}%`;
    if (state.zoomNodes.length === 0) return;

    const palette = readCanvasThemeColors();

    // 画布点阵背景
    ctx.fillStyle = palette.dotGrid;
    const step = 24;
    for (let x = 12; x < width; x += step) {
        for (let y = 12; y < height; y += step) {
            ctx.fillRect(x, y, 1, 1);
        }
    }

    ctx.save();
    ctx.translate(width / 2 + state.zoomOffsetX, height / 2 + state.zoomOffsetY);
    ctx.scale(state.zoomScale, state.zoomScale);
    ctx.translate(-width / 2, -height / 2);

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1 / state.zoomScale;
    for (const cluster of state.zoomClusters) {
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2);
        ctx.lineTo(cluster.x, cluster.y);
        ctx.stroke();
    }

    for (const cluster of state.zoomClusters) {
        const r = cluster.haloRadius;
        const grad = ctx.createRadialGradient(cluster.x, cluster.y, 0, cluster.x, cluster.y, r);
        grad.addColorStop(0, cluster.color + '26');
        grad.addColorStop(1, cluster.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cluster.x, cluster.y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    if (state.zoomScale < ZOOM_CLUSTER_LABEL_MAX_SCALE) {
        ctx.font = '600 11px "Plus Jakarta Sans", -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.textSecondary;
        for (const cluster of state.zoomClusters) {
            ctx.fillText(
                `${cluster.label} (${cluster.count})`,
                cluster.x,
                cluster.y - Math.min(cluster.haloRadius * 0.72, 48)
            );
        }
    }

    const showTopLabels = state.zoomScale >= ZOOM_TOP_NODE_LABEL_SCALE;
    const showAllLabels = state.zoomScale >= ZOOM_ALL_LABEL_SCALE;
    const placedLabelBoxes = [];

    for (const node of state.zoomNodes) {
        const isHovered = state.zoomHoveredNode === node || state.inspectedKey === node.entry.full_name;
        const r = isHovered ? ZOOM_NODE_RADIUS_HOVER : ZOOM_NODE_RADIUS;

        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (isHovered) {
            ctx.strokeStyle = palette.text;
            ctx.lineWidth = 1.6;
            ctx.stroke();
        }

        if (isHovered || showAllLabels || (showTopLabels && node.isHighlightNode)) {
            const label = node.entry.name || node.entry.full_name;
            const lx = node.x + r + 4;
            const ly = node.y + 3;
            const screenX = width / 2 + state.zoomOffsetX + state.zoomScale * (lx - width / 2);
            const screenY = height / 2 + state.zoomOffsetY + state.zoomScale * (ly - height / 2);
            const box = {
                x1: screenX,
                y1: screenY - 10,
                x2: screenX + label.length * 6.5 + 8,
                y2: screenY + 3,
            };

            const collides = !isHovered && placedLabelBoxes.some(
                b => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)
            );
            if (!collides) {
                placedLabelBoxes.push(box);
                ctx.font = '500 10px "JetBrains Mono", monospace';
                ctx.textAlign = 'left';
                ctx.fillStyle = palette.text;
                ctx.fillText(label, lx, ly);
            }
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

function findClusterAt(worldX, worldY) {
    for (const cluster of state.zoomClusters) {
        const dx = cluster.x - worldX;
        const dy = cluster.y - worldY;
        if (dx * dx + dy * dy <= cluster.haloRadius * cluster.haloRadius) {
            return cluster;
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
            const top = Math.max(8, pos.y - 30);
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
        if (node) {
            openDrawer(node.entry.full_name, { fromZoom: true });
            renderZoomCanvas(ctx, size.width, size.height);
            return;
        }

        if (state.zoomScale < 1.4) {
            const cluster = findClusterAt(world.x, world.y);
            if (cluster) {
                const targetScale = 2.0;
                state.zoomScale = targetScale;
                state.zoomOffsetX = (size.width / 2 - cluster.x) * targetScale;
                state.zoomOffsetY = (size.height / 2 - cluster.y) * targetScale;
                renderZoomCanvas(ctx, size.width, size.height);
            }
        }
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
    state.recentActiveOnly = parsed.active90;

    const hasExplicitView = typeof window !== 'undefined' && new URLSearchParams(window.location.search || '').has('view');
    if (hasExplicitView) {
        state.desiredViewMode = parsed.view;
    } else {
        try {
            const savedView = localStorage.getItem(VIEW_STORAGE_KEY);
            state.desiredViewMode = savedView === 'cards' || savedView === 'zoom' ? savedView : 'table';
        } catch {
            state.desiredViewMode = 'table';
        }
    }
    updateSearchClearBtn();
}

function handleListDelegatedClick(event) {
    const topicBtn = event.target.closest('.tag[data-topic]');
    if (topicBtn) {
        event.stopPropagation();
        const t = topicBtn.dataset.topic;
        state.activeTopic = state.activeTopic === t ? '' : t;
        renderFacets();
        applyFilters();
        return;
    }

    const catBtn = event.target.closest('.tag[data-category]');
    if (catBtn) {
        event.stopPropagation();
        const c = catBtn.dataset.category;
        state.selectedCategory = state.selectedCategory === c ? '' : c;
        applyFilters();
        return;
    }

    const cloneBtn = event.target.closest('.copy-clone-btn');
    if (cloneBtn) {
        event.stopPropagation();
        copyTextWithFeedback(cloneBtn.dataset.clone, cloneBtn, '已复制 git clone 命令');
        return;
    }

    const pinBtn = event.target.closest('.pin-toggle-btn');
    if (pinBtn) {
        event.stopPropagation();
        const repoKey = pinBtn.dataset.repo;
        const entry = state.allEntries.find(e => e.full_name === repoKey);
        if (entry) {
            const nextPinned = !entry.pinned;
            updatePersonalNote(repoKey, { pinned: nextPinned }, nextPinned ? '已置顶收藏' : '已取消置顶');
        }
        return;
    }

    if (event.target.closest('a, button')) return;

    const itemEl = event.target.closest('tr.data-row, .repo-card');
    if (!itemEl) return;
    if (state.inspectedKey === itemEl.dataset.key && dom.detailDrawer.classList.contains('open')) {
        closeDrawer();
    } else {
        openDrawer(itemEl.dataset.key, { fromZoom: false });
    }
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
            } else if (dom.shortcutsModal.classList.contains('active')) {
                closeModal(dom.shortcutsModal);
            } else if (dom.accessModal.classList.contains('active')) {
                closeModal(dom.accessModal);
            } else if (dom.sidebar.classList.contains('open')) {
                closeSidebar();
            } else if (dom.detailDrawer.classList.contains('open')) {
                closeDrawer();
            } else if (document.activeElement === dom.searchInput) {
                dom.searchInput.blur();
            }
            return;
        }

        if (
            state.paletteOpen ||
            dom.accessModal.classList.contains('active') ||
            dom.shortcutsModal.classList.contains('active')
        ) {
            return;
        }

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

        if (event.key === '?') {
            event.preventDefault();
            openModal(dom.shortcutsModal);
            return;
        }

        if (event.key === '/') {
            event.preventDefault();
            dom.searchInput.focus();
            return;
        }

        if (state.viewMode === 'zoom') return;

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goToPage(state.currentPage - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            goToPage(state.currentPage + 1);
        } else if (event.key === 'j') {
            event.preventDefault();
            moveSelection(1);
        } else if (event.key === 'k') {
            event.preventDefault();
            moveSelection(-1);
        } else if (event.key === 'Enter' || event.key === ' ') {
            const items = getActiveListItems();
            if (state.selectedIndex >= 0 && state.selectedIndex < items.length) {
                event.preventDefault();
                const key = items[state.selectedIndex].dataset.key;
                if (state.inspectedKey === key && dom.detailDrawer.classList.contains('open')) {
                    closeDrawer();
                } else {
                    openDrawer(key, { fromZoom: false });
                }
            }
        } else if (event.key === 'o') {
            const key = getFocusedOrInspectedKey();
            const entry = key && state.allEntries.find(e => e.full_name === key);
            const url = entry && safeExternalUrl(entry.html_url);
            if (url) {
                event.preventDefault();
                window.open(url, '_blank', 'noopener');
            }
        } else if (event.key === 'c') {
            const key = getFocusedOrInspectedKey();
            const entry = key && state.allEntries.find(e => e.full_name === key);
            const url = entry && safeExternalUrl(entry.html_url);
            if (url) {
                event.preventDefault();
                copyTextWithFeedback(`git clone ${url}.git`, null, '已复制 git clone 命令');
            }
        } else if (event.key === 'p') {
            const key = getFocusedOrInspectedKey();
            const entry = key && state.allEntries.find(e => e.full_name === key);
            if (entry) {
                event.preventDefault();
                const nextPinned = !entry.pinned;
                updatePersonalNote(key, { pinned: nextPinned }, nextPinned ? '已置顶收藏' : '已取消置顶');
            }
        }
    });

    // 侧边栏导航事件
    dom.sidebarToggleBtn.addEventListener('click', openSidebar);
    dom.sidebarBackdrop.addEventListener('click', closeSidebar);
    dom.navAllBtn.addEventListener('click', () => {
        state.pinnedOnly = false;
        state.recentActiveOnly = false;
        state.selectedCategory = '';
        state.selectedLanguage = '';
        state.activeTopic = '';
        clearBannerFilter();
        renderFacets();
        applyFilters();
        closeSidebar();
    });
    dom.navPinnedBtn.addEventListener('click', () => {
        state.pinnedOnly = !state.pinnedOnly;
        state.recentActiveOnly = false;
        applyFilters();
        closeSidebar();
    });
    dom.navRecentActiveBtn.addEventListener('click', () => {
        state.recentActiveOnly = !state.recentActiveOnly;
        state.pinnedOnly = false;
        applyFilters();
        closeSidebar();
    });
    dom.sidebarCategoriesList.addEventListener('click', event => {
        const btn = event.target.closest('[data-sidebar-category]');
        if (!btn) return;
        const cat = btn.dataset.sidebarCategory;
        state.selectedCategory = state.selectedCategory === cat ? '' : cat;
        applyFilters();
        closeSidebar();
    });
    dom.sidebarLanguagesList.addEventListener('click', event => {
        const btn = event.target.closest('[data-sidebar-language]');
        if (!btn) return;
        const lang = btn.dataset.sidebarLanguage;
        state.selectedLanguage = state.selectedLanguage === lang ? '' : lang;
        applyFilters();
        closeSidebar();
    });
    dom.sidebarLangExpandBtn.addEventListener('click', () => {
        state.langExpanded = !state.langExpanded;
        renderSidebar();
    });
    dom.hideArchivedBtn.addEventListener('click', () => {
        state.hideArchived = !state.hideArchived;
        applyFilters();
    });

    // Topbar 控件
    dom.themeToggleBtn.addEventListener('click', toggleTheme);
    dom.densityToggleBtn.addEventListener('click', toggleDensity);
    dom.paletteTriggerBtn.addEventListener('click', openPalette);
    dom.viewTableBtn.addEventListener('click', () => switchView('table'));
    dom.viewCardsBtn.addEventListener('click', () => switchView('cards'));
    dom.viewZoomBtn.addEventListener('click', () => switchView('zoom'));
    dom.sortSelect.addEventListener('change', () => {
        const [field, order] = dom.sortSelect.value.split(':');
        setSort(field || DEFAULT_SORT_FIELD, order || DEFAULT_SORT_ORDER);
    });

    // 搜索框与清除按钮
    dom.searchClearBtn.addEventListener('click', () => {
        dom.searchInput.value = '';
        if (state.preSearchSort) {
            state.sortField = state.preSearchSort.field;
            state.sortOrder = state.preSearchSort.order;
            state.preSearchSort = null;
        }
        state.manualSortDuringQuery = false;
        applyFilters();
        dom.searchInput.focus();
    });
    dom.searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') applyFilters();
    });
    let debounceTimer = null;
    dom.searchInput.addEventListener('input', () => {
        const query = dom.searchInput.value.trim();
        updateSearchClearBtn();
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

    // 已激活筛选条
    dom.activeFiltersBar.addEventListener('click', event => {
        const btn = event.target.closest('[data-clear-filter]');
        if (!btn) return;
        const target = btn.dataset.clearFilter;
        if (target === 'all') {
            resetAll();
            return;
        }
        if (target === 'q') {
            dom.searchInput.value = '';
            if (state.preSearchSort) {
                state.sortField = state.preSearchSort.field;
                state.sortOrder = state.preSearchSort.order;
                state.preSearchSort = null;
            }
            state.manualSortDuringQuery = false;
        } else if (target === 'cat') state.selectedCategory = '';
        else if (target === 'lang') state.selectedLanguage = '';
        else if (target === 'topic') {
            state.activeTopic = '';
            renderFacets();
        } else if (target === 'pinned') state.pinnedOnly = false;
        else if (target === 'active90') state.recentActiveOnly = false;
        else if (target === 'hideArchived') state.hideArchived = false;
        else if (target === 'special') clearBannerFilter();
        applyFilters();
    });

    // 分面导航 & What's New
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
            applyFilters();
        } else if (action === 'filter-grew') {
            state.specialFilter = 'grew';
            state.specialFilterNames = new Set(state.whatsNewChanges.starsGrew.map(e => e.name));
            applyFilters();
        }
    });
    dom.whatsNewDismiss.addEventListener('click', dismissWhatsNew);

    // 表格与卡片列表交互委托
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

    dom.results.addEventListener('click', handleListDelegatedClick);
    dom.cardsGrid.addEventListener('click', handleListDelegatedClick);

    const handleItemFocusIn = selector => event => {
        const itemEl = event.target.closest(selector);
        if (!itemEl) return;
        const items = getActiveListItems();
        state.selectedIndex = items.indexOf(itemEl);
        items.forEach((el, index) => el.classList.toggle('selected', index === state.selectedIndex));
    };
    dom.results.addEventListener('focusin', handleItemFocusIn('tr.data-row'));
    dom.cardsGrid.addEventListener('focusin', handleItemFocusIn('.repo-card'));

    const handleItemKeyDown = selector => event => {
        const itemEl = event.target.closest(selector);
        if (!itemEl || event.target !== itemEl) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (state.inspectedKey === itemEl.dataset.key && dom.detailDrawer.classList.contains('open')) {
                closeDrawer();
            } else {
                openDrawer(itemEl.dataset.key, { fromZoom: false });
            }
        }
    };
    dom.results.addEventListener('keydown', handleItemKeyDown('tr.data-row'));
    dom.cardsGrid.addEventListener('keydown', handleItemKeyDown('.repo-card'));

    // Inspector Drawer 委托
    dom.drawerBackdrop.addEventListener('click', closeDrawer);
    dom.detailDrawer.addEventListener('click', event => {
        if (event.target.closest('[data-drawer-close]')) {
            closeDrawer();
            return;
        }
        const navBtn = event.target.closest('[data-drawer-nav]');
        if (navBtn) {
            const delta = Number(navBtn.dataset.drawerNav);
            const idx = state.filteredEntries.findIndex(e => e.full_name === state.inspectedKey);
            const next = state.filteredEntries[idx + delta];
            if (next) openDrawer(next.full_name, { fromZoom: state.drawerFromZoom });
            return;
        }
        const locateBtn = event.target.closest('[data-locate-table]');
        if (locateBtn) {
            locateInTable(locateBtn.dataset.locateTable);
            return;
        }
        const aiBtn = event.target.closest('.ai-summary-btn');
        if (aiBtn) {
            generateAISummary(aiBtn.dataset.repo, aiBtn);
            return;
        }
        const topicBtn = event.target.closest('.tag[data-topic]');
        if (topicBtn) {
            const t = topicBtn.dataset.topic;
            state.activeTopic = state.activeTopic === t ? '' : t;
            renderFacets();
            applyFilters();
            return;
        }
        const catBtn = event.target.closest('.tag[data-category]');
        if (catBtn) {
            const c = catBtn.dataset.category;
            state.selectedCategory = state.selectedCategory === c ? '' : c;
            applyFilters();
            return;
        }
        const useCaseBtn = event.target.closest('.tag[data-usecase]');
        if (useCaseBtn) {
            dom.searchInput.value = useCaseBtn.dataset.usecase;
            applyFilters();
            return;
        }
        const cloneBtn = event.target.closest('.copy-clone-btn');
        if (cloneBtn) {
            copyTextWithFeedback(cloneBtn.dataset.clone, cloneBtn, '已复制 git clone 命令');
            return;
        }
        const nameBtn = event.target.closest('.copy-name-btn');
        if (nameBtn) {
            copyTextWithFeedback(nameBtn.dataset.name, nameBtn, '已复制仓库全名');
            return;
        }
        const pinBtn = event.target.closest('.pin-toggle-btn');
        if (pinBtn) {
            const repoKey = pinBtn.dataset.repo;
            const entry = state.allEntries.find(e => e.full_name === repoKey);
            if (entry) {
                const nextPinned = !entry.pinned;
                updatePersonalNote(repoKey, { pinned: nextPinned }, nextPinned ? '已置顶收藏' : '已取消置顶');
            }
            return;
        }
        const saveNoteBtn = event.target.closest('.note-save-btn');
        if (saveNoteBtn) {
            const card = saveNoteBtn.closest('.note-editor-card');
            const input = card && card.querySelector('.note-input');
            updatePersonalNote(saveNoteBtn.dataset.repo, { note: input ? input.value.trim() : '' }, '已保存个人备注');
        }
    });
    dom.detailDrawer.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.classList.contains('note-input')) {
            event.preventDefault();
            event.stopPropagation();
            updatePersonalNote(event.target.dataset.repo, { note: event.target.value.trim() }, '已保存个人备注');
        }
    });

    // 命令面板事件
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
            executePaletteSelection(event.metaKey || event.ctrlKey);
        }
    });
    dom.paletteOverlay.addEventListener('click', event => {
        if (event.target === dom.paletteOverlay) closePalette();
    });
    dom.paletteList.addEventListener('click', event => {
        const item = event.target.closest('.palette-item');
        if (!item) return;
        state.paletteIndex = Number(item.dataset.index);
        executePaletteSelection(event.metaKey || event.ctrlKey);
    });

    dom.notesImportInput.addEventListener('change', handleNotesImportFile);

    // Modals
    dom.accessButton.addEventListener('click', () => openModal(dom.accessModal));
    dom.modalClose.addEventListener('click', () => closeModal(dom.accessModal));
    dom.accessModal.addEventListener('click', event => {
        if (event.target === dom.accessModal) closeModal(dom.accessModal);
    });
    dom.shortcutsButton.addEventListener('click', () => openModal(dom.shortcutsModal));
    dom.shortcutsClose.addEventListener('click', () => closeModal(dom.shortcutsModal));
    dom.shortcutsModal.addEventListener('click', event => {
        if (event.target === dom.shortcutsModal) closeModal(dom.shortcutsModal);
    });
    document.querySelectorAll('.copy-button').forEach(btn => {
        btn.addEventListener('click', () => copyCodeBlock(btn));
    });

    // 星图控件
    dom.zoomModeCategoryBtn.addEventListener('click', () => setZoomClusterMode('category'));
    dom.zoomModeLangBtn.addEventListener('click', () => setZoomClusterMode('language'));

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
    updateThemeButton();
    updateDensityButton();
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
        formatStarCount,
        formatRelativeTime,
        getFreshnessLevel,
        splitRepoName,
        getRepoMonogram,
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
