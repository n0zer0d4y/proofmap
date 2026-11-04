/** Lean's own libraries, shown together as "Lean core". */
const CORE = new Set(['Init', 'Std', 'Lean', 'Lake']);

/** The library a module belongs to: its first name component, with Lean's own libraries as one. */
export function libraryOf(module: string | null): string {
  const top = (module ?? '').split('.')[0] ?? '';
  if (!top) return 'Other';
  return CORE.has(top) ? 'Lean core' : top;
}

export const isCoreLibrary = (library: string) => library === 'Lean core';

/** Inline Markdown removed, for text shown as plain words (breadcrumbs, step names, buttons). */
export function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}
