# PromptInvoice

Free invoice and payment voucher generator. Live at **https://invoice.flowsxr.com**

I run a small company and didn't want to pay for invoicing software just to send a few invoices and pay a few contractors, so I built this for myself. A few friends use it now too. Feel free to use it.

<p align="center">
  <a href="https://youtu.be/R34zNL89hIw">
    <img src="docs/media/agent-to-pdf.gif" alt="An agent posts a payment voucher as JSON and gets the finished PDF back" width="720">
  </a>
  <br>
  <sub><a href="https://youtu.be/R34zNL89hIw">Watch the 29-second demo on YouTube</a></sub>
</p>

<p align="center">
  <img src="docs/media/five-documents.gif" alt="Invoice, quote, estimate, receipt and payment voucher" width="400">
  <img src="docs/media/agents-page.gif" alt="The guide for agents" width="400">
</p>

## What it does

- Invoices, quotes, estimates, receipts and payment vouchers, with a live preview and a clean PDF.
- Describe the job in plain words and AI drafts it for you.
- Several businesses, a client book, saved documents, 150+ currencies, tax and discounts.
- Free, no sign-up. Everything stays in your browser unless you sign in to share with your team.

## For AI agents

Your agent sends the document as JSON and gets the finished PDF back. No account, no key, nothing stored, and no AI on the server, so it barely uses any tokens.

```bash
curl -sS https://invoice.flowsxr.com/api/pdf -H 'Content-Type: application/json' -o voucher.pdf -d '{
  "docType": "voucher", "number": "PV-2026-014",
  "from": { "name": "Studio Nova Ltd" }, "to": { "name": "Jane Contractor" },
  "items": [ { "description": "Design services, September 2026", "rate": 350 } ],
  "currency": "SGD"
}'
```

Point your agent at **https://invoice.flowsxr.com/agents**. It explains every field, with examples.

## For developers

Static site, no build step. Two small Vercel functions: `api/draft.js` (AI drafting via DeepSeek) and `api/pdf.js` (PDFs for agents).

```bash
npm install
npm start       # http://localhost:8080
npm test
```

To host your own copy, deploy to Vercel and set `DEEPSEEK_API_KEY` for AI drafting. Team sign-in is optional: run `supabase/schema.sql` in a Supabase project and add its URL and anon key to `js/config.js`.

## Privacy

Your documents stay in your browser unless you sign in. The PDF API renders and discards each document. Anonymous usage stats (Google Analytics: pages, document type, approximate location) never include names, amounts or document text.

## Feedback

Email **prasanth@flowsxr.com** or open an [issue](https://github.com/prasanthsasikumar/PromptInvoice/issues). Pull requests welcome.

## License

MIT
