// renderer の import 境界（docs/decisions.md 013）だけを強制する。品質系ルールの一般適用はスコープ外なので掛けない。
// group の負値指定は「除外済みの親配下は再許可できない」gitignore 制約で許可リストを表現できないため採らない。
import tseslint from 'typescript-eslint'

export default [
  {
    files: ['apps/renderer/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?!react($|/)|react-dom($|/)|zustand$|@white-box/core($|/)|@white-box/contracts$|@/|\\.{1,2}/)',
              message:
                'renderer が import できるのは react / react-dom / zustand / @white-box/core / @white-box/contracts / @/（自 src）/ 相対 だけ（docs/decisions.md 013）。',
            },
            {
              regex: '(^|/)desktop(/|$)|^(\\.\\./){3}',
              message:
                'renderer から src の外（apps/desktop 等）へ届く import は禁止。バックエンドとは @white-box/contracts 経由で話す（docs/decisions.md 013）。',
            },
          ],
        },
      ],
    },
  },
]
