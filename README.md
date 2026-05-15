# Cloudflare Proxy Checker (Pages Version)

This is a proxy checker API running on **Cloudflare Pages**.

## Project Structure
```text
/
├── functions/
│   ├── check.js     <- API logic
│   └── hello.js     <- Diagnostic endpoint
├── index.html       <- Documentation/Frontend
├── package.json     <- Project metadata
└── _routes.json     <- Routing configuration
```

## Deployment Instructions

1. **ZIP your files correctly:**
   - Select `index.html`, `package.json`, `_routes.json`, and the `functions` folder.
   - Compress them into a single `.zip` file.
   - **Crucial:** The files must be at the root of the ZIP, not inside another folder.

2. **Upload to Cloudflare Pages:**
   - Go to Cloudflare Dashboard > **Workers & Pages** > **Create** > **Pages** > **Upload assets**.
   - Upload your ZIP file.

3. **Configure Settings (IMPORTANT):**
   - Go to your Pages project > **Settings** > **Functions**.
   - Under **Compatibility flags**, add `nodejs_compat`.
   - Ensure the **Compatibility date** is at least `2024-08-01`.

## Usage
- Check proxy: `https://your-site.pages.dev/check?ip=host:port`
- Diagnostic: `https://your-site.pages.dev/hello`
