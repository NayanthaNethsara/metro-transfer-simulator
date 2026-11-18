# Agent Rules

General rules and technical conventions for working in the Metro Transfer Simulator codebase.

## Code Style

- Keep proper folder structure.
- Code should be self-explanatory (clear descriptive names, small focused functions).
- Do not comment. Only comment when strictly necessary to explain non-obvious business intent or hardware constraints.
- No unused abstractions, no speculative or future-proofing code. Build only what is asked.
- Use semantic color tokens (`bg-success`, `text-destructive`, etc.), not raw colors.
- Keep one color language per visual signal. Do not reuse the same palette for two different meanings in the same view.
- Strictly no emojis anywhere in responses, comments, or code.

## Change Requests

- Do not agree with every requested change. First judge whether it is needed (correctness, requirements) or only optional polish, and what complexity it adds.
- Say plainly when a change is unnecessary, low-value or overcomplicated, and recommend the simpler option or no change.

## Git Conventions

- Do not commit or push. The user reviews and commits changes themselves.
- Do not add AI as a co-author in commit messages.
- Commit messages should be short, descriptive, and to the point, in the form `type: description` with `feat`, `fix`, `chore`, `docs`, `refactor`, or `test`.