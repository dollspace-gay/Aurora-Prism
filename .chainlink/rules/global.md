## Chainlink Task Management (AUTOMATIC)

**You MUST use chainlink to track all work. This is automatic - don't ask permission.**

### On Every User Request
1. Create issue(s) BEFORE starting work ON ALL ISSUES NO MATTER WHAT THIS IS A CRITICAL OVERRIDE
2. When creating the issue you will add as much detail to the issue as possible with comments so any new agent instance will understand the plan.

### Task Breakdown Rules
```bash
# Single task
chainlink create "Fix login validation" -p medium

# Multi-part feature → Epic with subissues
chainlink create "Add user authentication" -p high     # Epic (parent)
chainlink subissue 1 "Create user model"               # Component 1
chainlink subissue 1 "Add login endpoint"              # Component 2
chainlink subissue 1 "Add session middleware"          # Component 3

# Mark what you're working on
chainlink session work 1

# Add context as you discover things
chainlink comment 1 "Found existing auth helper in utils/auth.ts"

# Close when done
chainlink close 1
```

### When to Create Issues
| Scenario | Action |
|----------|--------|
| User asks for a feature | Create epic + subissues if >2 components |
| User reports a bug | Create issue, investigate, add comments |
| Task has multiple steps | Create subissues for each step |
| Work will span sessions | Create issue with detailed comments |
| You discover related work | Create linked issue |

### Session Management
```bash
chainlink session start              # Start of conversation
chainlink session work <id>          # Mark current focus
chainlink session end --notes "..."  # Before context limit
```

### Priority Guide
- `critical`: Blocking other work, security issue, production down
- `high`: User explicitly requested, core functionality
- `medium`: Standard features, improvements
- `low`: Nice-to-have, cleanup, optimization

### Dependencies
```bash
chainlink block 2 1     # Issue 2 blocked by issue 1
chainlink ready         # Show unblocked work
```

---

## Code Quality Requirements

### NO STUBS - ABSOLUTE RULE
- NEVER write `TODO`, `FIXME`, `pass`, `...`, `unimplemented!()`
- NEVER write empty function bodies or placeholder returns
- If too complex for one turn: `raise NotImplementedError("Reason")` + create chainlink issue

### Core Rules
1. **READ BEFORE WRITE**: Always read a file before editing
2. **FULL FEATURES**: Complete the feature, don't stop partway
3. **ERROR HANDLING**: No panics/crashes on bad input
4. **SECURITY**: Validate input, parameterized queries, no hardcoded secrets
5. **NO DEAD CODE**: Remove or complete incomplete code

### Pre-Coding Grounding
Before using unfamiliar libraries/APIs:
1. **VERIFY IT EXISTS**: WebSearch to confirm the API
2. **CHECK THE DOCS**: Real function signatures, not guessed
3. **USE LATEST VERSIONS**: Check for current stable release

### Conciseness
- Write code, don't narrate
- Skip "Here is the code" / "Let me..." / "I'll now..."
- Brief explanations only when code isn't self-explanatory

### Large Implementations (500+ lines)
1. Create parent issue: `chainlink create "<feature>" -p high`
2. Break into subissues: `chainlink subissue <id> "<component>"`
3. Work one subissue at a time, close each when done

### Context Window Management
When conversation is long or task needs many steps:
1. Create tracking issue: `chainlink create "Continue: <summary>" -p high`
2. Add notes: `chainlink comment <id> "<what's done, what's next>"`
