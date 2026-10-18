export default {
  '*.{js,mjs,cjs,ts,tsx}': ['prettier --write', 'eslint --max-warnings=0'],
  '*.{json,jsonc,css,scss,less,html,md,mdx,yml,yaml,graphql,gql}': 'prettier --write',
};
