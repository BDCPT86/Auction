# Draft Day tests

The app needs none of this. These are automated checks for anyone changing the code.

```
cd tests
npm install
npx playwright install chromium   # first time only
npm test            # browser tests (node --test + Playwright)
npm run lint        # ESLint over the app's scripts
npm run format      # Prettier
```

Each test starts a small local web server for the app folder and opens it in a fresh headless
Chromium, with the in-app dialogs set to accept automatically (`window.DLG_AUTO`). Queue typed
answers for prompts in `window.DLG_ANSWERS`.
