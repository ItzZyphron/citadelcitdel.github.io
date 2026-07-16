// mrpack.js — assembles the modrinth.index.json manifest and zips it into a
// .mrpack file, exactly the format Prism Launcher's "Import" expects.
// No mod jars are ever downloaded by this site — the manifest just points at
// Modrinth's CDN with a hash, and Prism fetches the real files at import time.

import { getLoaderVersion } from './api.js';

const LOADER_DEP_KEY = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

export async function buildMrpack({ name, gameVersion, loader, mods }) {
  const files = mods.map(({ project, version }) => {
    const file = version.files.find(f => f.primary) || version.files[0];
    return {
      path: `mods/${file.filename}`,
      hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
      env: {
        client: project.client_side || 'required',
        server: project.server_side || 'unsupported',
      },
      downloads: [file.url],
      fileSize: file.size,
    };
  });

  const dependencies = { minecraft: gameVersion };
  const loaderVersion = await getLoaderVersion(loader, gameVersion);
  const depKey = LOADER_DEP_KEY[loader];
  if (loaderVersion) {
    dependencies[depKey] = loaderVersion;
  }

  const manifest = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: name || 'Custom Modpack',
    summary: `Generated with ${mods.length} mods for ${loader} ${gameVersion}.`,
    files,
    dependencies,
  };

  const zip = new JSZip();
  zip.file('modrinth.index.json', JSON.stringify(manifest, null, 2));
  // Prism reads client-side overrides from this folder if present; an empty
  // one is harmless, so we skip adding it unless there's real content.
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, manifest, loaderVersionResolved: !!loaderVersion };
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mrpack') ? filename : `${filename}.mrpack`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
