# Releasing image-scout

Two artifacts ship for every version, and they must be the **same bytes**:

1. the npm tarball (`dsh-image-scout-<version>.tgz` on the registry), and
2. the GitHub Release asset with the same filename.

That byte-for-byte guarantee is what makes `dsh plugin add dsh-image-scout@<version>`
reproducible; version 2.0.0 broke it by re-uploading a new asset under the same
version, and the fix was a new version rather than a new upload. **Never replace an
asset for an already published version — cut a patch release instead.**

## One-time setup

Publishing needs a credential that satisfies npm's mandatory 2FA for maintainers.
There are two supported ways; pick one.

### A. Trusted publishing (OIDC) — recommended, no secret to rotate

1. Open <https://www.npmjs.com/package/dsh-image-scout/access>.
2. Under **Trusted Publisher**, choose **GitHub Actions** and fill in:
   - Organization or user: `2039108952x-lab`
   - Repository: `image-scout`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
3. Publish by running the `publish` workflow (`.github/workflows/publish.yml`), either
   from the Actions tab or automatically when a GitHub Release is published.

npm exchanges the workflow's OIDC token for a short-lived publish credential; there is
no `NODE_AUTH_TOKEN` and nothing in the repository to leak. This is also the only path
that keeps working after January 2027, when bypass-2FA tokens lose direct publish.

### B. Granular access token with "Bypass 2FA" — until January 2027

Create one at <https://www.npmjs.com/settings/xyz2039/tokens> (Granular Access Token,
*All packages: read and write*, **Bypass two-factor authentication** checked). Then:

```powershell
cd 'E:\ai\comfy UI\image-scout'
npm publish --access public --//registry.npmjs.org/:_authToken=npm_<token>
```

Tokens default to a 7-day lifetime, so this is a stop-gap; do not commit one, and do not
put it in the repository `.npmrc`.

## Cutting a release

```powershell
# 1. Bump the version in all three places; they are cross-checked by test/skill.test.mjs.
#    package.json -> version
#    skills/image-scout/SKILL.md -> version (frontmatter)
#    release.json -> skillVersion
# 2. Add a CHANGELOG.md section.
# 3. Verify and package.
npm test
npm pack --dry-run

# 4. Commit, tag, push (proxy: github.com is not reachable directly on this machine).
git add -A
git commit -m "chore(release): <version>"
git tag -a v<version> -m "v<version>"
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main --tags

# 5. Build the exact artifact and attach it to a GitHub Release.
npm pack
gh release create v<version> ./dsh-image-scout-<version>.tgz --title "v<version>" --notes "..." --latest
```

Then publish to npm with path A or B above.

## Verifying a release

All three checks must agree:

```powershell
# Registry metadata: latest tag and the integrity pnpm will verify against.
npm view dsh-image-scout dist-tags
npm view dsh-image-scout@<version> dist.integrity dist.tarball

# Byte equality: registry tarball vs the GitHub Release asset.
$tmp = "$env:TEMP\scout-verify"; New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest "https://registry.npmjs.org/dsh-image-scout/-/dsh-image-scout-<version>.tgz" -OutFile "$tmp\registry.tgz"
Get-FileHash "$tmp\registry.tgz", ".\dsh-image-scout-<version>.tgz" -Algorithm SHA256

# Install path under the same nodeLinker: hoisted that DSH profiles use.
$env:DSH_HOME = 'E:\deepseek\dsh-plugin-test\dsh-home'
dsh --profile verify --from-default-profile web --dump-config
dsh plugin --profile verify add dsh-image-scout@<version>
dsh --profile verify --dump-config | Select-String image-scout
```

The install must finish without `ERR_PNPM_MISSING_TARBALL_INTEGRITY`, and the lockfile
entry must carry `resolution: {integrity: sha512-…}` with **no** `tarball` field — that
is the registry-metadata path, which is why `hoisted` cannot reproduce the bare-URL bug.

## After publishing

- The marketplace catalog picks the npm package up automatically (no entry change).
- `release.json.sourceCommit` should point at the commit that produced the tarball.
- The live DSH profile only serves the new skill version after dsh restarts.
