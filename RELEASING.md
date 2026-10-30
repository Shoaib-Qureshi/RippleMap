# Releasing

Publishing is automated: pushing a version tag runs the tests on Ubuntu and Windows, then publishes to the
VS Code Marketplace and Open VSX and creates a GitHub release with the `.vsix`
(`.github/workflows/release.yml`). The steps below are the one-time setup that only the owner can do.

## Before the first release

1. **Name: RippleMap.** Checked free on the VS Code Marketplace and Open VSX on 2026-10-30 (the earlier
   working name, FlowLens, was taken on Open VSX). Still to do yourself: a quick web/trademark search and the
   domain you want. `name` in `package.json` (`ripplemap`) becomes the permanent extension id
   `<publisher>.ripplemap` once published.

2. **GitHub repo: done.** <https://github.com/Shoaib-Qureshi/RippleMap> (public), set as `repository`,
   `homepage` and `bugs` in `package.json`. README screenshots are served from `raw.githubusercontent.com` at
   the release tag, so they only show on the Marketplace while the repo stays public.

3. **Windows check.** The first push runs CI on `windows-latest`. Make sure it is green, and try the
   extension once in a real Claude Code session (and Cursor) before tagging.

4. **VS Code Marketplace publisher.** At <https://marketplace.visualstudio.com/manage>, sign in with your
   Microsoft account and create a publisher. Done: ID `ShoaibQureshi` (name "Shoaib Qureshi"), set as
   `publisher` in `package.json`, so the extension id is `ShoaibQureshi.ripplemap`. Then set up **Trusted Publishing** for this GitHub repo and the
   `Release` workflow in the publisher's settings, following
   <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>. No token is stored:
   the workflow runs `vsce publish --oidc` (needs `@vscode/vsce` 4.1.0+, already in `devDependencies`).
   Personal Access Tokens stop working on 1 December 2026, so don't set one up.

5. **Open VSX** (Cursor, Windsurf, VSCodium). Log in at <https://open-vsx.org> with GitHub, sign the
   Eclipse publisher agreement (Profile), and create the namespace `ShoaibQureshi` (exactly the `publisher`
   in `package.json`). Then under **Trusted Publishers** register repository `Shoaib-Qureshi/RippleMap`,
   workflow `release.yml`, no environment. The workflow runs `ovsx publish --trusted-publishing` (ovsx 1.3.0+):
   no token is stored. The very first version can be published by hand with a short-lived access token:
   `npx ovsx publish ripplemap-0.1.0.vsix -p <token>`.

6. **License.** `LICENSE.md` is a plain-language template (free to use, proprietary). Have it reviewed
   before charging for anything.

## Each release

1. Update `CHANGELOG.md` and bump `version` in `package.json` (for example `0.1.1`).
2. Commit, then tag and push: `git tag v0.1.1 && git push origin main v0.1.1`.
3. Watch the `Release` workflow. The tag must match `package.json`, or it stops before publishing.

`"preview": true` in `package.json` shows a Preview badge on the Marketplace. Remove it for 1.0.
