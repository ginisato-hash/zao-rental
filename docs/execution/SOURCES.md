# Official sources checked on 2026-09-10

仕様は変わり得るため、E00でinstalled versionと認証/planを確認する。以下は機能根拠であり、このプロジェクトで既に接続済みという意味ではない。

## S1 — OpenAI: Git worktrees
https://learn.chatgpt.com/docs/environments/git-worktrees

並列の分離とsetup。DB等の隔離は本計画で追加する設計。

## S2 — OpenAI: Non-interactive mode
https://learn.chatgpt.com/docs/non-interactive-mode

codex exec、JSON出力、schema、認証、sandbox。

## S3 — OpenAI: Build skills
https://learn.chatgpt.com/docs/build-skills

必要時に読む反復手順。

## S4 — Anthropic: Claude Code GitHub Actions
https://code.claude.com/docs/en/github-actions

イベント起動、subscription OAuth/API認証、公式setup。

## S5 — OpenAI: AGENTS.md
https://learn.chatgpt.com/docs/agent-configuration/agents-md

repo単位の永続実装指示。

## S6 — Anthropic: Hooks
https://code.claude.com/docs/en/hooks-guide

補助的な検証/通知。

## S7 — GitHub: Secure use
https://docs.github.com/en/actions/reference/security/secure-use

token、workflow、外部codeの境界。

## S8 — Playwright: CI / traces
https://playwright.dev/docs/ci

CIでのbrowser検証。trace https://playwright.dev/docs/trace-viewer

## S9 — OpenAI: Scheduled tasks
https://learn.chatgpt.com/docs/automations?surface=app

ローカルprojectの稼働要件・承認/権限。

## S10 — OpenAI: ChatGPT Work and Codex
https://help.openai.com/en/articles/20001275

ChatGPT認証はplanの利用、API認証はAPI課金。rolloutで画面差あり。

## S11 — Anthropic: Team Claude Code
https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan

Team全seat対応。席数 https://support.claude.com/en/articles/9266767-what-is-the-team-plan

## S12 — GitHub: Protected branches
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

private repoのplan条件。

## S13 — GitHub: GITHUB_TOKEN
https://docs.github.com/en/actions/concepts/security/github_token

自動生成イベントの発火制限/承認待ち。

## S14 — Square: Sandbox
https://developer.squareup.com/docs/devtools/sandbox/overview

架空データで支払を検証。

## S15 — Anthropic: Programmatic CLI
https://code.claude.com/docs/en/headless

ローカルreview fallbackの -p / JSON。
