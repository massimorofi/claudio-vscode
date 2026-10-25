---
name: mcp-integration
description: Summary of all skills for building and wiring Model Context Protocol (MCP) servers, interactive MCP apps/widgets, .mcpb bundles and third-party MCP servers into a plugin. Use when asked to build an MCP server, wrap an API for Claude, expose tools to Claude, create an MCP app with forms or pickers, package an MCP server for distribution, or add an MCP server to a plugin or project.
---

# MCP Server & App Development

Three distinct deliverables get confused constantly: an **MCP server** (tools),
an **MCP app** (interactive UI rendered in chat) and an **MCP bundle**
(`.mcpb`, distribution format with a runtime). Pick the shape before writing code.

## Constituent skills (5)

| Skill | Origin | What it contributes |
|---|---|---|
| build-mcp-server | mcp-server-dev | Entry point: interrogate the use case, pick deployment model (remote HTTP / MCPB / local stdio), pick a tool-design pattern |
| build-mcp-app | mcp-server-dev | Interactive UI/widgets in chat: components, forms, pickers |
| build-mcpb | mcp-server-dev | Package a server as `.mcpb` incl. bundled Node or Python runtime |
| mcp-integration | plugin-dev | Adding/integrating MCP servers in a plugin via `.mcp.json` |
| connector-finder | GitHub app | Locating an existing connector instead of building a new one |

## Consolidated guidance

1. **Discovery before code.** Determine the use case, the data volume, who
   authenticates, and where the data lives *before* scaffolding. The deployment
   model chosen first is very hard to change later.
2. **Pick the deployment model deliberately:**
   - *Remote HTTP* — shared, multi-user, needs OAuth, scales.
   - *Local stdio* — single user, local files, zero infra, fastest to ship.
   - *MCPB* — must ship to others and needs a pinned runtime.
3. **Search before you build.** `connector-finder`: an existing MCP server for
   the target system is almost always better than a new one.
4. **Tools are verbs with narrow contracts.** Each tool: one action, explicit
   typed inputs, a description that says exactly when to call it and when not to.
5. **Apps need a reason to exist.** Only add interactive UI (form, picker,
   preview) when the user's input cannot be captured cleanly in one message.
6. **Integration is a config file.** In a plugin, MCP servers are declared in
   `.mcp.json`; verify the server actually starts and lists its tools before
   claiming the integration works.
7. **Check the live spec.** The MCP spec and Claude's auth/review criteria move
   faster than local knowledge — consult the current Claude connector docs
   before finalizing auth and review-sensitive decisions.

## When to use this skill

"Build an MCP server for…", "wrap this API so Claude can use it", "make a
widget/form in chat", "package this as .mcpb", "add this MCP server to my plugin".
