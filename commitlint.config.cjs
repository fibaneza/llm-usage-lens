'use strict';

// Minimal Conventional Commits config.
// Dev dependencies (@commitlint/cli, @commitlint/config-conventional) are
// added to package.json in Phase 1. The pr-title-lint.yml workflow uses
// amannn/action-semantic-pull-request (self-contained, no local deps needed).
// This file is consumed by the local Husky commit-msg hook once Phase 1 lands.
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
