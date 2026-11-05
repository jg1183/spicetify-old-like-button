// NAME: Old Like Button
// DESCRIPTION: Adds the classic heart to the left of the "+"/tick on every track row (playlists, albums,
// artist pages, search results and suggestions, queue) and in the now-playing bar. Liked hearts are always visible.
// Inspired by and improved from: Old Like Button Revamped by K4HVH (https://github.com/K4HVH/spicetify-old-like-button-revamped),
// itself based on work by Maskowh and OhItsTom. Original code MIT licensed: Copyright (c) 2026 K4HVH,
// portions copyright (c) Maskowh, OhItsTom.

// true = show empty hearts on every row all the time; false = empty hearts only on hover (like Spotify's "+").
const SHOW_EMPTY_HEARTS_ALWAYS = false;
// Other copies: Spotify often has the same album under several IDs (re-releases, regional copies).
// If you liked the song from a different copy than the one you're looking at, Spotify shows it as not
// liked; the heart shows an outline with an orange "!" instead (always visible).
// true = when you like this copy, unlike the other copy, so each song is only liked once.
const UNLIKE_OTHER_COPY_WHEN_LIKING = false;
// Spotify already shows its own toast when you like/unlike; set true only if yours doesn't.
const SHOW_OWN_TOASTS = false;

let likedTrackUris = new Set();
let likedIsrcByUri = new Map();
let likedIsrcs = new Set();
// Name/artist/album of each liked track, to show which versions you already like.
let likedInfoByUri = new Map();

function trackInfoFromItem(item) {
    return {
        name: item?.name || "",
        artists: (item?.artists || []).map(a => a?.name).filter(Boolean).join(", "),
        album: item?.album?.name || "",
        albumUri: item?.album?.uri || ""
    };
}

// Liked tracks sharing this ISRC, split into other copies of this same release (same album under
// another ID: "!" heart) and genuinely different versions (half-heart).
function likedMatches(uri, isrc) {
    const dups = [], others = [];
    if (!isrc) return { dups, others };
    const meta = readMetaCache(uri);
    for (const [likedUri, likedIsrc] of likedIsrcByUri) {
        if (likedIsrc !== isrc || likedUri === uri) continue;
        const info = { uri: likedUri, ...(likedInfoByUri.get(likedUri) || trackInfoFromItem(null)) };
        (isSameRelease(meta, info) ? dups : others).push(info);
    }
    return { dups, others };
}

function otherLikedVersions(uri, isrc) {
    return likedMatches(uri, isrc).others;
}

function describeVersion(v) {
    const main = [v.name || v.uri, v.artists].filter(Boolean).join(" \u00b7 ");
    return v.album ? `${main} (${v.album})` : main;
}
const likedTracksChangeEvent = new CustomEvent('likedTracksChange');

// Outline heart with an orange "!" badge: liked from another copy of the same album (24x24 viewBox).
const LEFTOVER_ICON =
    `<path d="M12 20.3C5.6 14.8 3 11.9 3 8.6 3 6 5 4 7.5 4c1.8 0 3.4 1 4.5 2.6C13.1 5 14.7 4 16.5 4 19 4 21 6 21 8.6c0 1.2-.3 2.3-1 3.5" style="fill:none;stroke:var(--text-subdued, #b3b3b3);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"></path>`
    + `<circle cx="18" cy="17.5" r="5.5" style="fill:var(--text-warning, #ffa42b)"></circle>`
    + `<rect x="17.1" y="14" width="1.8" height="4.4" rx=".9" style="fill:#121212"></rect>`
    + `<circle cx="18" cy="20.2" r="1" style="fill:#121212"></circle>`;

// Overlays a click's own result on the next periodic refresh so a stale
// snapshot can't revert it; entries drop once the snapshot itself confirms them.
let pendingLikeAdds = new Map();
let pendingLikeRemoves = new Set();

// v2: the v1 decoder had an offset-tracking bug that could cache wrong ISRCs.
const ISRC_STORAGE_PREFIX = "oldlike-isrc-v2-";

function readIsrcCache(uri) {
    try {
        return localStorage.getItem(ISRC_STORAGE_PREFIX + uri.replace("spotify:track:", ""));
    } catch (error) {
        console.error("[Old Like Button Revamped] localStorage read failed", error);
        return null;
    }
}

function writeIsrcCache(uri, isrc) {
    try {
        localStorage.setItem(ISRC_STORAGE_PREFIX + uri.replace("spotify:track:", ""), isrc);
    } catch (error) {
        console.error("[Old Like Button Revamped] localStorage write failed", error);
    }
}

// api.spotify.com is dead in CosmosAsync and rate-limited even via direct fetch;
// this instead calls the same internal metadata service the client itself uses.
let cachedWebpackRequire;
function getWebpackRequire() {
    // Memoized so a metadata-service lookup that fails and retries later doesn't
    // push a fresh chunk entry into webpack's own registry every single time.
    if (cachedWebpackRequire) return cachedWebpackRequire;
    const webpack = window.rspackChunkclient_web ?? window.webpackChunkclient_web ?? window.webpackChunkopen ?? window.rspackChunk;
    if (!webpack) return null;
    cachedWebpackRequire = webpack.push([[Symbol()], {}, re => re]);
    return cachedWebpackRequire;
}

function findWebpackModules() {
    const req = getWebpackRequire();
    if (!req) return [];
    return Object.keys(req.m)
        .map(id => { try { return req(id); } catch { return undefined; } })
        // A module exporting `window` itself would otherwise flatten every
        // page global in here, including this script's own top-level functions.
        .filter(m => m && typeof m === "object" && m !== window)
        .flatMap(m => { try { return Object.values(m); } catch { return []; } });
}

function functionSource(fn) {
    // Some webpack modules override toString with a non-function; go through
    // Function.prototype directly instead of fn.toString().
    try {
        return Function.prototype.toString.call(fn);
    } catch {
        return "";
    }
}

let cachedMetadataService;
function getMetadataService() {
    // Only a success is cached: on init not every lazy chunk is loaded yet, so a
    // failed lookup here should retry later rather than being stuck forever.
    if (cachedMetadataService) return cachedMetadataService;
    const modules = findWebpackModules();
    const unique = predicate => {
        const matches = [...new Set(modules.filter(predicate))];
        return matches.length === 1 ? matches[0] : null;
    };
    const descriptor = unique(m => typeof m === "function" && m.SERVICE_ID === "spotify.mdata_esperanto.proto.MetadataService");
    const createTransport = unique(m => typeof m === "function" && /executeEsperantoCall/.test(functionSource(m)) && /cancelEsperantoCall/.test(functionSource(m)));
    if (descriptor && createTransport) cachedMetadataService = { descriptor, instance: new descriptor(createTransport()) };
    return cachedMetadataService ?? null;
}

