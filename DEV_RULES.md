# Concaretti Development Rules

> [!IMPORTANT]
> **Rule #1: Package Manager**
> ALWAYS use `yarn`. NEVER use `npm`. 
> This is a monorepo using Yarn Workspaces.

## Troubleshooting
- If workspace dependencies fail to resolve, ensure `workspace:*` in `package.json` is replaced with `file:../relative/path` for Yarn 1 compatibility.
