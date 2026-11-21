'use strict';

const assert = require('assert');
const app = require('../public/app.js');

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

    // 模拟 1 个新增和 1 个涨星
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

// 7. URL 序列化与解析往返 + 本地备注合并
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
    };
    const qs = app.serializeUrlParams(stateObj);
    const parsed = app.parseUrlParams(qs);
    assert.deepStrictEqual(parsed, stateObj);

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
    });
    assert.strictEqual(defaultQs, '');

    const merged = app.mergeEntryWithNote(
        { full_name: 'a/b', pinned: false, note: '' },
        { 'a/b': { pinned: true, note: '本地备注' } }
    );
    assert.strictEqual(merged.pinned, true);
    assert.strictEqual(merged.note, '本地备注');
}

console.log('All frontend unit tests passed!');
