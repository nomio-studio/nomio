/**
 * Minimal ESM resolve hook for running the TypeScript test scripts with Node.
 *
 * The game source uses bundler-style extensionless imports (`./blocks`). Node's
 * native TypeScript support loads the files but its resolver still demands an
 * extension, so this hook retries relative specifiers with `.ts` appended.
 *
 * Used by `npm run test:saves`.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to the default resolution below.
    }
  }
  return nextResolve(specifier, context);
}
