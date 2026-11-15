# EON site

The public page about EON, and its privacy policy, as plain HTML and CSS. The design follows the
app's own tokens (`src/theme.ts` in the EON repo): dark by default, daylight from the system setting.

- `index.html`: the product page
- `privacy.html`: the privacy policy (keep it in step with the app's Privacy screen)
- `img/`: app screenshots, made-up demo data only

## Screenshots

With the app's dev server running (EON repo, port 5281):

    node tools/shoot.mjs http://localhost:5281

Every `/api` call is answered with "no source connected", so the app shows demo data and nothing
real reaches a picture. The same pictures go into the Play listing.

`node tools/page.mjs http://localhost:5297` takes full-length pictures of the site itself, phone and
desktop, dark and light, into `preview/`.
