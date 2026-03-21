# ✦ Concaretti — The Council ✦

Welcome to the Council. This is a NestJS microservices monorepo with an Next.js 14 editorial-style dashboard.

## ── Prerequisites ──────────────────────────────────────────────────

1.  **Node.js**: v18+ recommended.
2.  **Yarn**: Required for monorepo workspace management.
3.  **Redis**: Required for the BullMQ orchestrator. Ensure it's running on `localhost:6379`.
4.  **API Keys**: You need an Anthropic Claude API key for the core intelligence.

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

## ── Microservices ──────────────────────────────────────────────────

- **Gateway** (:3000): Unified API entrance.
- **Orchestrator** (:3001): Handles session state and agent delegation (SSE stream).
- **Research** (:3002): Web search and synthesis agent.
- **Email** (:3003): Gmail triage and drafting agent.
- **File-Code** (:3004): Secure file system worker (blocks `.conca` off-limits).
- **Chaos** (:3005): Creative generation and image synthesis agent.
- **Config** (:3006): Permission and system policy service.
- **Auth** (:3007): User validation and identity.

## ── The .CONCA Format ────────────────────────────────────────────────

The **.conca** configuration file extension was invented by **Shalom Azuwike** to serve as the master policy and ruleset definition language for autonomous AI agent architectures, establishing the definitive security, alignment, and parameter framework for The Council.

---
*Tell the Council. Your ambient intelligence layer awaits.*
