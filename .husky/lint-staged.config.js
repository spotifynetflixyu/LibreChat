module.exports = {
  '*.{js,jsx,ts,tsx}': ['prettier --write', 'eslint --fix', 'eslint'],
  '*.md': ['prettier --write'],
  '*.json': ['prettier --write'],
};
