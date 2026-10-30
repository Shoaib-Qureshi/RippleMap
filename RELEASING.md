# Releasing

Publishing is automated: pushing a version tag runs the tests on Ubuntu and Windows, then publishes to the
VS Code Marketplace and Open VSX and creates a GitHub release with the `.vsix`
(`.github/workflows/release.yml`). The steps below are the one-time setup that only the owner can do.

## Before the first release

1. **Name: RippleMap.** Checked free on the VS Code Marketplace and Open VSX on 2026-10-30 (the earlier
   working name, FlowLens, was taken on Open VSX). Still to do yourself: a quick web/trademark search and the
   domain you want. `name` in `package.json` (`ripplemap`) becomes the permanent extension id
   `<publisher>.ripplemap` once published.

2. **GitHub repo.** Create it and push this folder. Set `repository`, `homepage` and `bugs` in
   `package.json` and remove `--allow-missing-repository` from the `package` script and the workflow.
   The repo must be **public** for the README screenshots to show on the Marketplace (they are served from
   `raw.githubusercontent.com` at the release tag); with a private repo, host the images elsewhere.

3. **Windows check.** The first push runs CI on `windows-latest`. Make sure it is green, and try the
   extension once in a real Claude Code session (and Cursor) before tagging.

4. **VS Code Marketplace publisher.** At <https://marketplace.visualstudio.com/manage>, sign in with your
   Microsoft account and create a publisher. Its ID is permanent and must equal `publisher` in
   `package.json` (currently `tier2`). Then set up **Trusted Publishing** for this GitHub repo and the
   `Release` workflow in the publisher's settings, following
   <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>. No token is stored:
   the workflow runs `vsce publish --oidc` (needs `@vscode/vsce` 4.1.0+, already in `devDependencies`).
   Personal Access Tokens stop working on 1 December 2026, so don't set one up.

5. **Open VSX** (Cursor, Windsurf, VSCodium). Create an account at <https://open-vsx.org>, sign the
   publisher agreement, create an access token, and create the namespace once:
   `npx ovsx create-namespace <publisher> -p <token>`. Add the token to the GitHub repo as the secret
   `OVSX_PAT`. Without it, the workflow skips Open VSX.

6. **License.** `LICENSE.md` is a plain-language template (free to use, proprietary). Have it reviewed
   before charging for anything.

## Each release

1. Update `CHANGELOG.md` and bump `version` in `package.json` (for example `0.1.1`).
2. Commit, then tag and push: `git tag v0.1.1 && git push origin main v0.1.1`.
3. Watch the `Release` workflow. The tag must match `package.json`, or it stops before publishing.

`"preview": true` in `package.json` shows a Preview badge on the Marketplace. Remove it for 1.0.
