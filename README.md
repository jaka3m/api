# Cloudflare Proxy Checker (Advanced Worker Version)

This is a proxy checker API running on **Cloudflare Pages** using an Advanced Worker (`_worker.js`).

## Project Structure
```text
/
├── _worker.js       <- Consolidated API logic and Routing
├── index.html       <- Documentation/Frontend
└── package.json     <- Project metadata
```

## Deployment Instructions

### Option 1: GitHub (Recommended)
1. Push this repository to GitHub.
2. In Cloudflare Dashboard, go to **Workers & Pages** > **Create** > **Pages** > **Connect to Git**.
3. Select your repository.
4. **Configuration (IMPORTANT):**
   - **Framework preset:** None
   - **Build command:** (Leave empty)
   - **Build output directory:** `/` (the root)
5. **Settings (CRITICAL):**
   - After the first deployment attempt, go to **Settings** > **Functions**.
   - Under **Compatibility flags**, add `nodejs_compat` to "Production" and "Preview".
   - Set **Compatibility date** to `2024-08-01` or newer.
   - Redeploy the project.

### Option 2: Direct Upload (ZIP)
1. ZIP only `index.html`, `package.json`, and `_worker.js`.
2. **Crucial:** The files must be at the root of the ZIP, not inside another folder.
3. Upload to Cloudflare Pages Dashboard.
4. Follow the same **Settings (CRITICAL)** steps as Option 1.

## Usage
- Check proxy: `https://your-site.pages.dev/check?ip=host:port`
- Diagnostic: `https://your-site.pages.dev/hello`
