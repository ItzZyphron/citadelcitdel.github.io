import { getTags } from './api.js';
import { buildPack } from './resolver.js';
import { buildMrpack, triggerDownload } from './mrpack.js';

const el = id => document.getElementById(id);

const state = {
  loaders: [],
  gameVersions: [],
  categories: [],
};

const FALLBACK_GAME_VERSIONS = ['1.21.1', '1.20.1', '1.19.2', '1.18.2', '1.16.5'];
const FALLBACK_LOADERS = ['fabric', 'forge', 'quilt', 'neoforge'];
const FALLBACK_CATEGORIES = [
  'adventure', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics',
  'library', 'magic', 'management', 'minigame', 'mobs', 'optimization',
  'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen',
];

async function init() {
  try {
    const tags = await getTags();
    state.loaders = tags.loaders.map(l => l.name).filter(n => FALLBACK_LOADERS.includes(n));
    state.gameVersions = tags.gameVersions.filter(v => v.version_type === 'release').map(v => v.version);
    state.categories = tags.categories.filter(c => c.project_type === 'mod').map(c => c.name);
  } catch (e) {
    console.warn('Falling back to static tag lists — Modrinth tag fetch failed:', e);
  }
  if (!state.loaders.length) state.loaders = FALLBACK_LOADERS;
  if (!state.gameVersions.length) state.gameVersions = FALLBACK_GAME_VERSIONS;
  if (!state.categories.length) state.categories = FALLBACK_CATEGORIES;

  populateSelect(el('loader'), state.loaders);
  populateSelect(el('gameVersion'), state.gameVersions);
  renderCategoryChips(state.categories);
  wireEvents();
}

function populateSelect(select, values) {
  select.innerHTML = values.map(v => `<option value="${v}">${v}</option>`).join('');
}

function renderCategoryChips(categories) {
  const wrap = el('categoryChips');
  wrap.innerHTML = categories.map(c => `
    <button type="button" class="chip" data-category="${c}">${c.replace('-', ' ')}</button>
  `).join('');
  wrap.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('chip--active'));
  });
}

function selectedCategories() {
  return [...document.querySelectorAll('.chip--active')].map(c => c.dataset.category);
}

function wireEvents() {
  const modeTabs = document.querySelectorAll('.mode-tab');
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modeTabs.forEach(t => t.classList.remove('mode-tab--active'));
      tab.classList.add('mode-tab--active');
      const mode = tab.dataset.mode;
      el('typePanel').hidden = mode !== 'type';
      el('listPanel').hidden = mode !== 'list';
      state.mode = mode;
    });
  });
  state.mode = 'type';

  el('targetCount').addEventListener('input', () => {
    el('targetCountLabel').textContent = el('targetCount').value;
  });

  el('generateBtn').addEventListener('click', onGenerate);
  el('downloadBtn').addEventListener('click', onDownload);
}

let lastResult = null;

async function onGenerate() {
  const loader = el('loader').value;
  const gameVersion = el('gameVersion').value;
  const targetCount = Number(el('targetCount').value);
  const includeOptional = el('includeOptional').checked;
  const mode = state.mode;

  el('generateBtn').disabled = true;
  el('downloadBtn').hidden = true;
  el('skippedPanel').hidden = true;
  const ticket = el('ticket');
  ticket.innerHTML = '';
  setProgress(0, targetCount);
  setStatus('Talking to Modrinth…');

  try {
    const opts = {
      mode, loader, gameVersion, targetCount,
      includeOptional,
      categories: selectedCategories(),
      modNames: el('modList').value.split('\n'),
      fillRemaining: el('fillRemaining').checked,
      onProgress: handleProgress,
    };
    const result = await buildPack(opts);
    lastResult = { ...result, loader, gameVersion, targetCount };

    if (!result.mods.length) {
      setStatus('No mods matched — try different categories, a different Minecraft version, or a different loader.');
    } else {
      setStatus(`Done — ${result.mods.length} mod${result.mods.length === 1 ? '' : 's'} ready.`);
      el('downloadBtn').hidden = false;
    }
    if (result.skipped.length) {
      renderSkipped(result.skipped);
    }
  } catch (e) {
    console.error(e);
    setStatus(`Something went wrong: ${e.message}`);
  } finally {
    el('generateBtn').disabled = false;
  }
}

function handleProgress(evt) {
  if (evt.type === 'searching') {
    setStatus(`Checking "${evt.name}"…`);
  } else if (evt.type === 'added') {
    setProgress(evt.count, evt.target);
    addTicketRow(evt.project, evt.reason);
  }
}

function setStatus(text) {
  el('statusLine').textContent = text;
}

function setProgress(count, target) {
  const pct = Math.min(100, Math.round((count / target) * 100));
  el('progressFill').style.width = `${pct}%`;
  el('progressLabel').textContent = `${count} / ${target} mods`;
}

const REASON_LABEL = {
  requested: 'requested',
  dependency: 'required by another mod',
  'category match': 'matches your pick',
  recommended: 'recommended fill',
};

function addTicketRow(project, reason) {
  const row = document.createElement('div');
  row.className = 'ticket-row';
  row.innerHTML = `
    <span class="ticket-row__name">${escapeHtml(project.title)}</span>
    <span class="ticket-row__tag ticket-row__tag--${reason.replace(/\s+/g, '-')}">${REASON_LABEL[reason] || reason}</span>
  `;
  el('ticket').appendChild(row);
}

function renderSkipped(skipped) {
  const panel = el('skippedPanel');
  panel.hidden = false;
  el('skippedList').innerHTML = skipped.map(s => `<li><strong>${escapeHtml(s.name)}</strong> — ${escapeHtml(s.reason)}</li>`).join('');
}

async function onDownload() {
  if (!lastResult || !lastResult.mods.length) return;
  el('downloadBtn').disabled = true;
  el('downloadBtn').textContent = 'Packing…';
  try {
    const packName = el('packName').value.trim() || 'My Modpack';
    const { blob, loaderVersionResolved } = await buildMrpack({
      name: packName,
      gameVersion: lastResult.gameVersion,
      loader: lastResult.loader,
      mods: lastResult.mods,
    });
    triggerDownload(blob, packName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'modpack');
    if (!loaderVersionResolved && (lastResult.loader === 'forge' || lastResult.loader === 'neoforge')) {
      setStatus('Downloaded. Note: pick the recommended Forge/NeoForge build if Prism asks during import.');
    } else {
      setStatus('Downloaded — import it in Prism Launcher: Add Instance → Import.');
    }
  } catch (e) {
    console.error(e);
    setStatus(`Couldn't build the file: ${e.message}`);
  } finally {
    el('downloadBtn').disabled = false;
    el('downloadBtn').textContent = 'Download .mrpack';
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

init();
