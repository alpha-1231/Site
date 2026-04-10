# AboutMySchool User App Standalone Deploy

This folder can be copied into its own Git repository and deployed without the `admin`, `basic`, or `detailed` folders.

## Required data source

The standalone app expects a public raw GitHub data mirror with this structure:

```text
basic/_cards.json
detailed/<slug>.json
```

Use the raw root, not a GitHub web page URL:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>
```

Example:

```text
https://raw.githubusercontent.com/my-edu-admin/hwt_xtuhbGz4p7gHHJ-fUH6T1gVM/main
```

## Files to keep in the standalone repo

Copy everything inside this `user` folder, including:

- `src/`
- `index.html`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `.env.production`
- `.env.example`
- `vercel.json`

Do not commit local-only `.env` files.

## Environment settings

For production at `https://www.aboutmyschool.com/`:

```env
VITE_USER_BASE=/
VITE_SITE_NAME=AboutMySchool
VITE_SITE_ORIGIN=https://www.aboutmyschool.com
VITE_PUBLIC_DATA_ROOT=https://raw.githubusercontent.com/<owner>/<repo>/<branch>
```

If you deploy under a subpath like `https://aboutmyschool.com/user/`:

```env
VITE_USER_BASE=/user/
```

## Local build

```bash
npm install
npm run build
```

Build output goes to `dist/`.

## Vercel deployment from a separate repo

1. Create a new Git repo from this folder's contents.
2. Push that repo to GitHub.
3. Import the repo into Vercel.
4. Keep the project root at the repo root.
5. Vercel should detect the settings from `vercel.json`:
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Either commit `.env.production` with your public values, or add the same values in Vercel Project Settings -> Environment Variables.
7. Deploy.

## How data updates work

- Runtime directory data is fetched from `VITE_PUBLIC_DATA_ROOT`.
- If the raw GitHub data changes, the live app can show updated list/detail data without a rebuild.
- SEO files generated at build time, including `sitemap.xml`, prerendered district pages, field pages, and institution pages, only update when you redeploy.

## Common mistakes

- Using `https://github.com/.../tree/...` instead of the raw GitHub URL.
- Leaving `VITE_USER_BASE=/user/` when deploying at the domain root.
- Keeping the old monorepo `vercel.json` that builds `user/dist` instead of `dist`.
- Forgetting to redeploy after changing the raw data mirror when you want sitemap and prerendered SEO pages refreshed.
