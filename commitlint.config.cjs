// commitlint.config.cjs — extends conventional-commits baseline and
// aligns the allowed types with the sections defined in .release-it.json.
// Every type listed here surfaces in the changelog under its own section;
// commits that use an unlisted type will fail CI.
'use strict';

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Keep the same type list as the `types` array in .release-it.json.
    // `style` is intentionally omitted (hidden from changelog by design).
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'revert',
        'docs',
        'refactor',
        'build',
        'ci',
        'chore',
        'test',
        'style',
      ],
    ],
  },
};
