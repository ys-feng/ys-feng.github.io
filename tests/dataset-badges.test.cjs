const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../dataset-badges.js'), 'utf8');
const start = Date.parse('2026-10-16T00:00:00Z');
const sample = {
    schemaVersion: 1, dataset: 'inclusionAI/OpenAoE-2000h',
    downloads: 13325017, rank: 6, totalDatasets: 44429,
    updatedAt: new Date(start).toISOString(),
};
const hfSample = {
    schemaVersion: 1, dataset: sample.dataset,
    downloadsAllTime: 923691, downloads: 269774,
    updatedAt: sample.updatedAt,
};

async function render(data = sample, fail = false, hfData = hfSample, hfFail = false) {
    const elements = Object.fromEntries(['openaoe-badges', 'modelscope-downloads', 'modelscope-rank', 'huggingface-downloads'].map(id => [id, {
        value: { textContent: '—' }, dataset: {}, attributes: {},
        querySelector() { return this.value; },
        setAttribute(key, value) { this.attributes[key] = value; },
    }]));
    const state = { now: start, requests: 0, events: {}, data, fail, hfData, hfFail };
    const document = {
        hidden: false,
        getElementById(id) { return elements[id]; },
        addEventListener(name, callback) { state.events[name] = callback; },
    };
    vm.runInNewContext(script, {
        document, Intl, AbortController,
        Date: class extends Date { static now() { return state.now; } },
        setTimeout() { return 1; }, clearTimeout() {},
        setInterval(callback) { state.tick = callback; },
        async fetch(url) {
            state.requests++;
            const isHuggingFace = url.includes('huggingface');
            if (isHuggingFace ? state.hfFail : state.fail) throw new Error('offline');
            return { ok: true, async json() { return isHuggingFace ? state.hfData : state.data; } };
        },
    });
    await new Promise(setImmediate);
    return { elements, state, document };
}

test('shows fetched values with a concise rank and a precise accessible description', async () => {
    const { elements } = await render();
    assert.equal(elements['modelscope-downloads'].value.textContent, '13.33M');
    assert.equal(elements['modelscope-rank'].value.textContent, '#6');
    assert.match(elements['modelscope-rank'].title, /all 44,429 ModelScope datasets by downloads/);
    assert.equal(elements['openaoe-badges'].attributes['aria-busy'], 'false');
});

test('network errors do not leave a hardcoded rank visible', async () => {
    const { elements } = await render(sample, true);
    assert.equal(elements['modelscope-rank'].value.textContent, '—');
    assert.equal(elements['modelscope-rank'].dataset.state, 'unavailable');
});

test('future-dated, wrong-dataset and malformed statistics are rejected', async () => {
    for (const override of [
        { updatedAt: new Date(start + 10 * 60000).toISOString() },
        { updatedAt: 'invalid' },
        { dataset: 'another/dataset' }, { rank: 0 }, { downloads: -1 }, { totalDatasets: 5 },
    ]) {
        const { elements } = await render({ ...sample, ...override });
        assert.equal(elements['modelscope-rank'].value.textContent, '—');
    }
});

test('an open tab retains values over 3 days old and describes the delay when returning from the background', async () => {
    const { elements, state, document } = await render();
    document.hidden = true;
    state.now += 3 * 24 * 60 * 60000 + 1;
    state.tick();
    assert.equal(state.requests, 2);
    document.hidden = false;
    state.events.visibilitychange();
    await new Promise(setImmediate);
    assert.equal(state.requests, 4);
    assert.equal(elements['modelscope-rank'].value.textContent, '#6');
    assert.equal(elements['modelscope-rank'].dataset.state, 'stale');
    assert.equal(elements['huggingface-downloads'].value.textContent, '923.7K');
    assert.match(elements['modelscope-rank'].attributes['aria-label'], /Update delayed \(over 3 days since verification\)/);
});

test('Hugging Face uses the cumulative count even when a monthly count is present', async () => {
    const { elements } = await render();
    assert.equal(elements['huggingface-downloads'].value.textContent, '923.7K');
    assert.match(elements['huggingface-downloads'].title, /923,691 all-time downloads/);
    assert.doesNotMatch(elements['huggingface-downloads'].title, /269,774/);
});

test('each platform remains visible if the other platform fails', async () => {
    const hfOffline = await render(sample, false, hfSample, true);
    assert.equal(hfOffline.elements['modelscope-rank'].value.textContent, '#6');
    assert.equal(hfOffline.elements['huggingface-downloads'].value.textContent, '—');
    const msOffline = await render(sample, true);
    assert.equal(msOffline.elements['huggingface-downloads'].value.textContent, '923.7K');
});

