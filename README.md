# Old Like Button

Brings back Spotify's classic heart everywhere you see a song: track lists, search, the queue and the now-playing bar, right next to the new "+" / tick.

![Preview](preview.png)

## Features

- **Everywhere:** playlists, albums, artist pages, the search page (top result and results list), search suggestions, the queue and the now-playing bar (bottom left). Wherever Spotify shows its "+" / tick for a song, the heart sits directly to its left (in the queue, just left of the "..." button).
- **See your liked songs at a glance:** liked songs always show a filled heart, not only on hover. In track lists and the queue, empty hearts appear on hover, the same way the "+" does (this can be changed, see Settings). In search, where Spotify's "+" is always visible, so is the empty heart.
- **Other copies and versions:** a half-heart means you've liked this recording elsewhere. That can be another copy of the same album (Spotify often has an album under several IDs, and deluxe or remastered editions count as the same album), or a different release such as a single, a live version or a compilation. Hover over it to see which, or right-click the song and choose **Show liked versions of this recording** to jump to them.
- **Lost songs:** some liked songs stop playing because Spotify pulled them or they're blocked in your region. Spotify keeps them in your Liked Songs but stops treating them as liked. If an available copy of one turns up (same recording, or same title and artist), it gets an outline heart with an orange **!**. Click it to like the available copy.
- **Lost liked songs list:** open your profile menu (top right) and choose **Lost liked songs** to see every liked song that's no longer available. Each one has a **Search** button to find an available copy and an **Unlike** button to clear it out.
- **Multi-select:** select several rows (Shift-click or Ctrl-click) and click the heart on any selected row to like or unlike all of them.
- **Stays in sync:** picks up likes you make on your phone or in the web player within about 30 seconds.

![Heart states](preview-states.png)

*Liked · available copy of a lost song · liked another copy or version*

| Heart | Meaning |
| --- | --- |
| **Full** | You've liked this exact copy. Greyed-out lost copies get one too, and say "no longer available" on hover. |
| **Half** | You've liked another copy of this song from the same album, or another version of the recording. |
| **Outline with orange "!"** | You liked this song, but that copy is now lost. This one is available to like instead. |
| **Empty** | You haven't liked this song in any form. |

If a song matches both the "!" and the half-heart, the "!" wins.

## Install

**Marketplace:** search for **Old Like Button** in the Extensions tab and click Install.

**Manual:**
1. Run `spicetify config-dir` and copy `oldLikeButton.js` into the `Extensions` folder.
2. Run:
   ```
   spicetify config extensions oldLikeButton.js
   spicetify apply
   ```

If you have another "Old Like Button" extension installed, remove it first, otherwise every row gets two hearts.

## Settings

For a manual install, open `oldLikeButton.js`, change these values at the top, then run `spicetify apply`:

| Setting | Default | What it does |
| --- | --- | --- |
| `SHOW_EMPTY_HEARTS_ALWAYS` | `false` | `true` shows empty hearts on every row all the time, not just on hover. |
| `UNLIKE_OTHER_COPY_WHEN_LIKING` | `false` | `true`: when you like a copy of a song you'd already liked from another copy of the same album, the other copies are unliked, so each song is only liked once. |
| `UNLIKE_LOST_COPY_WHEN_LIKING` | `false` | `true`: when you like an available copy of a lost song (the "!" heart), the unavailable copy is unliked. |
| `SHOW_OWN_TOASTS` | `false` | `true` shows the extension's own "Added to Liked Songs" message. Spotify already shows one. |

## Compatibility

Tested on Spotify 1.3.6 with Spicetify 2.46.4. Spotify is set to English: the extension finds Spotify's "+" / tick by its label. Spotify updates often rename parts of the app; if something stops working, please open an issue.

## Known issues

- After resizing the window, track list formatting can occasionally break when another extension adds its own column (for example a star-rating column). Press Ctrl+Shift+R to fix it.

## Troubleshooting

Open DevTools (run `spicetify enable-devtools` first, then press Ctrl+Shift+I) and look in the Console for lines starting with `[Old Like Button]`. Include them in your issue.

## Credits

Inspired by and improved from [Old Like Button Revamped](https://github.com/K4HVH/spicetify-old-like-button-revamped) by K4HVH, which builds on the [original extension](https://github.com/Maskowh/spicetify-old-like-button-extension) by Maskowh and OhItsTom. MIT licensed. See [LICENSE](LICENSE).
