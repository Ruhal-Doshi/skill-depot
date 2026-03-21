# skill-depot

> RAG-based skill retrieval system for AI agents. Scalable long-term storage with semantic search via MCP.

**skill-depot** replaces the "dump all skill frontmatter into context" approach with selective, semantic retrieval. Agent skills are stored as Markdown files and indexed with vector embeddings — only the relevant skills are loaded when needed, keeping context lean.

## ✨ Features

- **🔍 Semantic Search** — Find skills by meaning, not just keywords, using embedded vector search
- **🏠 Fully Local** — No API keys, no cloud. Uses SQLite + sqlite-vec for storage and a local transformer model for embeddings
- **🤖 Agent-Agnostic** — Works with Claude Code, Codex, OpenClaw, Gemini, and any MCP-compatible agent
- **📂 Two-Scope Storage** — Global skills (`~/.skill-depot/`) available everywhere, project skills (`.skill-depot/`) synced via git
- **⚡ Auto-Discovery** — Finds existing skills from your AI agents during setup
- **🔌 MCP Protocol** — Integrates seamlessly as an MCP server with 9 tools for skill management
- **📊 Tiered Detail Levels** — Three levels of detail (snippet → overview → full content) to minimize token usage
- **📈 Activity Scoring** — Frequently used skills rank higher in search results automatically
- **🔗 Relation Tracking** — Link related skills together so agents can discover connected knowledge

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
      "args": ["skill-depot", "serve"]
    }
  }
}
```

**Codex / OpenClaw / Cursor**: Add the same MCP server config in your agent's settings.

### 3. Use

Your agent now has access to these tools:

| Tool | Description |
|------|-------------|
| `skill_search` | Semantic search — accepts optional `context` for better relevance |
| `skill_preview` | Get a structured overview (headings + first sentences) without loading full content |
| `skill_read` | Load the full content of a skill |
| `skill_learn` | Learn something new — creates or appends to a skill (upsert) |
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
4. Results include a `hasOverview` flag — agents can load a structured overview (`skill_preview`) or the full content (`skill_read`)

### Tiered Detail Levels

skill-depot serves context at three levels of detail to minimize token usage:

| Level | Tool | What You Get | Typical Size |
|-------|------|-------------|-------------|
| **L0 — Snippet** | `skill_search` | 200-char preview + metadata | ~200 chars |
| **L1 — Overview** | `skill_preview` | Headings + first sentence per section | ~500-2000 chars |
| **L2 — Full** | `skill_read` | Complete raw markdown | Unbounded |

Agents can progressively load detail — check the snippet, preview the outline, and only load full content when needed:

```
Agent → skill_search("deploy nextjs to vercel")
     ← [{ name: "deploy-vercel", score: 0.92, snippet: "...", hasOverview: true }, ...]

Agent → skill_preview("deploy-vercel")
     ← { overview: "## Steps\nInstall the Vercel CLI.\n\n## Configuration\nSet environment variables." }

Agent → skill_read("deploy-vercel")
     ← Full markdown content of the skill
```

### Context-Aware Search

Pass an optional `context` parameter to `skill_search` for more relevant results. The context is combined with the query before generating the search embedding:

```
Agent → skill_search({ query: "deploy", context: "Next.js app with Vercel, fixing CI pipeline" })
     ← deploy-vercel ranks higher than deploy-aws because the context narrows the search
```

### Agent Learning

Agents can save knowledge on the fly using `skill_learn`. If the skill doesn't exist, it's created. If it does, the new content is appended with a `---` separator, and tags/keywords are merged automatically.

```
Agent → skill_learn({ name: "nextjs-gotchas", content: "API routes cache by default...", tags: ["nextjs"] })
     ← { action: "created" }

Agent → skill_learn({ name: "nextjs-gotchas", content: "Image optimization requires sharp...", tags: ["images"] })
     ← { action: "appended" }   // tags merged: ["nextjs", "images"]
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
related: [setup-env-vars, vercel-domains]
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
