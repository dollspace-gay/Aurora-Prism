### TypeScript Best Practices

#### Code Style
- Use strict mode (`"strict": true` in tsconfig.json)
- Prefer `interface` over `type` for object shapes
- Use `const` by default, `let` when needed, never `var`
- Enable `noImplicitAny` and `strictNullChecks`

#### Type Safety
```typescript
// GOOD: Explicit types and null handling
function getUser(id: string): User | undefined {
    return users.get(id);
}

const user = getUser(id);
if (user) {
    console.log(user.name);  // TypeScript knows user is defined
}

// BAD: Type assertions to bypass safety
const user = getUser(id) as User;  // Dangerous if undefined
console.log(user.name);  // Might crash
```

#### Error Handling
- Use try/catch for async operations
- Define custom error types for domain errors
- Never swallow errors silently

#### Security
- Validate all user input at API boundaries
- Use parameterized queries for database operations
- Sanitize data before rendering in DOM (prevent XSS)
- Never use `eval()` or `Function()` with user input
