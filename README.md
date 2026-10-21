# LPV Blocker
LPV Blocker is a browser extension that hides posts on X (Twitter) from accounts whose name, bio or location contain things you pick, like certain emoji or words. It doesn't delete the posts. Each one is folded into a small bar, so you can still open it with one click.

Out of the box it hides posts from accounts that have a **flag emoji** in their name or bio. You can change this or add your own rules at any time.

It works in **Chrome, Edge, Brave and Firefox** on a computer. It doesn't work in phone apps.

## Install

**[⬇ Download LPV Blocker (ZIP)](https://github.com/arthurmateu/lpv-blocker/archive/refs/heads/main.zip)**

Unzip the file you downloaded. 
> On Windows, right-click it and choose **Extract All**.

> On a Mac, double-click it. You now have a folder called `lpv-blocker-main`.
Move it somewhere you'll keep it, such as your Documents folder. Your browser runs the extension from this folder, so it stops working if you delete the folder.

Then follow the steps for your browser.

### Chrome, Edge or Brave
1. Type `chrome://extensions` in the address bar and press Enter. In Edge, use `edge://extensions`. In Brave, use `brave://extensions`.
2. Turn on **Developer mode**. It's a switch in the top-right corner in Chrome and Brave, and in the left sidebar in Edge.
3. Click **Load unpacked** and select the `lpv-blocker-main` folder.
   - If you see an error, open the folder. If there's another `lpv-blocker-main` folder inside, select that one instead. The right folder has a file called `manifest.json` in it.
4. Click the puzzle-piece icon in the toolbar, then click the pin next to **LPV Blocker** so its icon stays visible.
5. Open [x.com](https://x.com), or refresh it if it's already open.

You might see an **Errors** button on the extension that says "Unrecognized manifest key". You can ignore it. That setting is only for Firefox.

### Firefox
1. Type `about:debugging#/runtime/this-firefox` in the address bar and press Enter.
2. Click **Load Temporary Add-on…**. Open the `lpv-blocker-main` folder and select the `manifest.json` file inside it.
3. Open [x.com](https://x.com), or refresh it if it's already open.
4. Click the puzzle-piece icon in the toolbar, then click **LPV Blocker**. If it says **Allow on x.com**, click that button.

> **Note:** Firefox removes add-ons installed this way when you close it. Each time you reopen Firefox, repeat steps 1 to 3. Firefox 128 or newer is required.

## Using it
When a post is hidden, you see a bar like this instead:

> Post by @someone hidden by Flags

- **Click the bar** to show the post. Click it again to hide it.
- **Hover over the bar** to see exactly what matched, e.g. "🇺🇸 in name".
- Quoted posts are checked too, so a quote can be hidden inside a post you can still see.

These posts are never hidden:
- Accounts you follow. You can turn this off.
- Accounts you add to the "Always show these accounts" list.
- Your own posts.

### Changing what gets hidden
Click the LPV Blocker icon in your toolbar. From there you can:
- Switch hiding on or off with **Hide matching posts**.
- Choose whether to **Skip accounts I follow**.
- Edit your rules, or click **+ New rule** to add one.

A rule is a list of things to look for. To make one:
1. Click **+ New rule** and give it a name, e.g. **Crypto**. The name appears on the bar of every post the rule hides.
2. Type the emoji or words to look for, separated by commas, e.g. `👽, crypto, nft`. Capital letters don't matter, and fancy lettering like 𝓬𝓻𝔂𝓹𝓽𝓸 is caught too. An emoji on its own matches only that emoji: 🏴 finds the black flag but not 🏴‍☠️ (the pirate flag). To match a combined emoji, type the whole thing, like `🏴‍☠️`.
3. To match every flag emoji at once, click **Any flag**.
4. Choose where to look: **Name**, **Bio** and/or **Location**. Name covers both the display name and the @handle.

To pause a rule without deleting it, untick the box next to it. To delete it, click **✕**.

Click **All settings** at the top of the popup for the full settings page. It also has:
- **Always show these accounts**: accounts that are never hidden, e.g. `@friend, @someone_else`.
- **Try your rules**: type a name, bio or location to check whether it would be hidden.
- **Advanced** (under each rule): a regular expression, for more precise matching.

## Updating
1. [Download the ZIP](https://github.com/arthurmateu/lpv-blocker/archive/refs/heads/main.zip) again and unzip it.
2. Replace the files in your old `lpv-blocker-main` folder with the new ones. Keep the folder in the same place.
3. **Chrome, Edge or Brave:** go to `chrome://extensions` and click the reload icon (↻) on LPV Blocker. **Firefox:** go to `about:debugging#/runtime/this-firefox` and click **Reload** under LPV Blocker.
4. Refresh any open x.com tabs.

## Something's not working?
- **Nothing is being hidden.** Refresh the x.com tab. Then click the LPV Blocker icon. If it shows a **Refresh tab** or **Allow on x.com** button, click it. Also check that **Hide matching posts** is on. Remember that accounts you follow are skipped unless you turn that off.
- **Some posts hide a moment after they appear.** This is normal. For some posts, the extension has to look up the author's bio first.
- **The extension vanished in Firefox.** Firefox removes it when you close the browser. Load it again by following the [Firefox steps](#firefox).
- **Still stuck?** On an x.com tab, click the LPV Blocker icon, then **Copy debug report**. Paste the report into a [new issue](https://github.com/arthurmateu/lpv-blocker/issues/new) along with a description of what's going wrong. The report doesn't include the text of any posts.

## Privacy
Your settings stay in your browser, and the extension doesn't send your data anywhere. The only requests it makes are to x.com itself, to load the profiles of people whose posts you see so it can read their bios.

---

## For developers

### How it works
- **`src/inject.js`** runs inside the page and passes X's API responses to the content script. X's classic web app includes each author's full profile, bio and follow status included, in every timeline response.
- **`src/content.js`** collapses matching posts and adds the reason bar. X's newer web app only sends the author's name with each post. So if an author's bio is still unknown after 1.5 seconds, the extension fetches their profile page (`x.com/<handle>`) and reads the profile data embedded there. It runs at most 2 lookups at a time and caches each profile for 3 days, so each account is fetched about once.
- **`src/shared.js`** has the rule engine, the settings, and the code that reads X's data.

Settings and the profile cache are stored in `storage.local`. Regexes are JavaScript regular expressions and are matched case-insensitively. A rule without a name is labelled by what it matches.

### Debug report
The report contains:
- how many posts were found and hidden
- every post on the page, quotes marked with `>`, and whether it's hidden or what kept it visible (you follow them, always-show list, your own post, no rule matched)
- your rules and which fields they check
- which profiles are known
- how the profile lookups went
- an outline of X's markup, with no post text included

### Keeping it installed in Firefox
To stop Firefox from removing the add-on on restart, sign it as an unlisted add-on on [addons.mozilla.org](https://addons.mozilla.org/developers/) (`npx web-ext sign`). Or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

### Limitations
- The extension depends on X's internal data formats and page markup. If X changes them, it may stop working until those parts are updated.
- An author whose bio is known only through a lookup is collapsed a moment after their post appears, not immediately.
- In X's classic web app, a quote card doesn't link to the post it shows, so a revealed quote is remembered per quoting post rather than per quoted post.
- Posts you reveal stay revealed until you reload the page.
