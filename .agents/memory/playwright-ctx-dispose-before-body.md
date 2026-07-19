---
name: Playwright APIRequestContext dispose before body read
description: Must read response body before ctx.dispose(); disposal invalidates the response buffer.
---

## The Rule
Always read `await r.text()` or `await r.json()` BEFORE calling `await ctx.dispose()`.

**Why:** `APIRequestContext.dispose()` closes the underlying network connection and releases response buffers. Any subsequent read on the response throws "apiResponse.json: Response has been disposed".

**How to apply:**
```js
const r = await ctx.post(url, { data });
const status = r.status();
const bodyText = await r.text(); // read BEFORE dispose
await ctx.dispose();             // safe to dispose now
const body = JSON.parse(bodyText);
```
