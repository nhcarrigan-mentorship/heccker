# ✦ Concaretti — The Council ✦

Welcome to the Council. This is a NestJS microservices monorepo with an Next.js 14 editorial-style dashboard.

## ── Prerequisites ──────────────────────────────────────────────────

1.  **Node.js**: v18+ recommended.
2.  **Yarn**: Required for monorepo workspace management.
3.  **Redis**: Required for the BullMQ orchestrator. Ensure it's running on `localhost:6379`. See [Redis Configuration](#-redis-configuration-) below.
4.  **API Keys**: You need a Google Gemini API key for the core intelligence core.

## ── Quick Start ────────────────────────────────────────────────────

1.  **Install dependencies**:
    ```powershell
    yarn install
    ```

2.  **Setup Environment**:
    Create a `.env` file in the root (copy from [.env.template](.env.template)) and fill in your keys:
    - `GEMINI_API_KEY` (Required for the intelligence core)
    - `TAVILY_API_KEY` (For Research Agent)
    - `REPLICATE_API_TOKEN` (For Chaos Agent image generation)
    - `GOOGLE_` keys (For Email Agent OAuth)

3.  **Launch the Council**:
    Run the PowerShell start script from the monorepo root:
    ```powershell
    .\start-all.ps1
    ```
    This will launch all 8 microservices and the web client in separate windows. High-quality logs will appear in each.

4.  **Open Dashboard**:
    Navigate to [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to see the editorial UI.

## ── Redis Configuration ──────────────────────────────────────────

### Ubuntu / WSL2
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable redis-server.service
sudo systemctl start redis-server.service
# Verify connection
redis-cli ping # Should return PONG
```

### macOS (Homebrew)
```bash
brew install redis
brew services start redis
# Verify connection
redis-cli ping # Should return PONG
```

### Windows
**Option 1: WSL2 (Recommended)**
Follow the Ubuntu instructions above inside your WSL2 instance.

**Option 2: Docker**
```bash
docker run -d --name redis -p 6379:6379 redis
```

## ── New in V2 ──

- **Sequential Workflow Engine**: Agents now chain execution. Research output feeds Email drafts; GitHub status feeds daily reports.
- **GitHub Agent**: Monitor commits, PRs, and CI runs automatically.
- **News Agent**: Real-time RSS/News digestion for AI and Tech topics.
- **Scheduler Agent**: Cron-based automated triggers via `.conca`.
- **Redis Persistence**: Every task and agent state is now persisted in Redis.
- **Unified Pulse**: Centralized agent status broadcasting.

## ── Microservices ──────────────────────────────────────────────────

- **Web Dashboard** (:3000): Next.js 14 Editorial UI.
- **Orchestrator** (:3001): Handles session state, agent chaining, and SSE streaming.
- **Research** (:3002): Web search and synthesis agent.
- **Email** (:3003): Gmail triage and drafting agent.
- **File-Code** (:3004): Secure file system worker (blocks `.conca` off-limits).
- **Chaos** (:3005): Creative generation and image synthesis agent.
- **Config** (:3006): Permission and system policy service.
- **Auth** (:3007): User validation and identity.
- **GitHub Agent** (:3008): Repository monitoring and CI status worker.
- **News Agent** (:3009): RSS and NewsAPI digestion worker.
- **Scheduler Agent** (:3010): Cron-based task trigger service.
- **Gatekeeper** (:3011): Unified API entrance.

## ── The .CONCA Format ────────────────────────────────────────────────

The **.conca** configuration file extension was invented by **Shalom Azuwike** to serve as the master policy and ruleset definition language for autonomous AI agent architectures, establishing the definitive security, alignment, and parameter framework for The Council.

### Publishing Recommendation

- Keep your real `.conca` local-only. It can contain environment-specific policy and security boundaries.
- Commit `.conca.example` as the public template for contributors.
- New contributors can bootstrap with:
    ```powershell
    Copy-Item .conca.example .conca
    ```

---
*Tell the Council. Your ambient intelligence layer awaits.*
