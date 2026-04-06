# SwissTransfer Experimental Workflow

SwissTransfer is still experimental in this MCP server because the live site now protects upload creation with reCAPTCHA and a newer `/api` upload flow.

## What works today

- The MCP server understands the current SwissTransfer endpoint family:
  - `/api/containers`
  - `/api/uploadChunk/...`
  - `/api/uploadComplete`
  - `/api/links/{id}`
- `swisstransfer_send` accepts:
  - `recaptcha_token`
  - `recaptcha_version`
  - optional `author_email`
  - normal transfer fields like `files`, `message`, `password`, `expiration_days`, `download_limit`
- `swisstransfer_info` can read transfer metadata and optionally accepts a password

## What does not work automatically

- The server cannot mint a valid SwissTransfer reCAPTCHA token by itself
- Tokens must be generated in the browser on `https://www.swisstransfer.com/`
- Tokens expire quickly, so they should be used immediately

## Fastest workflow

1. Enable the experimental tools:

```bash
export ENABLE_EXPERIMENTAL_SWISSTRANSFER=1
```

2. Generate a helper snippet or bookmarklet:

```bash
npm run swisstransfer:helper
```

Optional:

```bash
npm run swisstransfer:helper -- --copy
npm run swisstransfer:helper -- --bookmarklet --copy
```

3. Open `https://www.swisstransfer.com/`

4. Either:
   - paste the console snippet into DevTools, or
   - click the generated bookmarklet

5. Copy the returned payload:

```json
{
  "recaptcha_token": "...",
  "recaptcha_version": 3
}
```

6. Use that payload immediately with the MCP tool

## Example MCP call

```json
{
  "files": [
    {
      "name": "example.txt",
      "base64_content": "SGVsbG8gd29ybGQ="
    }
  ],
  "recaptcha_token": "<fresh token>",
  "recaptcha_version": 3,
  "expiration_days": 1,
  "download_limit": 1
}
```

## Example live smoke

```bash
ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 \
SWISSTRANSFER_RECAPTCHA_TOKEN='<fresh token>' \
npm run smoke:live
```

## Notes

- The current site key and action inferred from the live frontend are:
  - site key: `6LdcMKgUAAAAAE-v9oXOW9sNCWRiuZga1ayC7a6L`
  - action: `homepage`
- If you pass a fake or stale token, the live API currently responds with `422 "Captcha not valid"`
- If SwissTransfer changes their frontend again, this workflow may need another update
