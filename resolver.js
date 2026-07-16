// resolver.js — the actual "build a modpack" brain.
// Works entirely off Modrinth's public API. No mod files are downloaded here;
// we only ever fetch small JSON metadata (project info + version info),
// which already includes the CDN URL + sha1/sha512 hash for each mod file.

import { searchProjects, getProjectsBatch, findProjectByName, getCompatibleVersions } from './api.js';

const HARD_CAP = 200;

/**
 * @param {Object} opts
 * @param {string} opts.mode          'type' | 'list'
 * @param {string} opts.loader        'fabric' | 'forge' | 'quilt' | 'neoforge'
 * @param {string} opts.gameVersion   e.g. '1.20.1'
 * @param {string[]} opts.categories  for 'type' mode
 * @param {string[]} opts.modNames    for 'list' mode
 * @param {number} opts.targetCount   desired total mods, <= 200
 * @param {boolean} opts.fillRemaining  in 'list' mode, top up with similar mods
 * @param {boolean} opts.includeOptional  pull in optional (not just required) deps
 * @param {(event:Object)=>void} opts.onProgress  called as items resolve, for live UI updates
 */
export async function buildPack(opts) {
  const {
    mode, loader, gameVersion, categories = [], modNames = [],
    targetCount = 60, fillRemaining = true, includeOptional = false,
    onProgress = () => {},
  } = opts;

  const target = Math.min(HARD_CAP, Math.max(1, targetCount));
  const resolved = new Map(); // project_id -> { project, version, reason }
  const skipped = []; // { name, reason }
  const seenNames = new Set(); // for 'list' mode dedupe of user input

  async function tryAddProject(project, reason) {
    if (!project) return false;
    if (resolved.has(project.id)) return true; // already have it
    if (resolved.size >= target) return false;
    let versions;
    try {
      versions = await getCompatibleVersions(project.id, loader, gameVersion);
    } catch (e) {
      skipped.push({ name: project.title, reason: `couldn't check versions (${e.message})` });
      return false;
    }
    if (!versions || !versions.length) {
      skipped.push({ name: project.title, reason: `no ${loader} build for Minecraft ${gameVersion}` });
      return false;
    }
    const version = versions[0];
    resolved.set(project.id, { project, version, reason });
    onProgress({ type: 'added', project, reason, count: resolved.size, target });

    // Pull in dependencies.
    const requiredIds = [];
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type === 'embedded' || dep.dependency_type === 'incompatible') continue;
      if (dep.dependency_type === 'optional' && !includeOptional) continue;
      if (!dep.project_id) continue;
      requiredIds.push(dep.project_id);
    }
    if (requiredIds.length && resolved.size < target) {
      const depProjects = await getProjectsBatch(requiredIds);
      for (const dp of depProjects) {
        if (resolved.size >= target) break;
        await tryAddProject(dp, reason === 'dependency' ? 'dependency' : 'dependency');
      }
    }
    return true;
  }

  // --- Seed the pack ---
  if (mode === 'list') {
    for (const raw of modNames) {
      const name = raw.trim();
      if (!name || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());
      onProgress({ type: 'searching', name });
      let project;
      try {
        project = await findProjectByName(name);
      } catch (e) {
        project = null;
      }
      if (!project) {
        skipped.push({ name, reason: 'not found on Modrinth' });
        continue;
      }
      await tryAddProject(project, 'requested');
    }
  } else {
    // 'type' mode — nothing seeded explicitly, category search fills everything below.
  }

  // --- Fill remaining slots ---
  const shouldFill = mode === 'type' || (mode === 'list' && fillRemaining);
  if (shouldFill && resolved.size < target) {
    let categoryFacets = categories;
    if (mode === 'list') {
      // Infer categories from what got resolved so far (majority tags).
      const tally = new Map();
      for (const { project } of resolved.values()) {
        for (const c of project.categories || []) tally.set(c, (tally.get(c) || 0) + 1);
      }
      categoryFacets = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
    }

    const facets = [
      ['project_type:mod'],
      [`categories:${loader}`],
      [`versions:${gameVersion}`],
    ];
    if (categoryFacets.length) facets.push(categoryFacets.map(c => `categories:${c}`));

    let offset = 0;
    const pageSize = 40;
    let exhausted = false;
    while (resolved.size < target && !exhausted) {
      let hits;
      try {
        hits = await searchProjects({ facets, limit: pageSize, offset, index: 'follows' });
      } catch (e) {
        break;
      }
      if (!hits.length) { exhausted = true; break; }
      for (const hit of hits) {
        if (resolved.size >= target) break;
        if (resolved.has(hit.project_id)) continue;
        onProgress({ type: 'searching', name: hit.title });
        const project = await getProjectsBatch([hit.project_id]).then(p => p[0]);
        await tryAddProject(project, mode === 'type' ? 'category match' : 'recommended');
      }
      offset += pageSize;
      if (hits.length < pageSize) exhausted = true;
    }
  }

  return {
    mods: [...resolved.values()],
    skipped,
  };
}
