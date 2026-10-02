# Agent PDF API: design

Date: 2026-10-02. Requested by Prasanth: "update PromptInvoice so that I or someone else could easily generate docs
with the help of agents. Include a page with what agents need to understand. Then update the README."
He was away while this was built, so the decisions below were made without a review round; each is easy to change.

## What ships

1. `POST /api/pdf`: a document as JSON in, the PDF out (`application/pdf`). Same rendering as the Download PDF button.
2. `GET /api/pdf`: machine-readable usage (fields, defaults, limits, an example) as JSON.
3. `/agents`: one page that tells an agent (or a person helping one) everything: the endpoint, every field, examples
   for an invoice and a payment voucher, limits, privacy, and how to hand a document back to a human.
4. `/llms.txt`: the conventional short pointer for LLM agents, linking to `/agents`.
5. README: a "For agents" section.

## Decisions

- **Render with the app itself, server-side.** Headless Chromium on Vercel (`@sparticuz/chromium` + `puppeteer-core`)
  loads the app's own `index.html`, CSS and JS from the function bundle through request interception on a private
  origin, seeds the document the same way the browser keeps a draft, and prints with the app's print CSS. No second
  template to drift out of sync with the UI.
- **Stateless and keyless.** The API stores nothing and needs no key, like the rest of the free site. Saving into a
  signed-in workspace is not part of this change (it needs per-user auth); agents return the PDF and, if a person
  wants it in their history, they recreate it in the UI.
- **Totals are computed by the app** (`js/calc.js`), never trusted from the caller, so a PDF always adds up.
- **Validation with clear errors** (400 with a list of field problems) so an agent can fix and retry without a human.
- **Limits:** request body up to 4 MB (Vercel's cap is 4.5 MB); up to 200 line items; logo and signature as
  `data:image/png|jpeg|webp|svg+xml;base64` up to 1 MB each; currency must be one the app knows.
- **External requests are blocked during rendering** (no Supabase sign-in, no fonts from other hosts), so a render is
  fast, private, and identical every time.

## Testing

- `tests/document.test.js`: normalising and validating input (pure).
- `tests/pdf.test.js`: the handler with the renderer stubbed (methods, errors, headers, filename).
- `tests/pdf.browser.test.mjs`: a real render with local Chrome (`CHROME=...`), text checked with `pdftotext` when available.
- After deploy: a live `curl` against the preview, then production.
