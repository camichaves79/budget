# Skill — AI-Assisted Transaction Entry (Speech Entry)

**Status:** Planned — ready for implementation
**Branch:** `speech-entry`

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

## 1. Transaction Button

- Locate the existing "+" transaction button (the FAB on Cash Flow).
- Modify its visual appearance to include a small **lightning-bolt icon** overlaid on
  the "+" icon, communicating smart/AI-assisted entry.
- Preserve the existing position, size, behavior, and visual language unless changes
  are necessary. Lightning icon is visually secondary to the "+". Avoid clutter.
- Reuse existing icon components if available; do not add a new icon dependency unless
  necessary.
- Provide an accessible label such as "Add transaction". Do not rely on the icon alone.

## 2. Smart Transaction Input

When the user taps the transaction button:

- Open the transaction input UI.
- Display ONE text field or textarea for natural-language transaction entry.
- Auto-focus the field so the phone's native keyboard opens.
- The user dictates via the keyboard's native microphone — no custom speech
  recognition.
- Typing must also work normally.

Suggested placeholder: *"Tell me what you spent..."*

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

The LLM returns structured JSON, not prose.

Conceptual schema:

```ts
interface ParsedTransaction {
  type: 'expense' | 'income';
  amount: number;
  category: string | null;
  notes?: string | null;
  date?: string | null;
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

## 6. Confirmation Before Saving

Never auto-save an AI-parsed transaction. After parsing, show a review/edit state
(type, amount, category, note, date) with Cancel / Add Transaction actions.
Reuse the existing `TransactionForm` if possible; do not duplicate creation logic.

Preferred flow: natural-language input → LLM parsing → structured transaction →
review/edit → user confirms → existing transaction creation flow.

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
+ / ⚡ → natural-language input → parse with LLM → review transaction → save
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

- **UI:** button renders with lightning overlay, accessible, tap opens input, input
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
transaction review, existing persistence.

Out (for now): conversational chatbot, custom voice recording, custom speech-to-text,
AI financial advice, AI budgeting recommendations, auto-save without confirmation,
unnecessary cloud/database infrastructure.

## 14. Implementation Checklist

- [ ] Inspect existing transaction architecture
- [ ] Inspect existing categories
- [ ] Inspect existing "+" button
- [ ] Add lightning icon overlay
- [ ] Add natural-language input
- [ ] Auto-focus input on mobile
- [ ] Verify native keyboard dictation works through the focused field
- [ ] Implement secure backend/serverless LLM endpoint (credentials server-side)
- [ ] Define structured transaction schema
- [ ] Restrict LLM categories to app-supported categories
- [ ] Validate LLM output
- [ ] Implement review/edit state (reuse TransactionForm)
- [ ] Reuse existing transaction persistence
- [ ] Handle errors and ambiguous input
- [ ] Preserve manual transaction entry
- [ ] Add tests
- [ ] Verify mobile/PWA behavior
- [ ] Document required environment variables/configuration
- [ ] Document backend/serverless deployment requirements

## Definition of Done

A user can: open the PWA on their phone → tap the transaction button (with lightning
enhancement) → see a single natural-language input field with focus → dictate e.g.
*"I spent 35 dollars on lunch yesterday."* → submit → the LLM converts it to
structured data → the user reviews and edits → confirms → it saves through the
existing persistence mechanism.

The feature should feel like a natural extension of the existing app, not a separate
AI feature bolted on.