function fetchTrackMetadataBytes(uris) {
    return new Promise((resolve, reject) => {
        const service = getMetadataService();
        if (!service) {
            reject(new Error("metadata service unavailable"));
            return;
        }
        let settled = false;
        // A track the service never fully resolves (removed, local file, ...)
        // can leave this observation "pending" forever; don't block on that.
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("metadata service request timed out"));
            try { cancel.cancel(); } catch (e) { console.error("[Old Like Button Revamped] cancel() after timeout failed", e); }
        }, 8000);
        const cancel = service.instance.observe(
            service.descriptor.METHODS.observe.requestType.fromPartial({
                extensionQuery: uris.map(uri => ({ entityUri: uri, extensionKind: 10 }))
            }),
            response => {
                if (response.pendingResponse || settled) return;
                settled = true;
                clearTimeout(timer);
                try { cancel.cancel(); } catch (e) { console.error("[Old Like Button Revamped] cancel() after response failed", e); }
                // An uncaught throw here would leave this promise settled=true
                // but never resolved/rejected, hanging every batch behind it.
                try {
                    resolve(response.extensionResult.map(r => ({
                        uri: r.entityUri,
                        ok: r.status === 1,
                        bytes: r.status === 1 ? r.extensionData.value : null
                    })));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

// Track protobuf: repeated ExternalId{type: string, id: string} at field 10.
function decodeTrackIsrc(bytes) {
    let offset = 0;
    function readVarInt() {
        let value = 0n, shift = 0n, b;
        do { b = BigInt(bytes[offset++]); value |= (b & 0x7fn) << shift; shift += 7n; } while (b & 0x80n);
        return value;
    }
    // subarray() silently clamps an out-of-range end instead of throwing, so a
    // truncated buffer would otherwise decode a wrong-but-plausible string.
    function takeBytes(len) {
        if (offset + len > bytes.length) {
            throw new Error("Truncated protobuf buffer");
        }
        const slice = bytes.subarray(offset, offset + len);
        offset += len;
        return slice;
    }
    function skip(wireType) {
        // `offset += Number(readVarInt())` reads the pre-call offset before
        // readVarInt's own side effect runs, undercounting by its byte length.
        if (wireType === 0) {
            readVarInt();
        } else if (wireType === 1) {
            offset += 8;
        } else if (wireType === 2) {
            takeBytes(Number(readVarInt()));
        } else if (wireType === 5) {
            offset += 4;
        } else {
            // Deprecated group encoding (3/4) or reserved (6/7); throw instead of
            // leaving offset stuck, which would spin the loop below forever.
            throw new Error("Unsupported protobuf wire type: " + wireType);
        }
    }
    while (offset < bytes.length) {
        const tag = Number(readVarInt());
        const fieldNum = tag >> 3, wireType = tag & 7;
        if (fieldNum === 10 && wireType === 2) {
            const fieldLen = Number(readVarInt());
            if (offset + fieldLen > bytes.length) {
                throw new Error("Truncated protobuf buffer");
            }
            const end = offset + fieldLen;
            let type, id;
            while (offset < end) {
                const innerTag = Number(readVarInt());
                const innerField = innerTag >> 3, innerWireType = innerTag & 7;
                if (innerWireType === 2 && (innerField === 1 || innerField === 2)) {
                    const text = new TextDecoder().decode(takeBytes(Number(readVarInt())));
                    if (innerField === 1) type = text;
                    else id = text;
                } else {
                    skip(innerWireType);
                }
            }
            if (type === "isrc" && id) return id;
        } else {
            skip(wireType);
        }
    }
    return undefined;
}

// Minimal protobuf walk: Track.name = field 2, Track.album = field 3 (Album.name = field 2).
function readProtoStrings(bytes, wanted) {
    const out = {};
    let offset = 0;
    const varint = () => {
        let value = 0, shift = 0, b;
        do {
            if (offset >= bytes.length) throw new Error("Truncated protobuf buffer");
            b = bytes[offset++]; value += (b & 0x7f) * Math.pow(2, shift); shift += 7;
        } while (b & 0x80);
        return value;
    };
    while (offset < bytes.length) {
        const tag = varint(), field = Math.floor(tag / 8), wire = tag & 7;
        if (wire === 0) varint();
        else if (wire === 1) offset += 8;
        else if (wire === 5) offset += 4;
        else if (wire === 2) {
            const len = varint();
            if (offset + len > bytes.length) throw new Error("Truncated protobuf buffer");
            if (wanted.includes(field) && !(field in out)) out[field] = bytes.subarray(offset, offset + len);
            offset += len;
        } else throw new Error("Unsupported protobuf wire type: " + wire);
    }
    return out;
}

function decodeTrackBasics(bytes) {
    const text = b => (b ? new TextDecoder().decode(b) : "");
    const top = readProtoStrings(bytes, [2, 3]);
    const album = top[3] ? readProtoStrings(top[3], [2]) : {};
    return { name: text(top[2]), album: text(album[2]) };
}

const META_STORAGE_PREFIX = "oldlike-meta-v1-";
function readMetaCache(uri) {
    try {
        const raw = localStorage.getItem(META_STORAGE_PREFIX + uri.replace("spotify:track:", ""));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
function writeMetaCache(uri, meta) {
    try { localStorage.setItem(META_STORAGE_PREFIX + uri.replace("spotify:track:", ""), JSON.stringify(meta)); } catch { }
}

// Name + album of any track (cached), used to spot duplicate copies of the same release.
async function resolveTrackMeta(uri) {
    const cached = readMetaCache(uri);
    if (cached) return cached;
    const entries = await fetchTrackMetadataBytes([uri]);
    const entry = entries.find(e => e.uri === uri) || entries[0];
    if (!entry?.ok || !entry.bytes) return null;
    const meta = decodeTrackBasics(entry.bytes);
    if (!meta.name) return null;
    writeMetaCache(uri, meta);
    return meta;
}

const normText = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
// Same recording + same title + same album name = the same release under an old/other ID
// (another copy of the same album), not a different version.
function isSameRelease(meta, info) {
    return !!(meta && info && meta.name && info.name
        && normText(meta.name) === normText(info.name)
        && normText(meta.album) === normText(info.album));
}

async function resolveIsrcs(uris, concurrency = 8) {
    const result = new Map();
    const unknown = [];
    for (const uri of uris) {
        const cached = readIsrcCache(uri);
        if (cached) result.set(uri, cached);
        else unknown.push(uri);
    }

    const batches = [];
    for (let i = 0; i < unknown.length; i += 50) {
        batches.push(unknown.slice(i, i + 50));
    }

    // A shared queue drained by a small pool of concurrent workers: batches are
    // independent RPCs, so awaiting them one at a time serializes for no reason.
    let nextBatchIndex = 0;
    async function worker() {
        while (nextBatchIndex < batches.length) {
            const batch = batches[nextBatchIndex++];
            let entries;
            try {
                entries = await fetchTrackMetadataBytes(batch);
            } catch (error) {
                console.error("[Old Like Button Revamped] Failed to fetch ISRC batch", error);
                continue;
            }
            for (const entry of entries) {
                if (!entry.ok || !entry.bytes) continue;
                let isrc;
                try {
                    isrc = decodeTrackIsrc(entry.bytes);
                } catch {
                    // Malformed/unrecognized shape for this one track; the rest of
                    // the batch and the overall resolution still succeed.
                    continue;
                }
                if (!isrc) continue;
                result.set(entry.uri, isrc);
                writeIsrcCache(entry.uri, isrc);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    return result;
}

async function refreshLikedTracks() {
    if (!(Spicetify.Platform && Spicetify.Platform.LibraryAPI)) {
        setTimeout(refreshLikedTracks, 10);
        return;
    }
    try {
        const library = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 9999999 });
        const items = library?.items || [];
        const snapshot = new Set(items.map(item => item.uri));
        likedInfoByUri = new Map(items.map(item => [item.uri, trackInfoFromItem(item)]));

        // A pending click can be older than this snapshot's own read (started
        // before the click, finished after) and get reverted by it otherwise.
        for (const uri of pendingLikeAdds.keys()) {
            if (snapshot.has(uri)) pendingLikeAdds.delete(uri);
        }
        for (const uri of pendingLikeRemoves) {
            if (!snapshot.has(uri)) pendingLikeRemoves.delete(uri);
        }
        for (const uri of pendingLikeAdds.keys()) snapshot.add(uri);
        for (const uri of pendingLikeRemoves) snapshot.delete(uri);
        likedTrackUris = snapshot;

        const trackUris = [...likedTrackUris].filter(uri => uri.startsWith("spotify:track:"));
        const isrcByUri = await resolveIsrcs(trackUris);
        for (const [uri, isrc] of pendingLikeAdds) {
            if (isrc && !isrcByUri.has(uri)) isrcByUri.set(uri, isrc);
        }
        likedIsrcByUri = isrcByUri;
        likedIsrcs = new Set(likedIsrcByUri.values());
    } catch (error) {
        console.error("[Old Like Button Revamped] Failed to fetch Liked Songs", error);
    }
    document.dispatchEvent(likedTracksChangeEvent);
    setTimeout(refreshLikedTracks, 30000);
}

refreshLikedTracks();

(function quickLike() {
    if (
        !(
            Spicetify.React &&
            Spicetify.ReactDOM &&
            Spicetify.showNotification &&
            Spicetify.Platform &&
            Spicetify.Platform.PlayerAPI &&
            Spicetify.Platform.LibraryAPI &&
            Spicetify.Player &&
            Spicetify.Player.data
        )
    ) {
        setTimeout(quickLike, 10);
        return;
    }

    if (!document.getElementById("old-like-button-style")) {
        const style = document.createElement("style");
        style.id = "old-like-button-style";
        style.textContent = `
            @keyframes oldLikeButtonTooltipIn{from{opacity:0}to{opacity:1}}
            .oldlike-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
                background:none;border:0;padding:0;margin:0 16px 0 0;min-width:16px;height:16px;cursor:pointer;opacity:1;visibility:visible}
            .oldlike-btn:hover svg{filter:brightness(1.4)}
            .oldlike-btn[data-variant="playbar"]{margin:0 8px 0 0}
            .oldlike-btn[data-variant="compact"]{margin:0 8px 0 0}
            .oldlike-btn[data-variant="inline"]{margin:0 12px 0 0}
            .oldlike-inline{display:flex;align-items:center;flex-shrink:0}
            .oldlike-playbar{display:flex;align-items:center}
            ${SHOW_EMPTY_HEARTS_ALWAYS ? "" : `
            .oldlike-btn[data-variant="row"][data-state="none"],.oldlike-btn[data-variant="compact"][data-state="none"]{opacity:0}
            [role="row"]:hover .oldlike-btn,[role="row"]:focus-within .oldlike-btn,[role="row"][aria-selected="true"] .oldlike-btn,
            [data-encore-id="listRow"]:hover .oldlike-btn,[data-encore-id="listRow"]:focus-within .oldlike-btn{opacity:1}`}
        `;
        document.head.appendChild(style);
    }

    const LikeButton = Spicetify.React.memo(function LikeButton({ uri, getUri, getSelection, variant }) {

        function resolveUri() {
            if (typeof getUri === "function") {
                const liveUri = getUri();
                if (liveUri) {
                    return liveUri;
                }
            }
            return uri;
        }

        const initialUri = resolveUri();
        const [currentUri, setCurrentUri] = Spicetify.React.useState(initialUri);
        const [isLiked, setIsLiked] = Spicetify.React.useState(likedTrackUris.has(initialUri));
        const [isrc, setISRC] = Spicetify.React.useState(() => readIsrcCache(initialUri));
        const [hasISRCLiked, setHasISRCLiked] = Spicetify.React.useState(() => likedIsrcs.has(isrc));
        const [isHovered, setIsHovered] = Spicetify.React.useState(false);
        const [showTooltip, setShowTooltip] = Spicetify.React.useState(false);
        const showTooltipTimeout = Spicetify.React.useRef(null);
        const [, setMetaTick] = Spicetify.React.useState(0);

        // Liked from another copy of the same album -> "!" heart; genuinely different versions -> half-heart.
        const matches = (!isLiked && hasISRCLiked) ? likedMatches(currentUri, isrc) : { dups: [], others: [] };
        const effLiked = isLiked;
        const partial = !effLiked && matches.others.length > 0;
        // Liked before Spotify changed this song's ID: the old like is hidden, so flag it.
        const leftover = !effLiked && !partial && matches.dups.length > 0;

        Spicetify.React.useEffect(() => {
            if (isLiked || !hasISRCLiked || !currentUri.startsWith("spotify:track:") || readMetaCache(currentUri)) return;
            let cancelled = false;
            resolveTrackMeta(currentUri)
                .then(meta => { if (meta && !cancelled) setMetaTick(t => t + 1); })
                .catch(error => console.error("[Old Like Button] Failed to read track name/album", error));
            return () => { cancelled = true; };
        }, [currentUri, isLiked, hasISRCLiked]);

        // Rows get recycled for a different track without unmounting; re-read live.
        function syncToLiveTrack() {
            const liveUri = resolveUri();
            const liveIsrc = readIsrcCache(liveUri);
            setCurrentUri(liveUri);
            setIsLiked(likedTrackUris.has(liveUri));
            setISRC(liveIsrc);
            setHasISRCLiked(likedIsrcs.has(liveIsrc));
            return { liveUri, liveIsrc };
        }

        Spicetify.React.useEffect(() => {
            return () => clearTimeout(showTooltipTimeout.current);
        }, []);

        Spicetify.React.useEffect(() => {
            if (isrc != null || currentUri.startsWith("spotify:local:")) return;
            let cancelled = false;
            resolveIsrcs([currentUri]).then(resolved => {
                if (cancelled) return;
                const value = resolved.get(currentUri);
                if (value) {
                    setISRC(value);
                    setHasISRCLiked(likedIsrcs.has(value));
                }
            });
            return () => { cancelled = true; };
        }, [currentUri, isrc]);

        Spicetify.React.useEffect(() => {
            // syncToLiveTrack (not stale currentUri/isrc) so a row recycled to a
            // different track self-corrects on the next liked-list change.
            document.addEventListener('likedTracksChange', syncToLiveTrack);
            return () => document.removeEventListener('likedTracksChange', syncToLiveTrack);
        }, []);

        const isProcessingClick = Spicetify.React.useRef(false);

        const handleClick = async function () {
            if (isProcessingClick.current) return;
            isProcessingClick.current = true;

            const { liveUri } = syncToLiveTrack();
            const selection = typeof getSelection === "function" ? getSelection() : null;
            const selectedUris = selection ? selection.items.map(item => item.uri) : null;
            const targetUris = selectedUris && selectedUris.includes(liveUri) ? selectedUris : [liveUri];
            const liveIsLiked = likedTrackUris.has(liveUri);
            const removeUris = targetUris;
            // The other copy you liked (only unliked if the option is on).
            const leftoverUris = UNLIKE_OTHER_COPY_WHEN_LIKING && !liveIsLiked && targetUris.length === 1
                ? likedMatches(liveUri, readIsrcCache(liveUri)).dups.map(d => d.uri)
                : [];

            // Spotify shows its own "Added to / Removed from Liked Songs" toast; ours would duplicate it.
            if (SHOW_OWN_TOASTS) Spicetify.showNotification(
                targetUris.length > 1
                    ? (liveIsLiked ? `Removed ${targetUris.length} songs from Liked Songs` : `Added ${targetUris.length} songs to Liked Songs`)
                    : (liveIsLiked ? "Removed from Liked Songs" : "Added to Liked Songs")
            );

            try {
                if (liveIsLiked) {
                    await Spicetify.Platform.LibraryAPI.remove({ uris: removeUris });
                    removeUris.forEach(target => {
                        likedTrackUris.delete(target);
                        likedIsrcByUri.delete(target);
                        pendingLikeAdds.delete(target);
                        pendingLikeRemoves.add(target);
                    });
                    likedIsrcs = new Set(likedIsrcByUri.values());
                } else {
                    const nonLocalTargets = targetUris.filter(target => !target.startsWith("spotify:local:"));
                    const isrcByUri = nonLocalTargets.length ? await resolveIsrcs(nonLocalTargets) : new Map();
                    await Spicetify.Platform.LibraryAPI.add({ uris: targetUris });
                    if (leftoverUris.length) {
                        await Spicetify.Platform.LibraryAPI.remove({ uris: leftoverUris });
                        leftoverUris.forEach(target => {
                            likedTrackUris.delete(target);
                            likedIsrcByUri.delete(target);
                            pendingLikeRemoves.add(target);
                        });
                    }
                    targetUris.forEach(target => {
                        likedTrackUris.add(target);
                        const resolvedIsrc = isrcByUri.get(target);
                        if (resolvedIsrc) likedIsrcByUri.set(target, resolvedIsrc);
                        pendingLikeRemoves.delete(target);
                        pendingLikeAdds.set(target, resolvedIsrc ?? null);
                    });
                    likedIsrcs = new Set(likedIsrcByUri.values());
                }
                document.dispatchEvent(likedTracksChangeEvent);

                if (targetUris.length > 1 && selection) {
                    // Spotify's own row click handling collapses the multi-selection to
                    // just this row shortly after any click; put it back the way it was.
                    await new Promise(resolve => setTimeout(resolve, 100));
                    restoreSelection(selection);
                }
            } catch (error) {
                console.error("[Old Like Button Revamped] Failed to update Liked Songs", error);
                Spicetify.showNotification("Could not update Liked Songs, please try again", true);
            } finally {
                isProcessingClick.current = false;
            }

            syncToLiveTrack();
        };

        const handleMouseOver = function () {
            syncToLiveTrack();
            setIsHovered(true);
            showTooltipTimeout.current = setTimeout(() => setShowTooltip(true), 200);
        }

        const handleMouseOut = function () {
            setIsHovered(false);
            setShowTooltip(false);
            clearTimeout(showTooltipTimeout.current);
        }

        const buttonRef = Spicetify.React.useRef(null);

        // One shared tooltip element appended straight to <body> (plain DOM, no React
        // portal), position: fixed at max z-index, so no panel or row can clip it.
        Spicetify.React.useLayoutEffect(() => {
            if (!showTooltip) return;
            let tip = document.getElementById("oldlike-tooltip");
            if (!tip) {
                tip = document.createElement("div");
                tip.id = "oldlike-tooltip";
                tip.setAttribute("role", "tooltip");
                document.body.appendChild(tip);
            } else if (tip.parentElement !== document.body || tip !== document.body.lastElementChild) {
                document.body.appendChild(tip); // keep it last so it paints on top
            }
            if (effLiked) {
                tip.textContent = "Remove from Liked Songs";
            } else if (partial) {
                const others = matches.others;
                const shown = others.slice(0, 5).map(v => "\u2022 " + describeVersion(v));
                if (others.length > 5) shown.push(`\u2022 \u2026and ${others.length - 5} more`);
                tip.textContent = "Add to Liked Songs\nYou already like another version of this recording:\n"
                    + shown.join("\n") + "\nRight-click the song \u2192 Show liked versions to open one";
            } else if (leftover) {
                tip.textContent = "You've liked this song from another copy of the same album, so Spotify shows this copy as not liked."
                    + "\nClick to like this copy too" + (UNLIKE_OTHER_COPY_WHEN_LIKING ? " (the other copy will be unliked)." : ".");
            } else {
                tip.textContent = "Add to Liked Songs";
            }
            tip.style.cssText = [
                "position:fixed", "left:0", "top:0", "visibility:hidden", "display:block",
                "padding:4px 8px", "border-radius:4px", "background:rgb(40,40,40)", "color:#fff",
                "font-size:14px", "font-weight:400", "line-height:1.4",
                "width:max-content", "max-width:min(520px, calc(100vw - 16px))", "white-space:pre-line",
                "pointer-events:none", "z-index:2147483647",
                "box-shadow:rgba(0,0,0,.3) 0 16px 24px 0, rgba(0,0,0,.2) 0 6px 8px 0",
                "animation:oldLikeButtonTooltipIn 120ms ease-out"
            ].join(";");

            const btn = buttonRef.current;
            if (btn) {
                const b = btn.getBoundingClientRect(), t = tip.getBoundingClientRect();
                const margin = 8;
                const left = Math.min(Math.max(b.left + b.width / 2 - t.width / 2, margin), window.innerWidth - t.width - margin);
                let top = b.top - t.height - 8;
                if (top < margin) top = b.bottom + 8;
                tip.style.left = left + "px";
                tip.style.top = top + "px";
                tip.style.visibility = "visible";
            }

            const hide = () => setShowTooltip(false);
            window.addEventListener("scroll", hide, true);
            window.addEventListener("resize", hide);
            return () => {
                tip.style.display = "none";
                window.removeEventListener("scroll", hide, true);
                window.removeEventListener("resize", hide);
            };
        }, [showTooltip, effLiked, partial, leftover, currentUri, isrc, matches.others.length]);


        const state = effLiked ? "liked" : partial ? "partial" : leftover ? "leftover" : "none";
        return Spicetify.React.createElement(
            "button",
            {
                ref: buttonRef,
                className: "oldlike-btn",
                "data-state": state,
                "data-variant": variant || "row",
                "aria-checked": effLiked || partial,
                "aria-label": effLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
                onClick: handleClick,
                onMouseOver: handleMouseOver,
                onMouseOut: handleMouseOut
            },
            Spicetify.React.createElement(
                // Inline-sized instead of a hardcoded class name, which was 6px too tall.
                "span",
                {
                    style: {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "16px",
                        height: "16px"
                    }
                },
                Spicetify.React.createElement("svg", {
                    role: "img",
                    height: "16",
                    width: "16",
                    viewBox: "0 0 24 24",
                    style: {
                        fill: (effLiked || partial) ? "var(--text-bright-accent)" : "var(--text-subdued)"
                    },
                    dangerouslySetInnerHTML: {
                        __html: effLiked
                            ? (isHovered
                                ? `<path d="M19.5 10c-2.483 0-4.5 2.015-4.5 4.5s2.017 4.5 4.5 4.5 4.5-2.015 4.5-4.5-2.017-4.5-4.5-4.5zm2.5 5h-5v-1h5v1zm-6.527 4.593c-1.108 1.086-2.275 2.219-3.473 3.407-6.43-6.381-12-11.147-12-15.808 0-6.769 8.852-8.346 12-2.944 3.125-5.362 12-3.848 12 2.944 0 .746-.156 1.496-.423 2.253-1.116-.902-2.534-1.445-4.077-1.445-3.584 0-6.5 2.916-6.5 6.5 0 2.063.97 3.901 2.473 5.093z"></path>`
                                : `<path d="M12 4.248c-3.148-5.402-12-3.825-12 2.944 0 4.661 5.571 9.427 12 15.808 6.43-6.381 12-11.147 12-15.808 0-6.792-8.875-8.306-12-2.944z"/></path>`)
                            : (partial
                                ? (isHovered
                                    ? `<path d="M 4.851562 1.148438 C 1.820312 1.808594 -0.191406 4.480469 0.0390625 7.550781 C 0.148438 9.109375 0.640625 10.339844 1.839844 12.148438 C 2.980469 13.859375 4.230469 15.25 8.261719 19.300781 L 12 23.050781 L 13.710938 21.328125 L 15.429688 19.621094 L 14.78125 18.910156 C 13.679688 17.730469 13.128906 16.449219 13.039062 14.851562 C 12.839844 11.730469 15.078125 8.789062 18.148438 8.148438 C 19.871094 7.789062 21.910156 8.199219 23.171875 9.160156 C 23.339844 9.289062 23.511719 9.398438 23.539062 9.398438 C 23.660156 9.398438 23.910156 8.300781 23.96875 7.550781 C 24.148438 5.050781 22.859375 2.75 20.699219 1.730469 C 20.230469 1.5 19.640625 1.269531 19.378906 1.210938 C 17.539062 0.78125 15.570312 1.109375 14.019531 2.121094 C 13.390625 2.53125 12.550781 3.371094 12.230469 3.910156 C 12.140625 4.070312 12.03125 4.199219 12 4.199219 C 11.96875 4.199219 11.800781 3.96875 11.609375 3.691406 C 10.878906 2.621094 9.621094 1.730469 8.25 1.300781 C 7.328125 1.011719 5.800781 0.949219 4.851562 1.148438 Z M 8.988281 3.949219 C 10.101562 4.238281 11.179688 4.980469 11.78125 5.871094 L 12 6.179688 L 11.980469 13.191406 L 11.949219 20.210938 L 9.5 17.769531 C 7.328125 15.621094 6.578125 14.828125 5.410156 13.5 C 4.558594 12.53125 3.609375 10.921875 3.261719 9.851562 C 3 9.050781 2.949219 8.050781 3.148438 7.300781 C 3.589844 5.589844 4.539062 4.570312 6.25 3.988281 C 6.878906 3.78125 8.269531 3.75 8.988281 3.949219 Z M 8.988281 3.949219"/></path><path d="M 18.449219 10.140625 C 17.621094 10.339844 16.988281 10.699219 16.339844 11.339844 C 14.570312 13.121094 14.570312 15.878906 16.339844 17.660156 C 18.121094 19.429688 20.878906 19.429688 22.660156 17.660156 C 24.429688 15.878906 24.429688 13.121094 22.660156 11.339844 C 21.519531 10.210938 19.980469 9.769531 18.449219 10.140625 Z M 20 13 L 20 14 L 22 14 L 22 15 L 20 15 L 20 17 L 19 17 L 19 15 L 17 15 L 17 14 L 19 14 L 19 12 L 20 12 Z M 20 13"/></path>`
                                    : `<path d="M 5.449219 1.058594 C 5.339844 1.078125 5 1.148438 4.699219 1.210938 C 4.398438 1.269531 3.769531 1.5 3.300781 1.71875 C 0.710938 2.960938 -0.550781 5.949219 0.261719 8.949219 C 0.648438 10.410156 1.851562 12.390625 3.550781 14.398438 C 4.089844 15.03125 6.210938 17.238281 8.269531 19.300781 L 12 23.050781 L 15.730469 19.300781 C 19.769531 15.25 21.019531 13.859375 22.160156 12.148438 C 23.359375 10.339844 23.851562 9.109375 23.960938 7.550781 C 24.199219 4.410156 22.148438 1.761719 19 1.140625 C 16.480469 0.640625 13.738281 1.699219 12.390625 3.691406 C 12.199219 3.96875 12.03125 4.199219 12 4.199219 C 11.96875 4.199219 11.871094 4.070312 11.769531 3.910156 C 11.238281 3.011719 10 1.988281 8.871094 1.53125 C 7.839844 1.109375 6.28125 0.898438 5.449219 1.058594 Z M 9.289062 4.039062 C 9.691406 4.171875 10.269531 4.449219 10.570312 4.660156 C 11.160156 5.070312 11.859375 5.871094 11.949219 6.230469 C 11.980469 6.351562 11.988281 9.550781 11.980469 13.351562 L 11.949219 20.25 L 9.140625 17.449219 C 5.28125 13.589844 4.019531 12.011719 3.269531 10.050781 C 3.121094 9.660156 3.070312 9.28125 3.070312 8.351562 C 3.058594 7.179688 3.070312 7.128906 3.410156 6.398438 C 3.929688 5.300781 4.898438 4.441406 6.050781 4.050781 C 6.679688 3.839844 6.800781 3.820312 7.699219 3.808594 C 8.359375 3.800781 8.730469 3.859375 9.289062 4.039062 Z M 9.289062 4.039062"/></path>`)
                                : (leftover ? LEFTOVER_ICON : `<path d="M19.5 10c-2.483 0-4.5 2.015-4.5 4.5s2.017 4.5 4.5 4.5 4.5-2.015 4.5-4.5-2.017-4.5-4.5-4.5zm2.5 5h-2v2h-1v-2h-2v-1h2v-2h1v2h2v1zm-6.527 4.593c-1.108 1.086-2.275 2.219-3.473 3.407-6.43-6.381-12-11.147-12-15.808 0-4.005 3.098-6.192 6.281-6.192 2.197 0 4.434 1.042 5.719 3.248 1.279-2.195 3.521-3.238 5.726-3.238 3.177 0 6.274 2.171 6.274 6.182 0 .746-.156 1.496-.423 2.253-.527-.427-1.124-.768-1.769-1.014.122-.425.192-.839.192-1.239 0-2.873-2.216-4.182-4.274-4.182-3.257 0-4.976 3.475-5.726 5.021-.747-1.54-2.484-5.03-5.72-5.031-2.315-.001-4.28 1.516-4.28 4.192 0 3.442 4.742 7.85 10 13l2.109-2.064c.376.557.839 1.048 1.364 1.465z"></path>`))
                    }
                })
            )
        );
    });



    // ---- Now-playing bar (bottom left) ----
    // Puts the heart directly to the LEFT of the "+" / tick button.
    // Uses several selectors because Spotify keeps renaming its classes.
    function findPlaybarWidget() {
        return document.querySelector('[data-testid="now-playing-widget-v2"]')
            || document.querySelector('[data-testid="now-playing-widget"]')
            || document.querySelector(".main-nowPlayingWidget-nowPlaying");
    }

    function findPlaybarTick(widget) {
        const buttons = [...widget.querySelectorAll("button")].filter(b => !b.closest(".likeControl-wrapper"));
        const label = b => b.getAttribute("aria-label") || "";
        return buttons.find(b => /liked songs|playlist/i.test(label(b)))
            || buttons.find(b => b.hasAttribute("aria-checked"))
            || buttons.find(b => b.getAttribute("data-encore-id") === "buttonTertiary" && !/video/i.test(label(b)))
            || null;
    }

    let currentPlaybarContainer = null;
    let currentPlaybarUri = null;
    let playbarFallbackLogged = false;
    const getPlayingUri = () => Spicetify.Player.data?.item?.uri || "";

    function ensurePlaybarButton() {
        const widget = findPlaybarWidget();
        if (!widget) return;
        const tick = findPlaybarTick(widget);
        const uri = getPlayingUri();

        // No tick, or a podcast/ad: take the heart away.
        // Podcast/ad: no heart.
        if (!/^spotify:(track|local):/.test(uri)) {
            if (currentPlaybarContainer?.isConnected) currentPlaybarContainer.remove();
            return;
        }

        if (!currentPlaybarContainer) {
            currentPlaybarContainer = document.createElement("div");
            currentPlaybarContainer.className = "likeControl-wrapper oldlike-playbar";
        }
        if (tick) {
            // Normal case: heart directly left of the "+" / tick.
            if (currentPlaybarContainer.nextElementSibling !== tick) {
                tick.parentNode.insertBefore(currentPlaybarContainer, tick);
            }
        } else if (currentPlaybarContainer.parentElement !== widget || widget.lastElementChild !== currentPlaybarContainer) {
            // No tick found in this Spotify version: put the heart at the end of the widget instead.
            if (!playbarFallbackLogged) {
                playbarFallbackLogged = true;
                console.warn("[Old Like Button] No +/tick button found in the now-playing widget; placing the heart at its end.",
                    [...widget.querySelectorAll("button")].map(b => b.getAttribute("aria-label")));
            }
            widget.appendChild(currentPlaybarContainer);
        }
        if (currentPlaybarUri !== uri) {
            currentPlaybarUri = uri;
            Spicetify.ReactDOM.render(
                Spicetify.React.createElement(LikeButton, { uri, key: uri, getUri: getPlayingUri, variant: "playbar" }),
                currentPlaybarContainer
            );
        }
    }


    // ---- Track rows (playlists, albums, artist pages, search, queue, ...) ----
    // Main view button insertion
    function findUriFromFiber(domNode, maxDepth = 15) {
        // The row's own uri is a direct prop a few fiber ancestors up, not in its children.
        const fiberKey = Object.keys(domNode).find(key => key.startsWith("__reactFiber$"));
        const propsKey = Object.keys(domNode).find(key => key.startsWith("__reactProps$"));
        let fiber = fiberKey ? domNode[fiberKey] : null;
        // The node's stored fiber can be the stale copy after a row is reused for
        // another song; the live one is whichever holds the node's current props.
        if (fiber && fiber.alternate && propsKey && fiber.alternate.memoizedProps === domNode[propsKey]) {
            fiber = fiber.alternate;
        }
        for (let i = 0; i < maxDepth && fiber; i++) {
            const uri = fiber.memoizedProps && fiber.memoizedProps.uri;
            if (typeof uri === "string" && /^spotify:(track|local):/.test(uri)) {
                return uri;
            }
            fiber = fiber.return;
        }
        return undefined;
    }

    function findSelectionApi(domNode, maxDepth = 60) {
        // Tracklist rows sit under a context provider exposing the list's
        // real selection state, identified by its shape (no exported symbol).
        const fiberKey = Object.keys(domNode).find(key => key.startsWith("__reactFiber$"));
        let fiber = fiberKey ? domNode[fiberKey] : null;
        for (let i = 0; i < maxDepth && fiber; i++) {
            if (fiber.tag === 10) {
                const value = fiber.memoizedProps && fiber.memoizedProps.value;
                if (value && typeof value.toggleSelected === "function" && typeof value.isSelected === "function" && typeof value.getSelected === "function") {
                    return value;
                }
            }
            fiber = fiber.return;
        }
        return null;
    }

    function getMultiSelection(rowElement) {
        // Bulk-apply only when the clicked row is itself part of the selection,
        // so clicking an unselected row while others are selected stays single-track.
        if (!rowElement || rowElement.getAttribute("aria-selected") !== "true") {
            return null;
        }
        const api = findSelectionApi(rowElement);
        if (!api) return null;
        // Entries keep the uri they were recorded with and outlive their row, so
        // isSelected drops ones whose row the list has since dropped or moved.
        const items = api.getSelected().filter(item => item.uri && api.isSelected(item.index));
        if (items.length < 2) return null;

        // A surviving entry can still describe a track the row no longer shows, so
        // only act when the selection matches every row on screen.
        const uris = new Set(items.map(item => item.uri));
        const container = rowElement.closest(".main-trackList-trackList");
        const rendered = container ? [...container.querySelectorAll('[role="row"][aria-selected]')] : [];
        const matchesView = rendered.every(row => {
            const uri = findUriFromFiber(row);
            return uri == null || (row.getAttribute("aria-selected") === "true") === uris.has(uri);
        });
        return matchesView ? { api, items } : null;
    }

    function restoreSelection(selection) {
        // toggleSelected's 3-arg form (index, rangeExtend, additive) re-adds
        // an index the way a real ctrl-click would, instead of replacing.
        try {
            const wantedUriByIndex = new Map(selection.items.map(item => [item.index, item.uri]));
            for (const item of selection.api.getSelected()) {
                if (!wantedUriByIndex.has(item.index)) {
                    selection.api.toggleSelected(item.index, false, true);
                }
            }
            for (const index of wantedUriByIndex.keys()) {
                if (!selection.api.isSelected(index)) {
                    selection.api.toggleSelected(index, false, true);
                }
            }
            // Indices are list positions, so a list that shrank under us (unliking
            // on Liked Songs drops rows) leaves them pointing at other tracks.
            const restored = selection.api.getSelected();
            const intact = restored.length === wantedUriByIndex.size
                && restored.every(item => wantedUriByIndex.get(item.index) === item.uri);
            if (!intact) {
                selection.api.clearSelected();
            }
        } catch (error) {
            console.error("[Old Like Button Revamped] Failed to restore selection", error);
        }
    }

    function unmountWrappersWithin(node) {
        if (!(node instanceof Element)) return;
        const wrappers = node.matches(".likeControl-wrapper") ? [node] : [...node.querySelectorAll(".likeControl-wrapper")];
        wrappers.forEach(wrapper => {
            // waitForWidgetMounted owns this one; unmounting it here raced its
            // own re-render on every song change and wiped the button out.
            if (wrapper === currentPlaybarContainer) return;
            try {
                Spicetify.ReactDOM.unmountComponentAtNode(wrapper);
            } catch (error) {
                console.error("[Old Like Button Revamped] Failed to unmount a row button", error);
            }
        });
    }

    // Checks every visible track row and makes sure it has a heart for the right song.
    // Runs whenever the page changes, so it also covers rows that are reused while
    // scrolling and buttons that only appear on hover.
    function ensureRowButtons() {
        // Normal track rows, plus compact list rows (queue, search results, search suggestions)
        // which aren't always inside a role="row" element.
        const seenRows = new Set();
        document.querySelectorAll('[role="row"], [data-encore-id="listRow"]').forEach(el => {
            const row = el.matches('[data-encore-id="listRow"]') ? (el.closest('[role="row"]') || el) : el;
            if (seenRows.has(row)) return;
            seenRows.add(row);
            try {
                const listRowEl = row.matches('[data-encore-id="listRow"]') ? row : row.querySelector('[data-encore-id="listRow"]');
                const uri = findUriFromFiber(row)
                    || (listRowEl && (findUriFromFiber(listRowEl) || [...listRowEl.children].map(c => findUriFromFiber(c)).find(Boolean)));
                if (!uri) return;

                const removeStray = scope => {
                    scope?.querySelectorAll(".likeControl-wrapper").forEach(stray => {
                        try { Spicetify.ReactDOM.unmountComponentAtNode(stray); } catch { }
                        stray.remove();
                    });
                };

                // Where the heart goes: a container, the node to insert before, and a style variant.
                let container = null, before = null, variant = "row";

                const listRow = listRowEl;
                if (listRow) {
                    // Compact list rows (the queue, side panels): put the heart in the right-hand
                    // slot, just left of the "..." button, so the title/artist text isn't pushed around.
                    const slot = listRow.querySelector('[class*="list-row__slot"]');
                    // The "..." button: any button in the slot that isn't our own heart.
                    const moreButton = slot ? [...slot.querySelectorAll("button")].find(btn => !btn.closest(".likeControl-wrapper")) : null;
                    if (slot && moreButton) {
                        container = moreButton.parentElement;
                        before = moreButton;
                    } else {
                        // No "..." button (e.g. search suggestions): put the heart at the right-hand end
                        // of the row; the title column shrinks a little instead of moving.
                        const header = [...listRow.querySelectorAll('[class*="list-row__header"]')]
                            .find(h => !/header-side/.test(h.className)) || listRow;
                        container = header;
                        before = null;
                    }
                    variant = "compact";
                    // Clean up hearts anywhere else in this row (e.g. an older version's, next to the title).
                    [...listRow.querySelectorAll(".likeControl-wrapper")].filter(w => w.parentElement !== container).forEach(w => {
                        try { Spicetify.ReactDOM.unmountComponentAtNode(w); } catch { }
                        w.remove();
                    });
                } else {
                    const cells = row.querySelectorAll('[role="gridcell"]');
                    const cell = cells[cells.length - 1] || row.firstElementChild?.lastElementChild;
                    if (!cell) return;
                    // Other rows without a separate actions column: the last cell holds the
                    // cover/title/artist, and a heart there breaks its layout. Skip them.
                    if (cells.length < 2 || cell.querySelector('a[href*="/track/"], a[href*="/artist/"], a[href*="/album/"], img')) {
                        removeStray(cell);
                        return;
                    }
                    container = cell;
                    before = cell.firstChild;
                }

                let wrapper = container.querySelector(":scope > .likeControl-wrapper");
                if (!wrapper) {
                    wrapper = document.createElement("div");
                    wrapper.className = "likeControl-wrapper";
                    wrapper.style.display = "contents";
                    container.insertBefore(wrapper, before);
                }
                if (wrapper.dataset.uri !== uri) {
                    wrapper.dataset.uri = uri;
                    Spicetify.ReactDOM.render(
                        Spicetify.React.createElement(LikeButton, {
                            uri,
                            key: uri,
                            getUri: () => findUriFromFiber(row),
                            getSelection: () => getMultiSelection(row),
                            variant
                        }),
                        wrapper
                    );
                }
            } catch (error) {
                console.error("[Old Like Button Revamped] Failed to attach a row button", error);
            }
        });
    }

    // Anywhere else Spotify shows its own "+" / tick for a song (search top result, search
    // results list, search suggestions, ...): put the heart directly to its left.
    function isCurationButton(btn) {
        if (btn.closest(".likeControl-wrapper")) return false; // our own heart
        const label = btn.getAttribute("aria-label") || "";
        return /liked songs|add to playlist/i.test(label);
    }

    function ensureInlineButtons() {
        const playbar = findPlaybarWidget();
        document.querySelectorAll("button[aria-label]").forEach(btn => {
            try {
                if (!isCurationButton(btn) || playbar?.contains(btn) || !btn.getClientRects().length) return;
                // Rows the main logic already handles (track lists, queue) have their heart already.
                const rowLike = btn.closest('[role="row"], [data-encore-id="listRow"]');
                if (rowLike && [...rowLike.querySelectorAll(".oldlike-btn")].some(h => !h.closest(".oldlike-inline"))) return;

                const uri = findUriFromFiber(btn, 25);
                if (!uri) return;

                // Sit left of the button's own box (Spotify often wraps it in a single-child div).
                let target = btn;
                for (let i = 0; i < 2 && target.parentElement && target.parentElement.childElementCount === 1
                    && !target.parentElement.matches('[role="row"], [role="option"], li'); i++) {
                    target = target.parentElement;
                }
                let wrapper = target.previousElementSibling;
                if (!wrapper?.classList?.contains("oldlike-inline")) {
                    wrapper = document.createElement("div");
                    wrapper.className = "likeControl-wrapper oldlike-inline";
                    // Keep clicks on the heart from also triggering the row/suggestion underneath.
                    ["click", "mousedown", "pointerdown", "mouseup", "pointerup", "dblclick"].forEach(type =>
                        wrapper.addEventListener(type, e => e.stopPropagation()));
                    target.parentElement.insertBefore(wrapper, target);
                }
                if (wrapper.dataset.uri !== uri) {
                    wrapper.dataset.uri = uri;
                    Spicetify.ReactDOM.render(
                        Spicetify.React.createElement(LikeButton, { uri, key: uri, getUri: () => findUriFromFiber(btn, 25) || uri, variant: "inline" }),
                        wrapper
                    );
                }
            } catch (error) {
                console.error("[Old Like Button] Failed to attach a heart next to a +/tick button", error);
            }
        });
        // Remove inline hearts whose "+" / tick has gone away.
        document.querySelectorAll(".oldlike-inline").forEach(w => {
            const next = w.nextElementSibling;
            const stillThere = next && (next.matches("button") ? isCurationButton(next) : [...next.querySelectorAll("button[aria-label]")].some(isCurationButton));
            if (!stillThere) {
                try { Spicetify.ReactDOM.unmountComponentAtNode(w); } catch { }
                w.remove();
            }
        });
    }

    let scanQueued = false;
    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        requestAnimationFrame(() => {
            scanQueued = false;
            ensureRowButtons();
            try { ensureInlineButtons(); } catch (error) { console.error("[Old Like Button] Inline hearts failed", error); }
            try { ensurePlaybarButton(); } catch (error) { console.error("[Old Like Button Revamped] Playbar button failed", error); }
        });
    }

    const observer = new MutationObserver(mutationList => {
        mutationList.forEach(mutation => mutation.removedNodes.forEach(unmountWrappersWithin));
        queueScan();
    });
    // ---- Right-click \u2192 "Show liked versions of this recording" ----
    function goToUri(uri) {
        try {
            const path = Spicetify.URI.fromString(uri)?.toURLPath?.(true);
            Spicetify.Platform.History.push(path || "/" + uri.split(":").slice(1).join("/"));
        } catch {
            Spicetify.Platform.History.push("/" + uri.split(":").slice(1).join("/"));
        }
    }

    function showLikedVersions(uri) {
        const isrc = readIsrcCache(uri);
        const others = otherLikedVersions(uri, isrc);
        const box = document.createElement("div");
        box.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:320px";
        const intro = document.createElement("div");
        intro.style.cssText = "opacity:.7;margin-bottom:4px";
        intro.textContent = others.length
            ? `Same recording (ISRC ${isrc}). Click one to open its album.`
            : "No other liked versions found.";
        box.append(intro);
        for (const v of others) {
            const row = document.createElement("button");
            row.style.cssText = "all:unset;cursor:pointer;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.07);display:flex;flex-direction:column";
            const title = document.createElement("span");
            title.style.fontWeight = "600";
            title.textContent = v.name || v.uri;
            const meta = document.createElement("span");
            meta.style.cssText = "font-size:12px;opacity:.65";
            meta.textContent = [v.artists, v.album].filter(Boolean).join(" \u00b7 ");
            row.append(title, meta);
            row.onmouseenter = () => (row.style.background = "rgba(255,255,255,.14)");
            row.onmouseleave = () => (row.style.background = "rgba(255,255,255,.07)");
            row.onclick = () => { Spicetify.PopupModal.hide(); goToUri(v.albumUri || v.uri); };
            box.append(row);
        }
        Spicetify.PopupModal.display({ title: "Liked versions of this recording", content: box });
    }

    (function registerContextMenu() {
        if (!(Spicetify.ContextMenu && Spicetify.PopupModal && Spicetify.URI)) {
            setTimeout(registerContextMenu, 300);
            return;
        }
        new Spicetify.ContextMenu.Item(
            "Show liked versions of this recording",
            uris => showLikedVersions(uris[0]),
            uris => uris.length === 1 && uris[0].startsWith("spotify:track:")
                && otherLikedVersions(uris[0], readIsrcCache(uris[0])).length > 0,
            "heart"
        ).register();
    })();

    // characterData too: a reused row may only change its text, which childList misses.
    observer.observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener("scroll", queueScan, { capture: true, passive: true });

    Spicetify.Player.addEventListener("songchange", queueScan);
    setInterval(queueScan, 1000); // safety net
    queueScan();
})();
