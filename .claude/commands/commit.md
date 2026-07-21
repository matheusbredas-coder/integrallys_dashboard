Stage all changed files and create a git commit.

1. Run `git status` and `git diff` to understand what changed.
2. Run `git log --oneline -5` to match the existing commit message style.
3. Stage only relevant files (avoid secrets, binaries, or unrelated changes).
4. Write a concise commit message focused on WHY, not WHAT. One sentence max.
5. Commit using a HEREDOC so formatting is preserved, and append:
   `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
6. Run `git status` to confirm the commit succeeded.
