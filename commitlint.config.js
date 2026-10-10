export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'sim',
        'content',
        'balance',
        'render',
        'audio',
        'ui',
        'app',
        'web',
        'mobile',
        'desktop',
        'backend',
        'tools',
        'ci',
        'docs',
        'deps',
        'repo',
      ],
    ],
  },
};
