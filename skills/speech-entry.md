# Skill — AI-Assisted Transaction Entry (Speech Entry)

**Status:** Implemented — UX revised (instant save + fading feedback, 2026-09); extended
with multi-transaction batch entry and confidence-graded review (2026-09, branch
`multi-transaction-entry`).

## Goal

Allow the user to enter a budget transaction using natural language, preferably
through the phone's native keyboard dictation.

Example: *"I spent 35 dollars on lunch yesterday."*

The application should turn this into structured transaction data such as:

```json
{
  "type": "expense",
  "amount": 35,
  "category": "Food",
  "notes": "Lunch",
  "date": "2026-09-03"
}
```

The LLM interprets the user's language. It must **not** be responsible for financial
calculations.

## 1. Transaction Button (revised)

- The "$" transaction button opens smart entry. It lives in the **tab bar** and is
  visible in all four sections (2026-09 relocation): a circular button centered on
  the bar, its horizontal diameter aligned with the bar's upper side; tapping it
  switches to Cash Flow and opens the input.
- The glyph is a **bold "$"** on a coin-style circle — engraving-green disc, thin
  white rim, thin green outer ring (2026-09 user direction). A lightning overlay
  was tried and removed (2026-09); the button stays visually simple.
- Provide an accessible label such as "Add transaction". Do not rely on the glyph alone.

## 2. Smart Transaction Input

When the user taps the transaction button:

- Open the transaction input UI.
- Display ONE text field or textarea for natural-language transaction entry.
- Auto-focus the field so the phone's native keyboard opens.
- The user dictates via the keyboard's native microphone — no custom speech
  recognition.
