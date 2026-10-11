# Wishlist

My wishlist, live at **https://wishlist.alisyn.net**.

## Adding and editing items

1. Go to the site and click **Owner sign-in** at the bottom.
2. Paste your GitHub access token (instructions are in the sign-in box). You only do this once per device.
3. Use **+ Add item**, or **Edit** on any item. Paste a link, and the name and picture fill themselves in if you leave them blank.

Changes show up on the live site a minute or two after you save.

## How it works

- `data/wishlist.json` holds the list. You can also edit it directly on GitHub if you ever want to.
- After every change, a GitHub Action (`.github/workflows/publish.yml`) runs `scripts/fetch_previews.py`. That fills in missing names, prices and pictures for new links and saves the pictures into `images/`. Then it publishes the site.
- You can run the preview script yourself with `python3 scripts/fetch_previews.py`.

## One-time setup

1. **Publish the repo**: in GitHub Desktop, choose File → Add Local Repository, then pick this folder, commit, and click **Publish repository**. Untick "Keep this code private", because free GitHub Pages needs a public repo.
2. **Turn on Pages**: on GitHub, go to the repo's Settings → Pages, and under **Source**, choose **GitHub Actions**.
3. **Run it once**: go to the Actions tab → "Fetch previews and publish" → **Run workflow**.
4. **Custom domain**: in GoDaddy, open DNS for alisyn.net and add a record:
   - Type: `CNAME`
   - Name: `wishlist`
   - Value: `agathario.github.io`
5. **Back in Settings → Pages**, enter `wishlist.alisyn.net` as the custom domain. Once it checks out, tick **Enforce HTTPS**. DNS can take anywhere from a few minutes to a few hours.
