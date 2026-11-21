'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../public/app.js');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// 1. escapeHtml 转义 5 个关键字符
{
    const input = `& < > " '`;
    const actual = app.escapeHtml(input);
    assert.strictEqual(actual, '&amp; &lt; &gt; &quot; &#39;');
    assert.strictEqual(app.escapeHtml(null), '');
    assert.strictEqual(app.escapeHtml(undefined), '');
}

// 2. safeExternalUrl 协议校验
{
    assert.strictEqual(app.safeExternalUrl('https://github.com/octocat/Hello-World'), 'https://github.com/octocat/Hello-World');
    assert.strictEqual(app.safeExternalUrl('http://example.com/docs'), 'http://example.com/docs');
    assert.strictEqual(app.safeExternalUrl('javascript:alert(1)'), '');
    assert.strictEqual(app.safeExternalUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.strictEqual(app.safeExternalUrl('not-a-url'), '');
    assert.strictEqual(app.safeExternalUrl(''), '');
}

// 3. computeWhatsNew 支持 >500 条目无误报且能检测新增与增长
{
    const entries = [];
    const baselineStars = {};
    for (let i = 0; i < 648; i++) {
        const name = `owner/repo-${i}`;
        entries.push({ full_name: name, stargazers_count: 100 + i });
        baselineStars[name] = 100 + i;
    }

    const noDiff = app.computeWhatsNew(entries, { stars: baselineStars, timestamp: 1700000000000 });
    assert.strictEqual(noDiff.newProjects.length, 0);
    assert.strictEqual(noDiff.starsGrew.length, 0);

    entries[600].stargazers_count += 25;
    entries.push({ full_name: 'owner/brand-new', stargazers_count: 42 });

    const withDiff = app.computeWhatsNew(entries, { stars: baselineStars, timestamp: 1700000000000 });
    assert.strictEqual(withDiff.newProjects.length, 1);
    assert.strictEqual(withDiff.newProjects[0].full_name, 'owner/brand-new');
    assert.strictEqual(withDiff.starsGrew.length, 1);
    assert.strictEqual(withDiff.starsGrew[0].name, 'owner/repo-600');
    assert.strictEqual(withDiff.starsGrew[0].delta, 25);
}

// 4. computeWheelZoomOffset 保持光标下世界坐标不变
{
    const size = { width: 1000, height: 600 };
    const pos = { x: 720, y: 180 };
    const oldScale = 1.2;
    const newScale = 2.4;
    const oldOffset = { x: 45, y: -30 };

    const worldBeforeX = ((pos.x - size.width / 2 - oldOffset.x) / oldScale) + size.width / 2;
    const worldBeforeY = ((pos.y - size.height / 2 - oldOffset.y) / oldScale) + size.height / 2;

    const nextOffset = app.computeWheelZoomOffset(pos, size, oldScale, newScale, oldOffset);

    const screenAfterX = size.width / 2 + nextOffset.x + newScale * (worldBeforeX - size.width / 2);
    const screenAfterY = size.height / 2 + nextOffset.y + newScale * (worldBeforeY - size.height / 2);

    assert.ok(Math.abs(screenAfterX - pos.x) < 1e-6);
    assert.ok(Math.abs(screenAfterY - pos.y) < 1e-6);
}

// 5. 中文分词、匹配与相关度排序
{
    const tokens = app.tokenizeSearchQuery('实时聊天的框架');
    assert.ok(tokens.includes('实时'));
    assert.ok(tokens.includes('聊天'));
    assert.ok(tokens.includes('框架'));

    const chatEntry = {
        full_name: 'a/realtime-chat',
        description: 'WebSocket chat server',
        summary: '实时消息与聊天服务框架',
        language: 'Go',
        topics: ['websocket'],
        use_cases: ['实时聊天'],
    };
    const otherEntry = {
        full_name: 'a/orm',
        description: 'SQL ORM',
        summary: '数据库映射',
        language: 'Python',
        topics: ['orm'],
        use_cases: ['数据访问'],
    };

    assert.strictEqual(app.matchesSearchQuery(chatEntry, '实时聊天的框架'), true);
    assert.strictEqual(app.matchesSearchQuery(otherEntry, '实时聊天的框架'), false);

    const nameMatch = {
        full_name: 'sqlalchemy/orm',
        description: 'SQL toolkit',
        summary: '',
        topics: [],
        use_cases: [],
    };
    const descMatch = {
        full_name: 'other/toolkit',
        description: 'A wrapper around some orm concept',
        summary: '',
        topics: [],
        use_cases: [],
    };
    const qTokens = app.tokenizeSearchQuery('orm');
    assert.ok(
        app.scoreEntryMatch(nameMatch, qTokens, 'orm') >
        app.scoreEntryMatch(descMatch, qTokens, 'orm')
    );
}

// 6. highlightText 安全高亮且不注入 raw HTML
{
    const highlighted = app.highlightText('<script>alert("xss")</script> for mcp', ['script', 'mcp']);
    assert.ok(!highlighted.includes('<script>'));
    assert.ok(highlighted.includes('&lt;<mark class="search-hl">script</mark>&gt;'));
    assert.ok(highlighted.includes('&quot;xss&quot;'));
    assert.ok(highlighted.includes('<mark class="search-hl">mcp</mark>'));
}

// 7. URL 序列化与解析往返（含 cards 视图与 active90） + 本地备注合并
{
    const stateObj = {
        q: 'agent mcp',
        lang: 'Python',
        cat: 'AI/Agent',
        topic: 'llm',
        sort: 'stargazers_count',
        order: 'desc',
        view: 'zoom',
        hideArchived: true,
        pinned: true,
        active90: true,
    };
    const qs = app.serializeUrlParams(stateObj);
    const parsed = app.parseUrlParams(qs);
    assert.deepStrictEqual(parsed, stateObj);

    const cardsParsed = app.parseUrlParams(app.serializeUrlParams({
        q: '',
        lang: '',
        cat: '',
        topic: '',
        sort: 'starred_at',
        order: 'desc',
        view: 'cards',
        hideArchived: false,
        pinned: false,
        active90: false,
    }));
    assert.strictEqual(cardsParsed.view, 'cards');
    assert.strictEqual(cardsParsed.active90, false);

    const defaultQs = app.serializeUrlParams({
        q: '',
        lang: '',
        cat: '',
        topic: '',
        sort: 'starred_at',
        order: 'desc',
        view: 'table',
        hideArchived: false,
        pinned: false,
        active90: false,
    });
    assert.strictEqual(defaultQs, '');

    const merged = app.mergeEntryWithNote(
        { full_name: 'a/b', pinned: false, note: '' },
        { 'a/b': { pinned: true, note: '本地备注' } }
    );
    assert.strictEqual(merged.pinned, true);
    assert.strictEqual(merged.note, '本地备注');
}

// 8. 新增格式化与辅助函数校验
{
    assert.strictEqual(app.formatStarCount(0), '0');
    assert.strictEqual(app.formatStarCount(999), '999');
    assert.strictEqual(app.formatStarCount(1300), '1.3k');
    assert.strictEqual(app.formatStarCount(44672), '44.7k');
    assert.strictEqual(app.formatStarCount(120000), '120k');
    assert.strictEqual(app.formatStarCount(1500000), '1.5m');

    const now = Date.UTC(2026, 10, 21, 12, 0, 0);
    assert.strictEqual(app.formatRelativeTime('2026-11-21T08:00:00Z', now), '今天');
    assert.strictEqual(app.formatRelativeTime('2026-11-20T08:00:00Z', now), '昨天');
    assert.strictEqual(app.formatRelativeTime('2026-11-01T08:00:00Z', now), '20天前');
    assert.strictEqual(app.formatRelativeTime('2026-07-01T08:00:00Z', now), '4个月前');
    assert.strictEqual(app.formatRelativeTime('2024-01-01T08:00:00Z', now), '2年前');
    assert.strictEqual(app.formatRelativeTime('', now), '未知');

    assert.strictEqual(app.getFreshnessLevel('2026-10-01T00:00:00Z', now), 'fresh');
    assert.strictEqual(app.getFreshnessLevel('2026-04-01T00:00:00Z', now), 'warm');
    assert.strictEqual(app.getFreshnessLevel('2024-01-01T00:00:00Z', now), 'stale');
    assert.strictEqual(app.getFreshnessLevel('', now), 'unknown');

    assert.deepStrictEqual(app.splitRepoName('octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' });
    assert.deepStrictEqual(app.splitRepoName('solo'), { owner: '', repo: 'solo' });

    assert.strictEqual(app.getRepoMonogram('fxbin/star-knowledge-base'), 'SK');
    assert.strictEqual(app.getRepoMonogram('FastAPI/FastAPI'), 'FA');
}

// 9. HTML <-> JS DOM ID 契约测试与 CSS 括号平衡校验
{
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

    const htmlIds = new Set();
    let m;
    const htmlIdRegex = /\bid=["']([^"']+)["']/g;
    while ((m = htmlIdRegex.exec(html)) !== null) {
        htmlIds.add(m[1]);
    }

    const jsIdRegex = /document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    const missing = [];
    while ((m = jsIdRegex.exec(js)) !== null) {
        if (!htmlIds.has(m[1])) {
            missing.push(m[1]);
        }
    }
    assert.deepStrictEqual(missing, [], `HTML 缺失 DOM ID: ${missing.join(', ')}`);

    let depth = 0;
    for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        assert.ok(depth >= 0, `styles.css 第 ${i} 字符处出现多余右花括号`);
    }
    assert.strictEqual(depth, 0, 'styles.css 花括号未闭合');
}

console.log('All frontend unit tests & DOM contract checks passed!');
