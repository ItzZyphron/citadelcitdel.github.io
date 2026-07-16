// api.js — talks to Modrinth's public API and loader metadata feeds.
// Everything here is plain fetch() to public, CORS-enabled endpoints.
// Nothing needs an API key.

const MODRINTH = 'https://api.modrinth.com/v2';

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

// facets is an array of arrays: each inner array is OR'd, outer arrays are AND'd.
// e.g. [["categories:fabric"],["versions:1.20.1"],["categories:tech","categories:storage"]]
export async function searchProjects({ query = '', facets = [], limit = 20, offset = 0, index = 'follows' } = {}) {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    offset: String(offset),
    index,
  });
  if (facets.length) params.set('facets', JSON.stringify(facets));
  const data = await getJSON(`${MODRINTH}/search?${params.toString()}`);
  return data.hits; // [{project_id, slug, title, categories, ...}]
}

export async function getProjectsBatch(ids) {
  if (!ids.length) return [];
  const uniq = [...new Set(ids)];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 100) chunks.push(uniq.slice(i, i + 100));
  const out = [];
  for (const chunk of chunks) {
    const data = await getJSON(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    out.push(...data);
  }
  return out;
}

// Resolve a single name/slug the user typed to a Modrinth project, or null.
export async function findProjectByName(name) {
  const clean = name.trim();
  if (!clean) return null;
  // Try treating it as an exact slug/id first.
  try {
    const p = await getJSON(`${MODRINTH}/project/${encodeURIComponent(clean.toLowerCase().replace(/\s+/g, '-'))}`);
    return p;
  } catch (_) {
    // fall through to search
  }
  const hits = await searchProjects({ query: clean, limit: 5 });
  if (!hits.length) return null;
  const best = hits.find(h => h.title.toLowerCase() === clean.toLowerCase()) || hits[0];
  return getJSON(`${MODRINTH}/project/${best.project_id}`);
}

// Get versions of a project compatible with a loader + game version, newest first.
export async function getCompatibleVersions(projectId, loader, gameVersion) {
  const params = new URLSearchParams();
  params.set('loaders', JSON.stringify([loader]));
  params.set('game_versions', JSON.stringify([gameVersion]));
  return getJSON(`${MODRINTH}/project/${projectId}/version?${params.toString()}`);
}

export async function getTags() {
  const [loaders, gameVersions, categories] = await Promise.all([
    getJSON(`${MODRINTH}/tag/loader`),
    getJSON(`${MODRINTH}/tag/game_version`),
    getJSON(`${MODRINTH}/tag/category`),
  ]);
  return { loaders, gameVersions, categories };
}

// --- Loader version metadata (for the pack's "dependencies" block) ---

export async function getLoaderVersion(loader, gameVersion) {
  try {
    if (loader === 'fabric') {
      const data = await getJSON('https://meta.fabricmc.net/v2/versions/loader');
      const stable = data.find(v => v.stable) || data[0];
      return stable?.version || null;
    }
    if (loader === 'quilt') {
      const data = await getJSON('https://meta.quiltmc.org/v3/versions/loader');
      return data[0]?.version || null;
    }
    // Forge and NeoForge publish version lists as maven-metadata (XML/JSON keyed
    // oddly by Minecraft version) rather than a clean "latest" feed, so we don't
    // guess a specific build here. Prism resolves the recommended Forge/NeoForge
    // build itself from the pack's Minecraft version when none is pinned, so
    // returning null is safe — the UI just tells the user this happens.
    return null;
  } catch (_) {
    return null;
  }
}
