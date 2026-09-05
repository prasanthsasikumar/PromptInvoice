# PromptInvoice

Free invoice and payment voucher generator with AI drafting and shared team workspaces. Live at **https://invoice.flowsxr.com/**

I run a small business and needed a simple way to produce invoices and payment vouchers without paying for yet another subscription. So I built this for myself. Feel free to use it.

If you have feedback, email me at **prasanth@flowsxr.com** or open an [issue](https://github.com/prasanthsasikumar/PromptInvoice/issues) and I will try to fit it in. Or make the change yourself and send a pull request. Have a nice day.

![PromptInvoice hero](docs/screenshots/hero.png)

![Generator with live preview](docs/screenshots/generator.png)

<p align="center">
  <img src="docs/screenshots/sample-invoice.png" alt="The downloaded PDF" width="420">
</p>

## What it does

- Invoices, quotes, estimates, receipts and payment vouchers, with a live A4 preview and a clean PDF.
- Describe the job in plain words and AI drafts the line items, client, tax and terms. No key or setup.
- Several businesses in one place, each with its own logo, signature, bank details and invoice counter. The signature signs vouchers as "Approved by" and appears as the authorised signature on other documents.
- Client book, saved invoices, 150+ currencies, tax, discount, shipping, custom fields.
- Sign in with a work email and everyone at your domain shares the same businesses, clients and invoices.
- Everything stays in your browser unless you sign in. Backup export and import as JSON.

## For developers and agents

Static site, no build. `index.html` plus `css/` and `js/` is the app. One Vercel function in `api/draft.js` calls DeepSeek for AI drafting.

```bash
git clone https://github.com/prasanthsasikumar/PromptInvoice.git
cd PromptInvoice
npm start               # http://localhost:8080, serves the site and mounts api/
npm test                # unit tests: invoice math and the drafting function
npm run test:browser    # end-to-end in headless Chrome (set CHROME=/path/to/chrome if needed)
npm run screenshots     # regenerate docs/screenshots
```

```
js/calc.js            pure invoice math
js/storage.js         localStorage store, cloud-workspace cache when signed in
js/auth.js            magic-link sign-in and per-domain workspace (Supabase)
js/ai.js              browser client for /api/draft
js/app.js             state, form binding, preview rendering, actions
api/draft.js          Vercel function: DeepSeek call, key from DEEPSEEK_API_KEY
supabase/schema.sql   tables, workspace function, row-level security
```

**Hosting your own copy.** Deploy to Vercel. Set `DEEPSEEK_API_KEY` in the project's environment variables for AI drafting (without it the button says drafting is not configured, everything else works). For team sign-in, create a free Supabase project, run `supabase/schema.sql` in its SQL editor, set the Site URL under Authentication to your domain, and put the project URL and anon key in `js/config.js`. Leave both empty for local-only mode.

**Privacy.** Local mode sends nothing anywhere. AI drafting sends your description, business name, currency, tax default and saved client names through the server to DeepSeek. Signing in stores businesses, clients and saved invoices in the host's Supabase project.

## License

MIT
