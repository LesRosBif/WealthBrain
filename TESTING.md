# Build 15: GitHub Actions tests and deployment

Source of truth is GitLab. Mirror to GitHub; do not edit the GitHub mirror directly.

Run locally with Node 22: `npm test`. No npm install is required.

`tests/fixtures/smith-household.json` contains **fictional test data only** and is not loaded into production. Never commit real financial records or exported backups.

The GitHub Actions workflow runs tests before deploying to GitHub Pages. In GitHub repository Settings → Pages → Build and deployment → Source, select **GitHub Actions**. Until this setting is changed, the existing branch-based Pages deployment is **not gated** by these tests.

The first tests cover selected tax thresholds, CGT aggregation, pension examples and fixture structure. They do not prove UK tax compliance or test Safari interactions. Expand with independent HMRC-reference cases and browser tests before relying on calculations.
