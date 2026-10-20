# LPV Blocker
A Chrome and Firefox extension that collapses X/Twitter posts from accounts whose **name**, **bio** or **location** match your rules. Each collapsed post is replaced by a bar saying which rule hid it: **Post by @someone hidden by Annoying emojis**. Hover over the bar to see exactly what matched ("🇺🇸 in name, 'crypto' in bio"). Click the bar to reveal the post below it, and click again to hide it. Quoted posts are checked too, and collapse on their own inside the post that quotes them.

## Rules
A rule is a named set of things to look for, e.g. **Annoying emojis** or **Probable ad**. Each rule can contain any mix of:

| Part | Matches |
| --- | --- |
| Emoji or words | Comma-separated, e.g. `👽, crypto, 🇺🇸`. Ignores case and catches stylised letters like 𝓬𝓻𝔂𝓹𝓽𝓸. |
| Regex | A JavaScript regular expression (case-insensitive). You can set it on the full settings page. |

Each rule can check any combination of name (display name and @handle), bio and location. A rule without a name is labelled by what it matches. The default setup is one rule, **Flags**, which looks for any flag emoji in the name and bio.

These posts are never hidden:
- Accounts you follow. You can turn this off in the settings.
- Accounts on your "always show" list.
- Your own posts.

## Install

### Chrome / Edge / Brave
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.

Chrome shows an "Unrecognized manifest key `browser_specific_settings`" warning. That key is for Firefox and the warning is harmless.

### Firefox (128+)
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json`.
3. Refresh any open x.com tabs. Do this again every time you click **Reload** on the add-on.
4. If the popup says it can't run on x.com, click **Allow on x.com**.

A temporary add-on is removed when Firefox restarts. To keep it installed, sign it as an unlisted add-on on [addons.mozilla.org](https://addons.mozilla.org/developers/) (`npx web-ext sign`), or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

## Settings
Click the toolbar icon to open the popup. In the popup you can:
- switch hiding on or off
- add, rename, edit, switch off or delete rules, and choose whether each one checks the name, bio or location
- see how many posts are hidden on the current page

If the extension isn't running in the current x.com tab, the popup says so and offers a button to fix it: either refresh the tab or allow the extension on x.com.

**All settings** opens the full settings page. It adds the "always show" account list and a box where you can type a name or bio and see whether it would be hidden.

## How it works
- **`src/inject.js`** runs inside the page and passes X's API responses to the content script. X's classic web app includes each author's full profile, bio and follow status included, in every timeline response.
- **`src/content.js`** collapses matching posts and adds the reason bar. X's newer web app only sends the author's name with each post. So if an author's bio is still unknown after 1.5 seconds, the extension fetches their profile page (`x.com/<handle>`) and reads the profile data embedded there. It runs at most 2 lookups at a time and caches each profile for 3 days, so each account is fetched about once.
- **`src/shared.js`** has the rule engine, the settings, and the code that reads X's data.

Settings and the profile cache are stored locally in the browser (`storage.local`). The only requests the extension makes are those profile-page fetches to x.com.

## Debugging
If posts aren't being hidden, open the toolbar popup on an x.com tab and click **Copy debug report**. The report contains:
- how many posts were found and hidden
- every post on the page, quotes marked with `>`, and whether it's hidden or what kept it visible (you follow them, always-show list, your own post, no rule matched)
- your rules and which fields they check
- which profiles are known
- how the profile lookups went
- an outline of X's markup, with no post text included

## Limitations
- The extension depends on X's internal data formats and page markup. If X changes them, it may stop working until those parts are updated.
- An author whose bio is known only through a lookup is collapsed a moment after their post appears, not immediately.
- In X's classic web app, a quote card doesn't link to the post it shows, so a revealed quote is remembered per quoting post rather than per quoted post.
- Posts you reveal stay revealed until you reload the page.
