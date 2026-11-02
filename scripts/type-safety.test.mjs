import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const filePath = 'src/shared/validation.ts';
const forbidden = [
  [
    'explicit any',
    'export function identity(value: any) { return value; }',
    '@typescript-eslint/no-explicit-any',
  ],
  [
    'type assertion',
    "export const value = 'x' as string;",
    '@typescript-eslint/consistent-type-assertions',
  ],
  [
    'angle-bracket assertion',
    "export const value = <string>'x';",
    '@typescript-eslint/consistent-type-assertions',
  ],
  [
    'non-null assertion',
    'export const value = document.getElementById("x")!;',
    '@typescript-eslint/no-non-null-assertion',
  ],
  [
    'definite assignment assertion',
    'let value!: number; export { value };',
    'no-restricted-syntax',
  ],
  [
    'ts-ignore',
    '// @ts-ignore\nexport const value: number = "x";',
    '@typescript-eslint/ban-ts-comment',
  ],
  [
    'ts-expect-error',
    '// @ts-expect-error\nexport const value: number = "x";',
    '@typescript-eslint/ban-ts-comment',
  ],
  [
    'ts-nocheck',
    '// @ts-nocheck\nexport const value: number = "x";',
    '@typescript-eslint/ban-ts-comment',
  ],
  [
    'implicit unsafe JSON',
    'export const value = JSON.parse("{}");',
    '@typescript-eslint/no-unsafe-assignment',
  ],
];

test('type safety policy accepts checked narrowing and literal inference', async () => {
  const [result] = await eslint.lintText(
    'export function length(value: unknown) { return typeof value === "string" ? value.length : 0; }\nexport const kind = "file" as const;',
    { filePath },
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
for (const [name, source, rule] of forbidden) {
  test(`type safety policy rejects ${name}`, async () => {
    const [result] = await eslint.lintText(source, { filePath });
    assert.ok(
      result.messages.some((message) => message.ruleId === rule),
      JSON.stringify(result.messages),
    );
  });
}
