# skill-depot

> RAG-based skill retrieval system for AI agents. Scalable long-term storage with semantic search via MCP.

**skill-depot** replaces the "dump all skill frontmatter into context" approach with selective, semantic retrieval. Agent skills are stored as Markdown files and indexed with vector embeddings — only the relevant skills are loaded when needed, keeping context lean.

## ✨ Features

- **🔍 Semantic Search** — Find skills by meaning, not just keywords, using embedded vector search
- **🏠 Fully Local** — No API keys, no cloud. Uses SQLite + sqlite-vec for storage and a local transformer model for embeddings
- **🤖 Agent-Agnostic** — Works with Claude Code, Codex, OpenClaw, Gemini, and any MCP-compatible agent
- **📂 Two-Scope Storage** — Global skills (`~/.skill-depot/`) available everywhere, project skills (`.skill-depot/`) synced via git
- **⚡ Auto-Discovery** — Finds existing skills from your AI agents during setup
- **🔌 MCP Protocol** — Integrates seamlessly as an MCP server with 7 tools for skill management

## 🚀 Quick Start

### 1. Initialize

```bash
npx skill-depot init
```

This will:
- Create the `~/.skill-depot/` global directory
- Scan for existing skills in Claude Code, Codex, OpenClaw directories
- Let you select which skills to import via an interactive checklist
- Download the embedding model (~80MB, one-time)
- Index all imported skills

### 2. Configure Your Agent

Add skill-depot to your agent's MCP configuration:

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "skill-depot": {
      "command": "npx",
      "args": ["skill-depot", "serve", "--project", "/absolute/path/to/your/project"]
    }
  }
}
```

**Codex / OpenClaw**: Add the same MCP server config in your agent's settings.

### 4. Advanced: Global vs Project Setup

Depending on your agent, MCP servers can be configured globally or per-project.

**Global Config (e.g., Claude Code)**  
If configured globally in `~/.claude/mcp.json`, the background daemon runs from your home directory. Therefore, you **must** pass the absolute `--project` path so the server finds the correct `.skill-depot/index.db`.

**Project-Level Config (e.g., Cursor, Windsurf)**  
If configured per-project (e.g., inside `.cursor/mcp.json`), the agent naturally starts `skill-depot` inside the active repository. In this case, you can omit the `--project` flag:
```json
"args": ["skill-depot", "serve"]
```

### 3. Use

Your agent now has access to these tools:

| Tool | Description |
|------|-------------|
| `skill_search` | Semantic search — returns metadata + snippets |
| `skill_read` | Load the full content of a skill |
| `skill_save` | Save a new skill and index it |
| `skill_update` | Update an existing skill |
| `skill_delete` | Remove a skill |
| `skill_reindex` | Rebuild the search index |
| `skill_list` | List all indexed skills |

## 📖 How It Works

### The Problem

Traditional agent skill systems load **all** skill file frontmatter into the agent's context window every session. With a large skill library, this wastes precious context on irrelevant information.

### The Solution

skill-depot acts as a **RAG layer** for agent skills:

1. Skills are stored as Markdown files with YAML frontmatter
2. Each skill is embedded into a 384-dimensional vector using a local transformer model
3. When an agent needs a skill, it searches by meaning — only the most relevant skills are returned
4. The agent can then load the full content of selected skills via a second tool call

```
Agent → skill_search("deploy nextjs to vercel")
     ← [{ name: "deploy-vercel", score: 0.92, snippet: "..." }, ...]

Agent → skill_read("deploy-vercel")
     ← Full markdown content of the skill
```

### Storage Architecture

```
~/.skill-depot/               # Global (all projects)
├── config.json
├── models/                    # Embedding model cache
├── skills/                    # Global skill files
└── index.db                   # SQLite + vector index

<project>/.skill-depot/        # Project-level (git-synced)
├── skills/                    # Project-specific skills
└── index.db                   # Project vector index (gitignored)
```

## 🛠️ CLI Reference

```bash
# Setup
skill-depot init               # Interactive setup + agent discovery
skill-depot init --auto         # Non-interactive, import everything

# Server
skill-depot serve --project .   # Start MCP server (foreground/stdio)
skill-depot start --project .   # Start as background daemon
skill-depot stop                # Stop daemon
skill-depot status              # Check daemon status
skill-depot restart             # Restart daemon

# Skill Management
skill-depot add <file>          # Add a skill file (project scope)
skill-depot add <file> --global # Add as global skill
skill-depot remove <name>       # Remove a skill
skill-depot list                # List all skills
skill-depot list --global       # List global skills only
skill-depot search <query>      # Search skills from CLI

# Maintenance
skill-depot reindex             # Rebuild all indexes
skill-depot doctor              # Health check
```

## 📝 Skill Format

Skills use standard YAML frontmatter + Markdown — the same format used by Claude Code, Codex, and other agents:

```markdown
---
name: deploy-to-vercel
description: How to deploy a Next.js application to Vercel
tags: [deployment, vercel, nextjs]
keywords: [vercel cli, production build, environment variables]
---

## Steps

1. Install the Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the project root
3. Follow the prompts to link your project
...
```

## 🏗️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ESM) |
| Database | SQLite via `better-sqlite3` |
| Vector Search | `sqlite-vec` extension |
| Embeddings | `@xenova/transformers` (`all-MiniLM-L6-v2`) |
| Fallback | BM25 term-frequency hashing |
| Protocol | MCP via `@modelcontextprotocol/sdk` |
| CLI | `commander` + `inquirer` + `chalk` + `ora` |

## 🤝 Contributing

Contributions are welcome! This is an open-source project.

```bash
# Clone and install
git clone https://github.com/your-username/skill-depot.git
cd skill-depot
pnpm install

# Development
pnpm dev       # Watch mode build
pnpm test      # Run tests
pnpm lint      # Type check
pnpm build     # Production build
```

## 📄 License

MIT
