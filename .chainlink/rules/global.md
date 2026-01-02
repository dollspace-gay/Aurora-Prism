### Pre-Coding Grounding (PREVENT HALLUCINATIONS)
Before writing code that uses external libraries, APIs, or unfamiliar patterns:
1. **VERIFY IT EXISTS**: Use WebSearch to confirm the crate/package/module exists and check its actual API
2. **CHECK THE DOCS**: Fetch documentation to see real function signatures, not imagined ones
3. **CONFIRM SYNTAX**: If unsure about language features or library usage, search first
4. **USE LATEST VERSIONS**: Always check for and use the latest stable version of dependencies (security + features)
5. **NO GUESSING**: If you can't verify it, tell the user you need to research it

Examples of when to search:
- Using a crate/package you haven't used recently → search "[package] [language] docs"
- Uncertain about function parameters → search for actual API reference
- New language feature or syntax → verify it exists in the version being used
- System calls or platform-specific code → confirm the correct API
- Adding a dependency → search "[package] latest version" to get current release

### General Requirements
1. **NO STUBS - ABSOLUTE RULE**:
   - NEVER write `TODO`, `FIXME`, `pass`, `...`, `unimplemented!()` as implementation
   - NEVER write empty function bodies or placeholder returns
   - NEVER say "implement later" or "add logic here"
   - If logic is genuinely too complex for one turn, use `raise NotImplementedError("Descriptive reason: what needs to be done")` and create a chainlink issue
   - The PostToolUse hook WILL detect and flag stub patterns - write real code the first time
2. **NO DEAD CODE**: Discover if dead code is truly dead or if it's an incomplete feature. If incomplete, complete it. If truly dead, remove it.
3. **FULL FEATURES**: Implement the complete feature as requested. Don't stop partway or suggest "you could add X later."
4. **ERROR HANDLING**: Proper error handling everywhere. No panics/crashes on bad input.
5. **SECURITY**: Validate input, use parameterized queries, no command injection, no hardcoded secrets.
6. **READ BEFORE WRITE**: Always read a file before editing it. Never guess at contents.

### Conciseness Protocol
Minimize chattiness. Your output should be:
- **Code blocks** with implementation
- **Tool calls** to accomplish tasks
- **Brief explanations** only when the code isn't self-explanatory

NEVER output:
- "Here is the code" / "Here's how to do it" (just show the code)
- "Let me know if you need anything else" / "Feel free to ask"
- "I'll now..." / "Let me..." (just do it)
- Restating what the user asked
- Explaining obvious code
- Multiple paragraphs when one sentence suffices

When writing code: write it. When making changes: make them. Skip the narration.

### Large File Management (500+ lines)
If you need to write or modify code that will exceed 500 lines:
1. Create a parent issue for the overall feature: `chainlink create "<feature name>" -p high`
2. Break down into subissues: `chainlink subissue <parent_id> "<component 1>"`, etc.
3. Inform the user: "This implementation will require multiple files/components. I've created issue #X with Y subissues to track progress."
4. Work on one subissue at a time, marking each complete before moving on.

### Context Window Management
If the conversation is getting long OR the task requires many more steps:
1. Create a chainlink issue to track remaining work: `chainlink create "Continue: <task summary>" -p high`
2. Add detailed notes as a comment: `chainlink comment <id> "<what's done, what's next>"`
3. Inform the user: "This task will require additional turns. I've created issue #X to track progress."

Use `chainlink session work <id>` to mark what you're working on.