- Typing must also work normally.
- The user may describe SEVERAL transactions in one message ("300 in bread, 2000 bus
  home, 30000 in a hamburger, and yesterday 20000 in a pizza slice"). Each described
  transaction must be parsed and recorded separately.

Suggested placeholder (2026-09 revision): *"Use your keyboard's microphone 🎤"* —
localized per UI language (`smart.placeholder` in `src/lib/i18n.ts`; the mic
emoji stays across languages).

Use the existing design system and responsive behavior.

**Important:** the PWA must NOT attempt to programmatically activate the keyboard's
microphone/dictation button.

Intended flow: tap button → text field opens and receives focus → native keyboard
appears → user taps keyboard mic → speech becomes text → user submits.

## 3. Submission and API Architecture

On submit:

- Validate the field is not empty.
- Send the natural-language text to the app's backend/API layer.
- **Never expose an LLM API key in the React frontend.**
- If no backend/API abstraction exists, create the smallest appropriate
  server-side/serverless integration point (this app currently has NONE — it is a
  static site; see `skills/project-skill.md`).
- Treat the LLM response as untrusted external data; validate before creating a
  transaction.

Preferred architecture:

```
React PWA → HTTPS → Serverless/API endpoint (key server-side) → LLM provider
→ structured JSON → validation → transaction review UI → existing persistence
```

The frontend should not call the LLM provider directly if that would expose credentials.

## 4. LLM Output

The LLM returns structured JSON, not prose. One utterance → **one JSON array** with one
element per transaction (usually a single element).

Conceptual schema (per element):

```ts
interface ParsedTransaction {
  type: 'expense' | 'income';
  amount: number;
  category: string | null;
  notes?: string | null;
  date?: string | null;
  confidence: number; // 0–1 self-assessed certainty (certainty grading)
}
```

Adapt this to the existing transaction model: `Transaction` in `src/lib/types.ts`
(type, amountCents integer centavos, categoryId, date ISO, note).

**Category handling:** the LLM must use the application's existing categories
(user-editable, from `data.categories`) rather than inventing arbitrary ones. Pass
the allowed categories to the LLM and require the model to select from them.
Do not create a competing category system.

## 5. Ambiguous Input

Handle incomplete or ambiguous input safely, e.g.:

*"I spent about 50 on something for the house."*

```json
{ "type": "expense", "amount": 50, "category": null, "notes": "Something for the house", "date": null }
```

Do not silently create an incorrect transaction. If required information can't be
determined, let the user provide or select the missing information. No complex
confidence-scoring system unless it fits naturally.

**Certainty grading (2026-09):** each element carries a `confidence` grade (0–1).
Entries below `REVIEW_CONFIDENCE_THRESHOLD` (0.8) are flagged as doubtful and go
through the review form **pre-filled with the model's guess** instead of instant-save
— even when every field parsed. The review hint states the model's certainty
("I'm only 62% sure about this one"). Missing confidence defaults to 1 (behaves like
before); malformed values count as 0 (always review). The prompt also asks the model
to lower confidence and null out any field it is unsure about.

## 6. Instant Save with Transient Feedback (revised)

The submit button is labeled **Submit** (not "Parse" — keep copy user-friendly).

On submit, show a busy state ("Submitting…"), then immediately show a transient
message: a friendly error that fades away on failure, or a brief success
confirmation on success. Messages appear, stay long enough to read (~4s), then
fade out and disappear. Use the existing error/notification patterns and the
design system.

- **Complete parse** (type, amount, and a category the user actually has): save
  immediately through the existing persistence (`addTransaction`), close the
  sheet, and show the fading confirmation (e.g. "Added Restaurantes · $ 35").
- **Ambiguous parse** (no mappable category): NEVER save silently — fall back to
  the review/edit form (reuse `TransactionForm`) so the user completes the
  missing information, then confirm with one tap.
- **Failure**: show a friendly fading error message and keep the user's text so
  they can retry or edit.

Preferred flow: natural-language input → Submit → LLM parsing → structured
transaction → instant save + fading confirmation (or review form for ambiguous
input) → done.

**Batch entry (2026-09):** when one utterance parses to several transactions, the
user's chosen UX is **instant-save with a "Recorded" summary** — no confirm gate:

- Confident, complete entries save immediately (in order).
- Doubtful or ambiguous entries queue through the review form one at a time
  (pre-filled when there's a guess; "Save & next" / "Skip this one" / "Back to text").
  They are NEVER saved silently.
- Afterwards the sheet shows exactly what was recorded (category, date/note, amount,
  total) plus a pointer that any entry can be edited from the list anytime, and
  "Done" / "Record more".
- Mixed case: the instantly-saved part is announced with a fading toast before the
  review queue starts.
- The single-entry flow (1 element) is unchanged: confident → instant save + toast;
  doubtful/ambiguous → the existing review form.

## 7. Error Handling

Handle at least: empty input, LLM/API unavailable, network failure, invalid LLM
response, missing amount, missing category, unsupported category, malformed data,
user cancellation.

Use the existing error/notification patterns. Do not expose API keys, internal
prompts, raw provider errors, or backend implementation details.

## 8. Mobile/PWA Considerations

- Auto-focus the text field after the button tap; keyboard must open.
- Keep input/review UI visible when the keyboard is open; avoid viewport breakage.
- Support iOS and Android browsers/PWA environments.
- Fall back gracefully to normal typing if dictation is unavailable.
- Avoid unintended submission when Enter is pressed in a multiline textarea.
- No browser Speech Recognition APIs for the initial implementation.

## 9. Preserve Existing Functionality

The existing manual transaction-entry workflow must keep working. If the "+" button
currently opens a manual form (it does — `TransactionForm`), choose the least
disruptive UX. A reasonable target flow:

```
+ → natural-language input → Submit → instant save + fading confirmation
  (review form only for ambiguous input)
```

Provide an obvious way to switch between natural-language/AI entry and manual entry.
Reuse the existing manual form rather than duplicating it.

## 10. Architecture and Code Quality

Inspect the existing codebase (see `skills/project-skill.md`) and follow existing
patterns: React project structure, transaction model, creation flow, category
definitions, state management (Context + useReducer), form/validation patterns,
icon usage (inline stroke SVGs), UI components (Sheet, AmountInput, TransactionForm),
error handling.

- Avoid unnecessary dependencies.
- Isolate the LLM integration behind a service/API boundary so the provider can be
  replaced without rewriting the transaction UI.
- Use TypeScript throughout.

## 11. Testing

Add appropriate tests for:

- **UI:** button renders as a plain "+", accessible, tap opens input, input
  receives focus, manual flow still works.
- **Parsing:** successful response, invalid response, missing fields, unsupported
  category, ambiguous input, API/network failure.
- **Flow:** parsed transaction shown for review, editable, cancelable; confirming
  uses existing persistence; nothing saved from invalid/unconfirmed output.

## 12. Security and Privacy

- Never expose the LLM API key to the client.
- Send only the minimum information required for parsing (current utterance +
  allowed categories; never full transaction history).
- Do not log transaction text or financial information unnecessarily.
- Do not persist dictated text unnecessarily.

## 13. Initial Implementation Scope

In: natural-language entry, native keyboard dictation, LLM structured extraction,
transaction review, existing persistence, multi-transaction batch entry,
confidence-graded review (doubtful entries flagged for the user).

Out (for now): conversational chatbot, custom voice recording, custom speech-to-text,
AI financial advice, AI budgeting recommendations, auto-save without confirmation,
unnecessary cloud/database infrastructure.

## 14. Implementation Checklist

- [ ] Inspect existing transaction architecture
- [ ] Inspect existing categories
- [ ] Inspect existing "+" button
- [ ] Add-button glyph: bold "$" in the coin-style circle (lightning overlay removed — see §1)
- [ ] Add natural-language input
- [ ] Auto-focus input on mobile
- [ ] Verify native keyboard dictation works through the focused field
- [ ] Implement secure backend/serverless LLM endpoint (credentials server-side)
- [ ] Define structured transaction schema
- [ ] Restrict LLM categories to app-supported categories
- [ ] Validate LLM output
- [ ] Implement review/edit state ONLY for ambiguous parses (reuse TransactionForm)
- [ ] Transient fading success/error feedback (~4s)
- [ ] Reuse existing transaction persistence
- [ ] Handle errors and ambiguous input
- [ ] Preserve manual transaction entry
- [ ] Add tests
- [ ] Verify mobile/PWA behavior
- [ ] Document required environment variables/configuration
- [ ] Document backend/serverless deployment requirements
- [x] Batch entry: one utterance → array of transactions, each saved/reviewed
      independently (2026-09)
- [x] Confidence grading: doubtful entries (< 0.8) go to pre-filled review, never
      instant-save (2026-09)
- [x] "Recorded" summary after a batch saves, with edit-anytime guidance (2026-09)
- [x] Free allowance counter (10 parses/day, counts submissions not retries) (2026-09)
- [x] Paywall card replaces the input at 0 remaining (copy + $5/year checkout +
      manual-entry pointer) (2026-09)
- [x] Licensed requests attach the stored license token; server verifies HMAC +
      meters (100/day) per parse (2026-09)
- [x] Purchase redirect → server-side redeem → license auto-stored; Settings
      fallback (sign-in restore + paste-key) never the main path (2026-09)
- [x] Voice auto-send: 2.5s of input quiet → countdown + cancel → submit;
      3-char minimum gates both paths (2026-09, §16)

## 15. Paywall gating (2026-09)

Smart entry is free for **10 parses/day** (a submission counts once; the automatic
~2s retry does not). When the daily allowance is exhausted and no license is stored,
the smart sheet shows a **paywall card** instead of the input:

- Copy: the user has used today's 10 free smart entries (they reset at midnight).
- Primary action: **sign in with Google, then "Unlock unlimited smart entry —
  $5/year"** → Lemon Squeezy checkout overlay (fallback: open in Safari/tab),
  redirect back with the order reference. **Purchases always require sign-in**
  (2026-09): every license is bound to the account at mint time, so the
  paywall card's button signs the user in first and only then opens checkout.
- Secondary path stays visible: "Enter manually instead" — manual entry always works.

Licensed users never see the card: the stored license (HMAC-signed server-side,
verified on every parse, 100/day meter) marks the sheet "Unlimited" and parse
requests attach the token. The purchase path is automatic — redirect → redeem at
`/api/license/redeem` → token stored → entitlement bound to the signed-in Google
account (restored on any device/reinstall). License management lives in Settings →
License (status, sign in/out, paste-key recovery fallback — never the main path).
Details: `ARCHITECTURE.md` A12–A14; ops checklist: `skills/paywall-ops.md`.

## 16. Voice auto-send (2026-09, iPhone-approved)

Dictation gives the app **no signal** (no mic-tap / speaking / speech-ended
events; the Web Speech API stays off-limits), so "the user has finished" is
inferred from input silence:

- Every `input` event on the smart-entry textarea restarts a quiet-pause
  timer (`AUTO_SEND_PAUSE_MS` = **2500 ms** in `SmartEntry.tsx`). When it
  fires, the existing submit path runs automatically.
- While waiting, the sheet shows **"Sending in 2s… / 1s…"** with a **Cancel**
  link (`smart.autoSendIn` in all ten catalogs); any new input restarts the
  timer, any view transition (review queue, summary, manual mode, submit in
  flight, sheet close) cancels it, and timers die on unmount.
- **Minimum length:** both the auto-send and the Submit button require
  **3 trimmed characters** (`MIN_SEND_LENGTH`) — accidental one-tap /
  stray-character entries can't send (or burn quota).
- **No error loop:** after a failed parse the text is kept for retry and the
  auto-send never re-arms for the same string; editing the text re-arms it.
- Submitting still works instantly at any time; auto-send is a convenience
  on top, never a replacement.

## Definition of Done

A user can: open the PWA on their phone → tap the + transaction button → see a
single natural-language input field with focus → dictate e.g.
*"I spent 35 dollars on lunch yesterday."* → tap Submit → the LLM converts it to
structured data → the app saves it immediately with a brief fading confirmation
(or shows the review form when the category is unclear) → saved through the
existing persistence mechanism.

A user can also dictate several transactions at once — *"300 in bread, 2000 in a bus
home, 30000 in a hamburger, and yesterday 20000 in a pizza slice"* — and each one is
processed and properly recorded: confident entries save instantly, doubtful or
unclear ones are checked first, and a summary shows exactly what was recorded.

The feature should feel like a natural extension of the existing app, not a separate
AI feature bolted on.
