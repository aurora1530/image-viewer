export default {
  '*': [
    // Deleted paths are included so deletion-only commits also run the full check.
    'prettier --write --ignore-unknown --no-error-on-unmatched-pattern',
    // A function keeps lint-staged from appending filenames to this project-wide command.
    () => 'npm run check',
  ],
};
