# Forge a Modpack

A small static website that builds a [Prism Launcher](https://prismlauncher.org/)-ready
`.mrpack` modpack — either from a "type" you pick (tech, magic, adventure, optimization…)
or from a short list of mods you already know you want. Caps out at 200 mods.

All mods come from [Modrinth](https://modrinth.com)'s public API. No API key, no backend,
no build step — it's plain HTML/CSS/JS and runs entirely in the visitor's browser.

## How it works

1. You pick a Minecraft version, a loader (Fabric/Forge/Quilt/NeoForge), and either:
   - a **type** — one or more category chips (the pack fills in well-regarded mods
     matching those categories), or
   - a **list** — mod names you type in, one per line
2. The site queries Modrinth for compatible versions of each mod, follows required
   dependencies automatically, and (optionally) tops up the rest of the pack with
   similar, well-regarded mods until it hits your target count (max 200).
3. It assembles a `modrinth.index.json` manifest — the actual file format Prism reads —
   zips it into a `.mrpack`, and offers it as a download. The manifest only contains
   *references* (a CDN URL + hash) to each mod; the site never downloads or hosts mod
   files itself. Prism downloads the real files when you import the pack.

## Running it locally

No build step. Just serve the folder over HTTP (file:// won't work because of
ES module imports):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Create a new GitHub repo and push this folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick your default branch and `/ (root)`, then save.
4. GitHub gives you a URL like `https://<username>.github.io/<repo>/` within a
   minute or two — that's the live site.

No secrets, no GitHub Actions, no `.env` file needed — it's static files only.

## Importing the generated pack into Prism Launcher

1. Download the `.mrpack` file the site generates.
2. In Prism Launcher: **Add Instance** → **Import**.
3. Select the file. Prism installs the loader and every mod automatically.
4. Play.

## Known limitations

- **Modrinth only.** CurseForge's API requires a secret key and doesn't allow
  direct browser requests, so it can't be reached from a static site like this
  one without adding a separate serverless proxy. If you want that later, the
  cleanest path is a small Cloudflare Worker or Netlify Function that holds the
  CurseForge key and forwards search/download requests — happy to help wire
  that in as a follow-up.
- **Forge/NeoForge loader version.** Fabric and Quilt publish a clean "latest
  loader version" feed, so the pack pins one automatically. Forge and NeoForge
  publish their version lists as maven metadata instead, which is messier to
  parse reliably — the generated pack leaves that field unset for those two
  loaders, and Prism will prompt you to confirm the recommended build on
  import. It still works, just with one extra click.
- **"Type" mode quality depends on Modrinth's tagging.** Category matching
  uses Modrinth's own category tags and sorts by follower count, so obscure or
  newly-tagged mods may be under-represented.
- **Rate limits.** Modrinth's public API is rate-limited per IP. Building very
  large packs (150–200 mods) can take a little while since each mod needs a
  couple of API calls to resolve versions and dependencies.

## File structure

```
index.html       — page markup
style.css        — styling
js/api.js        — Modrinth API + loader-version metadata calls
js/resolver.js   — turns your request into a concrete, deduped mod list
js/mrpack.js     — builds the .mrpack (zip) file
js/app.js        — UI wiring
```
