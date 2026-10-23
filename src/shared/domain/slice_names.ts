import { Result, ok, fail } from './result.js';

/** Every spelling a slice name needs across 11 languages, derived once from the raw input. */
export interface SliceNames {
  raw: string;
  /** user_profile — files, directories, Python/Rust/Elixir/Ruby identifiers. */
  snake: string;
  /** UserProfile — types, classes, modules. */
  pascal: string;
  /** userProfile */
  camel: string;
  /** user-profile — URL segments. */
  kebab: string;
  /** userprofile — Go package names. */
  flat: string;
}

const VALID_SLICE_NAME = /^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$/;

/** Reserved words that would produce uncompilable identifiers in at least one target language. */
const RESERVED = new Set(['type', 'class', 'struct', 'enum', 'module', 'package', 'import', 'mod', 'fn', 'def', 'end', 'do', 'new', 'test', 'default']);

export function deriveSliceNames(raw: string): Result<SliceNames, Error> {
  if (!VALID_SLICE_NAME.test(raw)) {
    return fail(
      new Error(`Invalid sliceName '${raw}': use letters/digits separated by '_' or '-', starting with a letter (e.g. 'orders', 'user-profile').`)
    );
  }
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
  const snake = words.join('_');
  if (RESERVED.has(snake)) return fail(new Error(`sliceName '${raw}' is a reserved word in a target language; choose a more specific name.`));

  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return ok({
    raw,
    snake,
    pascal,
    camel: pascal.charAt(0).toLowerCase() + pascal.slice(1),
    kebab: words.join('-'),
    flat: words.join(''),
  });
}