test('missing or invalid cumulative HF counts cannot fall back to the monthly count', async () => {
    for (const override of [
        { downloadsAllTime: undefined }, { downloadsAllTime: -1 },
        { updatedAt: 'invalid' },
        { dataset: 'another/dataset' },
    ]) {
        const { elements } = await render(sample, false, { ...hfSample, ...override });
        assert.equal(elements['huggingface-downloads'].value.textContent, '—');
        assert.equal(elements['modelscope-rank'].value.textContent, '#6');
    }
});

test('snapshots older than an hour and up to exactly 3 days remain ready', async () => {
    for (const age of [75 * 60000, 3 * 24 * 60 * 60000]) {
        const updatedAt = new Date(start - age).toISOString();
        const { elements } = await render({ ...sample, updatedAt }, false, { ...hfSample, updatedAt });
        for (const id of ['modelscope-downloads', 'modelscope-rank', 'huggingface-downloads']) {
            assert.equal(elements[id].dataset.state, 'ready');
            assert.doesNotMatch(elements[id].title, /Update delayed/);
            assert.match(elements[id].title, /Last verified/);
        }
    }
});

test('a first visit with snapshots over 3 days old shows verified numbers and a tooltip warning', async () => {
    const updatedAt = new Date(start - (3 * 24 * 60 * 60000 + 1)).toISOString();
    const { elements } = await render({ ...sample, updatedAt }, false, { ...hfSample, updatedAt });
    for (const [id, value] of [
        ['modelscope-downloads', '13.33M'], ['modelscope-rank', '#6'], ['huggingface-downloads', '923.7K'],
    ]) {
        assert.equal(elements[id].value.textContent, value);
        assert.equal(elements[id].dataset.state, 'stale');
        assert.match(elements[id].title, /Update delayed/);
        assert.match(elements[id].title, /Last verified/);
    }
});

test('a failed periodic refresh preserves the last good values and recovers on the next success', async () => {
    const { elements, state } = await render();
    state.fail = state.hfFail = true;
    state.now += 15 * 60000;
    state.tick();
    await new Promise(setImmediate);
    assert.equal(elements['modelscope-rank'].value.textContent, '#6');
    assert.equal(elements['huggingface-downloads'].value.textContent, '923.7K');
    assert.equal(elements['modelscope-rank'].dataset.state, 'ready');
    assert.equal(elements['huggingface-downloads'].dataset.state, 'ready');
    assert.match(elements['modelscope-rank'].title, /Latest refresh unavailable/);
    assert.match(elements['huggingface-downloads'].title, /Latest refresh unavailable/);
    assert.doesNotMatch(elements['modelscope-rank'].title, /Update delayed/);

    state.fail = state.hfFail = false;
    state.now += 15 * 60000;
    const updatedAt = new Date(state.now).toISOString();
    state.data = { ...sample, rank: 5, updatedAt };
    state.hfData = { ...hfSample, downloadsAllTime: 925000, updatedAt };
    state.tick();
    await new Promise(setImmediate);
    assert.equal(elements['modelscope-rank'].value.textContent, '#5');
    assert.equal(elements['huggingface-downloads'].value.textContent, '925K');
    assert.equal(elements['modelscope-rank'].dataset.state, 'ready');
    assert.equal(elements['huggingface-downloads'].dataset.state, 'ready');
    assert.doesNotMatch(elements['modelscope-rank'].title, /Update delayed|Latest refresh unavailable/);
});

test('invalid refresh results cannot replace valid data or affect the other platform', async () => {
    const { elements, state } = await render();
    state.now += 15 * 60000;
    state.data = { ...sample, rank: 0 };
    state.hfData = { ...hfSample, downloadsAllTime: 930000, updatedAt: new Date(state.now).toISOString() };
    state.tick();
    await new Promise(setImmediate);
    assert.equal(elements['modelscope-rank'].value.textContent, '#6');
    assert.equal(elements['modelscope-rank'].dataset.state, 'ready');
    assert.match(elements['modelscope-rank'].title, /Latest refresh unavailable/);
    assert.equal(elements['huggingface-downloads'].value.textContent, '930K');
    assert.equal(elements['huggingface-downloads'].dataset.state, 'ready');
});

test('repeated refresh failures age the saved snapshots only after 3 days', async () => {
    const { elements, state } = await render();
    state.fail = state.hfFail = true;
    for (const [age, status] of [[3 * 24 * 60 * 60000, 'ready'], [3 * 24 * 60 * 60000 + 1, 'stale']]) {
        state.now = start + age;
        state.tick();
        await new Promise(setImmediate);
        for (const [id, value] of [
            ['modelscope-downloads', '13.33M'], ['modelscope-rank', '#6'], ['huggingface-downloads', '923.7K'],
        ]) {
            assert.equal(elements[id].value.textContent, value);
            assert.equal(elements[id].dataset.state, status);
            assert.match(elements[id].title, /Latest refresh unavailable/);
            assert.equal(elements[id].title, elements[id].attributes['aria-label']);
        }
    }
});
