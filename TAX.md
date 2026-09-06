# Tax notes — smart-entry license sales (Colombia)

> **This file is evidence, not tax advice.** It records what the system captures
> and the relevant rules so the accountant can decide IVA / facturación
> electrónica treatment. The accountant is the authority; this data exists so
> nothing has to be guessed.

## What the system captures (the evidence)

Every sale and refund is written to the server-side sales ledger (Firestore
`sales`), exported at `/api/ledger/export?format=csv`:

- `date`, `order_number`, `status` (paid/refunded/…)
- `gross`, `tax`, `total` (order currency, integer cents), `currency`
- `fees_estimate`, `net_estimate` — Lemon Squeezy baseline fee (5% + $0.50);
  actual fees can include +1.5% surcharges (international card / PayPal) and
  only the **payout reports** itemize them exactly → reconcile monthly.
- `buyer_email`, `license_id`, `receipt_url`, `invoice_url` (LS-generated
  invoice download), `refunded`, `refunded_amount`, `refunded_at`, `test_mode`.

## Structural facts (as data)

- **Lemon Squeezy is a US merchant of record**: the legal sale is between Lemon
  Squeezy (US) and the buyer. The Colombian app owner receives *payouts* from
  Lemon Squeezy, not payments from customers.
- Buyers see **COP** display pricing; processing and payouts are **USD**
  (LS [currencies](https://docs.lemonsqueezy.com/help/payments/currencies),
  [getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid)).
- Payouts to Colombia: bank (Stripe) or PayPal
  ([supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries));
  13-day hold, twice-monthly payouts, $50 minimum.
- The LS order object records `tax` it collected (e.g. US sales tax / EU VAT
  where applicable). Whether LS collects Colombian IVA is a question for LS
  support + the invoice itself — the ledger surfaces whatever the invoice says;
  it never invents a tax position.

## Colombian angles for the accountant (to verify, not assumed)

- **IVA on digital services from abroad (19%)**: Colombia taxes digital
  services provided by non-residents (DIAN rules for importers of digital
  services; reverse-charge/self-assessment mechanics apply in some cases).
  Because the seller of record is LS (US), the applicable regime is the
  accountant's call based on the invoice data above.
- **Deducting costs for foreign digital services without factura electrónica**:
  DIAN has published a procedure for evidencing such costs
  ([Prensa Jurídica note](https://mail.prensajuridica.com/details/item/34503-dian-precis%c3%b3-el-procedimiento-para-acreditar-costos-en-servicios-digitales-extranjeros-sin-factura-electr%c3%b3nica-en-colombia.html?tmpl=component&print=1))
  — the ledger's gross/fees/net per sale + LS invoices/receipts are the
  supporting evidence it describes.
- **Owner income**: payouts received in Colombia are taxable income for the
  owner; the payout reports + ledger net figures are the source data.
- **Chargebacks**: $15 LS dispute fee per chargeback — appears in payout
  reports; keep the ledger in sync via monthly reconciliation.

## Standing rule

When the accountant asks a question the data can answer, export the CSV +
invoices. When they ask a question about treatment, the answer belongs to the
accountant — the system only guarantees the trail.
