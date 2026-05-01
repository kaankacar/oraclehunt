# OpenAI Provider Migration Plan

This provider switch is intentionally deferred until the broken-flow fixes are stable in production.

## Target Secrets and Vars

- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL=gpt-5.4-mini`
- `OPENAI_IMAGE_MODEL=gpt-image-2`

## Scope

- Add an OpenAI provider route for text oracles after Composer, Scholar, Hidden Oracle, voting, and margin display are verified.
- Keep Scholar on Stella direct unless product requirements change.
- Move Painter image generation to `gpt-image-2` in the same provider migration, not in this fix batch.
- Keep current Gemini behavior for Seer, Scribe, Informant, and Painter until this migration is executed.

## Verification

- Compare outputs and error handling against current Gemini behavior.
- Confirm token and image cost estimates before updating Agentic Economy fields.
- Deploy behind env-based provider selection first, then switch production defaults after one successful smoke test per oracle.
