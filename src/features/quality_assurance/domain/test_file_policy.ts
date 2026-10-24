/**
 * Test files are the specification. An automated fixer that may edit them can "fix" a
 * failure by weakening the assertion, so every automatic patch path refuses them.
 */
const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|[\\/])(tests?|spec|specs|__tests__|test_helpers?)[\\/]/i,
  /[._-](test|spec)\.[a-z]+$/i,
  /_test\.(go|exs?|dart)$/i,
  /(^|[\\/])test_[^\\/]+\.py$/i,
  /Tests?\.cs$/,
  /Test\.php$/,
  /_spec\.rb$/,
];

export function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((p) => p.test(filePath));
}
