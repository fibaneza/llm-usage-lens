---
name: obsidian-sync
summary: Sync Markdown files from a Claude project directory to an Obsidian vault using the Obsidian MCP API. Ensures all files are up-to-date, have full content, use Obsidian-style links, and removes obsolete files from the vault.
---

# Claude → Obsidian Vault Sync Skill

## Purpose

Synchronize all Markdown files from a Claude project directory (e.g., `.claude/`) to an Obsidian vault using the Obsidian MCP API. **The project directory is the source of truth.**
This skill:
- Copies all `.md` files (and optionally subdirectories) to the vault, preserving full file bodies.
- Converts all internal Markdown links to Obsidian-style links (`[[path/to/file]]`).
- Removes any Markdown files from the vault that no longer exist in the source directory.
- **Never deletes or modifies files in the project directory.**
- If a file is deleted in the vault, it is restored from the project directory on the next sync.
- If a file is deleted in the project directory, it is deleted from the vault on the next sync.
- The vault always reflects the current state of the Claude project directory, never the reverse.

## Usage
- Trigger: `/obsidian-sync` or as part of a project sync workflow.
- Parameters:
  - `sourceDir`: Path to the Claude project directory (default: `.claude/`).
  - `vaultDir`: Path to the Obsidian vault root (default: `vault root`).
  - `recursive`: Whether to sync subdirectories (default: true).

## Steps
1. **List all Markdown files** in `sourceDir` (recursively if `recursive`).
2. **List all Markdown files** in the target `vaultDir` (recursively).

3. **For each file in `sourceDir`:**
   - Read the full file body.
   - Convert all internal Markdown links to Obsidian-style (`[[relative/path]]`).
   - Write/update the file in the vault at the matching relative path.
4. **For each file in the vault not present in `sourceDir`:**
   - Delete the file from the vault.
5. **Never delete or modify any file in the project directory, regardless of vault state.**
6. **Report** a summary: files added, updated, deleted in the vault only.

## Link Conversion
- Standard Markdown: `[text](path/to/file.md)` → Obsidian: `[[path/to/file]]`
- Remove `.md` extension in links.
- Preserve anchor fragments: `[text](path/to/file.md#section)` → `[[path/to/file#section]]`

## Example
```
/obsidian-sync sourceDir=.claude/ vaultDir=claude/ recursive=true
```


## Implementation Notes
- Uses the Obsidian MCP API for all vault operations.
- Ignores non-Markdown files.
- Ensures all files have the full body (no placeholders).
- Handles nested folders and preserves structure.
- **Sync is one-way: project directory → vault. Never deletes or modifies project files.**
- Safe to run repeatedly; idempotent.

## See Also
- [Obsidian MCP API documentation](https://github.com/obsidianmd/obsidian-mcp)
- Claude project documentation sync best practices
