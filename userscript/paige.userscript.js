// ==UserScript==
// @name         AO3 Smart Name Highlighter + Pronoun Colorizer (with Scroll Anim + Side Panel)
// @namespace    ao3-smart-names
// @version      1.3.0
// @description  Intelligently detect character names & pronouns on AO3, color & animate them on scroll, show a side panel with avatars & facts, and persist per-work context.
// @author       you
// @match        https://archiveofourown.org/works/*
// @match        https://archiveofourown.org/chapters/*
// @run-at       document-idle
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js
// ==/UserScript==

(() => {
    'use strict';

    /** ---------------------------------------
     * Constants & Config
     * ------------------------------------- */

    /** Backend endpoint for analysis; empty string uses mock in this script. */
    const BACKEND_URL = ''; // e.g., 'https://your-backend.example.com/api/v1/analyze'
    const NAMES_URL = 'http://localhost:8080/api/names';
    const SUMMARIZE_URL = 'http://localhost:8080/api/summarize';

    /** Nodes that contain the main story text. */
    const STORY_SELECTORS = [
        '#workskin .userstuff',
        '#workskin .preface .notes',
    ];

    /** Nodes to exclude from parsing. */
    const EXCLUDE_SELECTORS = [
        '#feedback', '#comments', 'nav', 'header', 'footer', '.splash', '.index', '.bookmark', '.tags',
    ];

    /** Seed list to bias initial name detection prior to backend results. */
    const COMMON_NAME_SEED = [
        'Alex', 'Andrew', 'Anna', 'Ariel', 'Ashley', 'Ben', 'Cass', 'Charles', 'Charlotte', 'Chris', 'Daniel',
        'Eli', 'Elijah', 'Emily', 'Emma', 'Finn', 'Grace', 'Harry', 'Isabel', 'Jack', 'Jacob', 'James', 'Jason',
        'Jess', 'Jessica', 'John', 'Jon', 'June', 'Kate', 'Katie', 'Liam', 'Lucas', 'Lucy', 'Marcus', 'Maria',
        'Mary', 'Max', 'Michael', 'Mina', 'Noah', 'Olivia', 'Oscar', 'Peter', 'Rachel', 'Rose', 'Sam', 'Sara',
        'Sarah', 'Sophia', 'Theo', 'Thomas', 'Violet', 'Will', 'William', 'Zoe'
    ];

    /** Pronouns to colorize (case-insensitive word matches). */
    const PRONOUNS = [
        'he', 'him', 'his', 'himself',
        'she', 'her', 'hers', 'herself',
        'they', 'them', 'their', 'theirs', 'themself', 'themselves',
        'xe', 'xem', 'xyr', 'xyrs', 'xemself',
        'ze', 'zir', 'zirs', 'zirself',
        'fae', 'faer', 'faers', 'faerself',
        'it', 'its', 'itself'
    ];

    /** Mentions heuristics for major/minor classification. */
    const MIN_MAJOR_MENTIONS = 6;
    const MIN_MINOR_MENTIONS = 2;
    const MAX_GROUP_NAME_LENGTH = 2;

    /** Work-scoped key. */
    const WORK_ID = (location.pathname.match(/\/(works|chapters)\/(\d+)/) || []).slice(1).join(':') || location.pathname;
    const LS_KEY = `ao3-smart-names:v1:${WORK_ID}`;

    /** CSS class names used by the script. */
    const CLS = {
        name: 'ao3sn-name',
        pronoun: 'ao3sn-pronoun',
        glow: 'ao3sn-glow',
        shine: 'ao3sn-shine',
        inview: 'ao3sn-inview',
        letter: 'ao3sn-letter',
        infoDot: 'ao3sn-info-dot',
        tooltip: 'ao3sn-tooltip',
        panel: 'ao3sn-panel',
        panelPinned: 'ao3sn-panel-pinned',
        panelCollapsed: 'ao3sn-panel-collapsed',
        panelHeader: 'ao3sn-panel-header',
        throbber: 'ao3sn-throbber',
        btn: 'ao3sn-btn',
        list: 'ao3sn-list',
        listMinor: 'ao3sn-list-minor',
        card: 'ao3sn-card',
        avatar: 'ao3sn-avatar',
        row: 'ao3sn-row',
        compactName: 'ao3sn-compact-name',
        iconBtn: 'ao3sn-icon-btn',
        manualBox: 'ao3sn-manual',
        resizer: 'ao3sn-resizer', // New class for the resizer handle
    };

    /** ---------------------------------------
     * Styles
     * ------------------------------------- */
    GM_addStyle(`
    .${CLS.name}, .${CLS.pronoun} {
      position: relative;
      transition: filter 200ms ease, transform 200ms ease;
      border-radius: 0.15em;
      padding: 0 0.08em;
      text-decoration: none;
      cursor: default;
    }
    .${CLS.name}:hover, .${CLS.pronoun}:hover {
      filter: brightness(1.15);
    }

    .${CLS.shine} {
      background-image:
        linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%);
      background-size: 200% 100%;
      background-position: -120% 0%;
      -webkit-background-clip: text;
      background-clip: text;
      color: currentColor;
    }
    .${CLS.inview}.${CLS.shine} {
      animation: ao3sn-shine 1.1s ease forwards;
    }
    @keyframes ao3sn-shine {
      0% { background-position: -120% 0%; }
      100% { background-position: 120% 0%; }
    }

    .${CLS.letter} {
      display: inline-block;
      will-change: transform, filter;
    }

    .${CLS.infoDot} {
      display: inline-block;
      width: 0.8em;
      height: 0.8em;
      margin-left: 0.25em;
      border-radius: 50%;
      border: 1px solid currentColor;
      vertical-align: middle;
      position: relative;
      top: -0.05em;
      cursor: pointer;
      opacity: 0.9;
    }
    .${CLS.infoDot}:hover { filter: brightness(1.25); }

    .${CLS.tooltip} {
      position: absolute;
      z-index: 9999;
      background: rgba(20, 20, 30, 0.97);
      color: #fff;
      padding: 8px 10px;
      border-radius: 8px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.35);
      font-size: 0.9em;
      line-height: 1.35em;
      max-width: 260px;
      pointer-events: none;
      transform: translate(-50%, calc(-100% - 12px));
      border: 1px solid rgba(255,255,255,0.1);
      opacity: 0;
      transition: opacity 150ms ease, transform 150ms ease;
    }

    .${CLS.panel} {
      position: fixed;
      top: 10%;
      right: 0;
      transform: translateX(calc(100% - 48px));
      width: 320px;
      height: 60vh; /* Default height */
      min-height: 250px; /* Minimum draggable height */
      max-height: 90vh; /* Maximum draggable height */
      background: rgba(250,250,255,0.98);
      border-left: 2px solid #ddd;
      border-top: 2px solid #ddd;
      border-bottom: 2px solid #ddd;
      border-top-left-radius: 12px;
      border-bottom-left-radius: 12px;
      box-shadow: -8px 10px 32px rgba(0,0,0,0.15);
      transition: transform 200ms ease, width 200ms ease;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      color: #222;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: none; /* Disable native resize */
    }
    .${CLS.panel}:hover { transform: translateX(0); }
    .${CLS.panel}.${CLS.panelPinned} { transform: translateX(0); }
    .${CLS.panel}.${CLS.panelCollapsed} {
      width: 220px;
    }

    .${CLS.panelHeader} {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 10px 8px 10px;
      border-bottom: 1px solid #e5e5e5;
      background: #fff;
    }
    .${CLS.btn}, .${CLS.iconBtn} {
      border: 1px solid #ddd;
      background: #f8f8f8;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .${CLS.iconBtn} { padding: 4px 8px; }

    .${CLS.manualBox} {
      display: grid; grid-template-columns: 1fr auto;
      gap: 6px; padding: 8px 10px; background: #fafafa; border-bottom: 1px solid #eee;
    }
    .${CLS.manualBox} input {
      padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;
    }

    .${CLS.list} {
      flex-grow: 1;
      overflow: auto; padding: 8px; display: grid; gap: 8px;
    }
    .${CLS.listMinor} {
      border-top: 1px dashed #ddd; margin-top: 4px; padding-top: 6px;
    }

    .${CLS.card} {
      display: grid;
      grid-template-columns: 42px 1fr auto;
      gap: 10px;
      align-items: center;
      border: 1px solid #eee;
      background: #fff;
      border-radius: 10px;
      padding: 8px;
    }
    .${CLS.avatar} {
      width: 42px; height: 42px; border-radius: 50%; flex: 0 0 auto; border: 1px solid rgba(0,0,0,0.08);
      background: #f0f0ff; overflow: hidden;
    }
    .${CLS.row} { display: grid; gap: 2px; }
    .${CLS.compactName} {
      font-weight: 700; font-size: 13px; line-height: 1.2;
    }

    .${CLS.throbber} {
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      background: rgba(20,20,30,0.9); color: #fff; padding: 8px 12px;
      border-radius: 8px; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      display: none;
    }
    .${CLS.throbber}::after {
      content: '…'; animation: ao3sn-dots 1s infinite steps(3, end);
      margin-left: 6px;
    }
    @keyframes ao3sn-dots { 0% { content: '…'; } 33% { content: '.'; } 66% { content: '..'; } 100% { content: '…'; } }

    /* POV gradient for the main character name in text */
    .${CLS.name}[data-main="1"] {
      color: currentColor !important;
      background-image: linear-gradient(
        90deg,
        var(--ao3sn-pov-c1, currentColor),
        var(--ao3sn-pov-c2, currentColor)
      );
      -webkit-background-clip: text;
      background-clip: text;
    }

    /* Inline wrapper for dot-left layout */
    .ao3sn-wrap {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25em;
    }
    .${CLS.infoDot} {
      margin-left: 0;
      margin-right: 0.15em;
    }

    /* Featured top card for POV character */
    .ao3sn-featured {
      border: 1px solid #ffd9b3;
      background: linear-gradient(180deg, #fffaf5, #fff);
      box-shadow: 0 6px 22px rgba(229,46,113,0.12);
    }
    .ao3sn-featured .${CLS.compactName} {
      font-size: 15px;
    }

    /* Draggable resizer handle */
    .${CLS.resizer} {
        width: 100%;
        height: 10px;
        cursor: ns-resize;
        background: #f0f0f0 url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="4"><circle cx="2" cy="2" r="1.5" fill="%23999"/><circle cx="8" cy="2" r="1.5" fill="%23999"/><circle cx="14" cy="2" r="1.5" fill="%23999"/><circle cx="20" cy="2" r="1.5" fill="%23999"/><circle cx="26" cy="2" r="1.5" fill="%23999"/></svg>') center no-repeat;
        border-top: 1px solid #ddd;
        flex-shrink: 0;
    }
  `);

    /** ---------------------------------------
     * Utilities
     * ------------------------------------- */

    /**
     * Computes a deterministic HSL color for a given name.
     * @param {string} name
     * @returns {string} hsl(H S% L%)
     */
    function nameToColor(name) {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        const hue = h % 360;
        const sat = 60 + (h % 20);
        const light = 45 + (h % 10);
        return `hsl(${hue}deg ${sat}% ${light}%)`;
    }

    /**
     * Creates a round avatar with initials for a given name.
     * @param {string} name
     * @param {string} color hsl(H S% L%)
     * @returns {string} data URL of PNG
     */
    function makeAvatarDataURL(name, color) {
        const initials = name.split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(64, 64, 57, 0, Math.PI * 2);
        ctx.stroke();
        const g = ctx.createRadialGradient(40, 40, 10, 64, 64, 64);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, hslWithAlpha(color, 0.18));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(64, 64, 54, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = 'bold 52px system-ui, Segoe UI, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, 64, 70);
        return canvas.toDataURL('image/png');
    }

    /**
     * Converts HSL to CSS Color 4 with alpha using slash syntax.
     * @param {string} hsl
     * @param {number} a 0..1
     * @returns {string}
     */
    function hslWithAlpha(hsl, a = 0.18) {
        const m = hsl.match(/hsl\(\s*([\d.]+)deg\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
        if (!m) return `rgba(0,0,0,${a})`;
        const [, h, s, l] = m;
        return `hsl(${h} ${s}% ${l}% / ${a})`;
    }

    /**
     * Computes a pair of visually compatible gradient colors from a base HSL color.
     * @param {string} colorHsl hsl(H S% L%)
     * @returns {{c1: string, c2: string}}
     */
    function povGradientFrom(colorHsl) {
        const m = colorHsl.match(/hsl\(\s*([\d.]+)deg\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
        if (!m) return { c1: "#ff8a00", c2: "#e52e71" };
        let h = (+m[1]) % 360, s = +m[2], l = +m[3];
        const c1 = `hsl(${(h + 10) % 360}deg ${Math.min(95, s + 20)}% ${Math.min(65, l + 10)}%)`;
        const c2 = `hsl(${(h + 300) % 360}deg ${Math.min(95, s + 10)}% ${Math.max(35, l - 5)}%)`;
        return { c1, c2 };
    }

    /**
     * Debounces a function by a fixed delay.
     * @template {any[]} A
     * @param {(...args: A)=>void} fn
     * @param {number} [ms]
     * @returns {(...args: A)=>void}
     */
    function debounce(fn, ms = 200) {
        let t = null;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    /** requestIdleCallback shim (basic). */
    const ric = window.requestIdleCallback || function (cb) {
        return setTimeout(() => cb({ timeRemaining: () => 16 }), 1);
    };

    /** ---------------------------------------
     * Persistence
     * ------------------------------------- */

    /**
     * @typedef {{
     * name: string,
     * aliases?: string[],
     * kind: 'major'|'minor',
     * role?: string,
     * personality?: string,
     * physical_description?: Record<string, string>,
     * sexual_characteristics?: Record<string, string>,
     * notable_actions?: string[],
     * }} CharacterData
     */

    /**
     * @typedef {{
     * characters: Record<string, {
     * color: string,
     * avatar: string,
     * mentions: number,
     * } & CharacterData>,
     * pronouns: Record<string,{color: string}>,
     * pinnedPanel: boolean,
     * panelHeight: number,
     * povName: string|null
     * }} Persist
     */

    /**
     * Loads persisted state and migrates older schemas. Avatars are not stored.
     * @returns {Persist}
     */
    function loadPersist() {
        const freshDefault = {
            characters: {},
            pronouns: {},
            pinnedPanel: false,
            panelHeight: Math.round(window.innerHeight * 0.6),
            povName: null
        };

        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return freshDefault;

            const parsed = JSON.parse(raw);

            // v1 -> v2 migration: `names` -> `characters`
            if (!parsed.characters && parsed.names && typeof parsed.names === 'object') {
                const migrated = { ...freshDefault, ...parsed, characters: {} };
                for (const [n, d] of Object.entries(parsed.names)) {
                    const color = d?.color || nameToColor(n);
                    migrated.characters[n] = {
                        color,
                        // intentionally drop avatar from storage
                        mentions: typeof d?.mentions === 'number' ? d.mentions : 0,
                        name: n,
                        kind: d?.kind === 'major' ? 'major' : 'minor'
                    };
                }
                delete migrated.names;
                return migrated;
            }

            // Ensure keys and drop any persisted avatars from older runs
            const out = {
                ...freshDefault,
                ...parsed,
                characters: parsed.characters || {},
                pronouns: parsed.pronouns || {},
            };
            for (const v of Object.values(out.characters)) {
                if (v && 'avatar' in v) delete v.avatar;
            }
            return out;
        } catch {
            return freshDefault;
        }
    }

    /**
     * Prunes large/low-value fields to fit within localStorage quota.
     * - Removes heavy fields.
     * - Drops low-mention entries first.
     * - Caps total stored characters.
     * @param {Persist} persist
     */
    function prunePersist(persist) {
        for (const v of Object.values(persist.characters)) {
            // Never store avatars; they live in memory only.
            if ('avatar' in v) delete v.avatar;
            // Trim very large/optional narrative fields.
            if ('personality' in v) delete v.personality;
            if ('sexual_characteristics' in v) delete v.sexual_characteristics;
            if ('notable_actions' in v) delete v.notable_actions;
        }

        // Drop very low-signal entries first (mentions < 2)
        let entries = Object.entries(persist.characters);
        const byMentionsAsc = (a, b) => (a[1].mentions || 0) - (b[1].mentions || 0);

        // Phase 1: remove any with mentions < 2 until we are under cap
        entries.sort(byMentionsAsc);
        const keepPhase1 = entries.filter(([_, d]) => (d.mentions || 0) >= 2);

        // If still too many, keep the top-most by mentions
        let keep = keepPhase1;
        if (keep.length > MAX_STORED_CHARACTERS) {
            keep.sort((a, b) => (b[1].mentions || 0) - (a[1].mentions || 0));
            keep = keep.slice(0, MAX_STORED_CHARACTERS);
        }

        persist.characters = Object.fromEntries(keep);
    }

    /**
     * Writes persist safely; prunes on QuotaExceededError.
     * Falls back to disabling persistence for this work if it still fails.
     * @param {Persist} persist
     */
    function savePersistSafe(persist) {
        if (window.__AO3SN_PERSIST_DISABLED__) return;
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(persist));
        } catch (e) {
            if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                try {
                    prunePersist(persist);
                    localStorage.setItem(LS_KEY, JSON.stringify(persist));
                } catch (e2) {
                    console.warn('[AO3SN] Persist disabled: quota still exceeded after pruning.', e2);
                    window.__AO3SN_PERSIST_DISABLED__ = true;
                }
            } else {
                throw e;
            }
        }
    }

    /** Debounced saver to avoid frequent writes during scanning. */
    const scheduleSave = ((persist) => {
        const fn = debounce(() => savePersistSafe(persist), 500);
        return () => fn();
    })();

    /**
     * Saves persisted state.
     * @param {Persist} data
     */
    function savePersist(data) {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    }

    /** Built-in mock response used when no backend is available. */
    const MOCK_BACKEND_RESPONSE = {
        characters: [
            {
                name: "James",
                aliases: ["Jim"],
                kind: "major",
                role: "Babysitter and manipulator",
                personality: "Confident, manipulative, playful, dominant.",
                physical_description: {
                    age: "18",
                    gender: "Male",
                    height: "Average (estimated 5'10\")",
                    build: "Athletic",
                    hair: "Not specified",
                    other: "Wears glasses, sometimes uses contacts, has braces."
                },
                sexual_characteristics: {
                    genitalia: "Penis with foreskin, pubic hair present",
                    penis_length_flaccid: "Not specified, estimated 3.5-4 inches",
                    penis_length_erect: "Not specified, implied above average (estimated 6-7 inches)",
                    pubic_hair: "Present",
                    other: "Able to maintain erections during various activities."
                },
                notable_actions: ["Takes charge of the household", "Engages in sexual activities with Joel and Jerry"]
            }
        ],
        timeline: [
            {
                date: "Monday, June 22, 2009",
                events: [
                    { time: "7:30am", description: "James wakes up fondling Joel and Jerry." },
                    { time: "8:00am", description: "James performs oral sex on Jerry." }
                ]
            }
        ]
    };

    /** Maximum number of character entries we keep in localStorage. */
    const MAX_STORED_CHARACTERS = 120;

    /** In-memory (non-persisted) avatar cache. */
    const AVATAR_CACHE = new Map();

    /**
     * Returns a dataURL avatar for name+color without storing it in localStorage.
     * @param {string} name
     * @param {string} color
     */
    function getAvatar(name, color) {
        const key = `${name}|${color}`;
        let url = AVATAR_CACHE.get(key);
        if (!url) {
            url = makeAvatarDataURL(name, color);
            AVATAR_CACHE.set(key, url);
        }
        return url;
    }

    /**
     * Fetches data from a backend service, falling back to mock data.
     * @param {string} text
     * @returns {Promise<any>}
     */
    async function fetchBackendCharacters(text) {
        const body = JSON.stringify({ text: text.slice(0, 200_000) });
        const nres = await fetch(NAMES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!nres.ok) throw new Error(`Names error: ${nres.status}`);
        const namesPayload = await nres.json();
        const characters = Array.isArray(namesPayload?.characters) ? namesPayload.characters : [];

        const sbody = JSON.stringify({ text: text.slice(0, 200_000), characters });
        const sres = await fetch(SUMMARIZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: sbody
        });
        if (!sres.ok) throw new Error(`Summarize error: ${sres.status}`);
        const sumPayload = await sres.json();
        return { characters: Array.isArray(sumPayload?.characters) ? sumPayload.characters : characters };
    }

    /** ---------------------------------------
     * DOM Helpers (Scanning & Wrapping)
     * ------------------------------------- */

    /**
     * Collects story text from configured containers, excluding known UI areas.
     * @returns {string}
     */
    function collectStoryText() {
        const nodes = [];
        for (const sel of STORY_SELECTORS) {
            document.querySelectorAll(sel).forEach(n => nodes.push(n));
        }
        const excluded = new Set();
        EXCLUDE_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(n => excluded.add(n));
        });
        const chunks = [];
        nodes.forEach(root => {
            if ([...excluded].some(ex => ex.contains(root) || root.contains(ex))) return;
            chunks.push(root.innerText);
        });
        return chunks.join('\n\n').trim();
    }

    /**
     * Iterates over eligible text nodes under a root, skipping already wrapped content.
     * @param {Element} root
     */
    function* textNodeWalker(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!isSafeTextNode(node)) return NodeFilter.FILTER_REJECT;
                const pe = node.parentElement;
                if (!pe) return NodeFilter.FILTER_REJECT;
                if (pe.closest(`.${CLS.name}, .${CLS.pronoun}`)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) yield n;
    }

    /**
     * Checks if a text node is safe to manipulate.
     * @param {Node} node
     * @returns {boolean}
     */
    function isSafeTextNode(node) {
        return !!(node && node.isConnected && node.parentNode && node.nodeValue && node.nodeValue.trim());
    }

    /**
     * Builds a regex that matches known names plus a capitalized word heuristic.
     * @param {Set<string>} nameSet
     * @returns {RegExp}
     */
    function buildNameRegex(nameSet) {
        const sorted = [...nameSet].sort((a, b) => b.length - a.length).map(escapeRegExp);
        const nameAlt = sorted.length ? `(?:${sorted.join('|')})` : null;
        const heuristic = `\\b[A-Z][a-z]{${Math.max(2, MAX_GROUP_NAME_LENGTH)}}[a-z]+\\b`;
        const body = nameAlt ? `${nameAlt}|${heuristic}` : heuristic;
        return new RegExp(body, 'g');
    }

    /**
     * Builds an exact-match regex from a set of known names (and aliases).
     * No heuristics; matches only what we explicitly know.
     * Uses word boundaries, supports multi-word names.
     * Returns `null` if the set is empty.
     * @param {Set<string>} nameSet
     * @returns {RegExp|null}
     */
    function buildNameRegexExact(nameSet) {
        const names = [...nameSet]
            .map(s => s && s.trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp);

        if (!names.length) return null;
        // Allow apostrophes or punctuation immediately following the name, ignore case
        return new RegExp(`\\b(?:${names.join('|')})(?:['’]s)?\\b`, 'gi');
    }

    /**
     * Escapes a string for use inside a RegExp pattern.
     * @param {string} s
     * @returns {string}
     */
    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Builds a case-insensitive pronoun regex with word boundaries.
     * @param {string[]} prons
     * @returns {RegExp}
     */
    function buildPronounRegex(prons) {
        const alt = prons.map(escapeRegExp).join('|');
        return new RegExp(`\\b(?:${alt})\\b`, 'gi');
    }

    /**
     * Replaces matches within a text node with wrapped elements produced by wrapFn.
     * @param {Text} node
     * @param {RegExp} matcher
     * @param {(match: string)=>Node} wrapFn
     * @returns {boolean} true if replacement occurred
     */
    function wrapMatchesInTextNode(node, matcher, wrapFn) {
        if (!isSafeTextNode(node) || node.parentElement.dataset.ao3snWrapped === '1') return false;
        const text = node.nodeValue;
        matcher.lastIndex = 0;
        let m, last = 0;
        const frag = document.createDocumentFragment();
        let changed = false;
        while ((m = matcher.exec(text))) {
            const before = text.slice(last, m.index);
            if (before) frag.appendChild(document.createTextNode(before));
            const match = m[0];
            const el = wrapFn(match);
            frag.appendChild(el);
            last = m.index + match.length;
            changed = true;
        }
        if (!changed) return false;
        const after = text.slice(last);
        if (after) frag.appendChild(document.createTextNode(after));
        if (!isSafeTextNode(node)) return false;
        try {
            node.parentNode.replaceChild(frag, node);
            node.parentElement.dataset.ao3snWrapped = '1';
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Ensures each character of an element is wrapped in a span for per-letter animation.
     * @param {HTMLElement} el
     */
    function ensureLetterSpans(el) {
        if (el.dataset.letterized === '1') return;
        el.dataset.letterized = '1';
        const text = el.textContent;
        el.textContent = '';
        for (const ch of text) {
            const s = document.createElement('span');
            s.className = CLS.letter;
            s.textContent = ch;
            el.appendChild(s);
        }
    }

    /**
     * Animates a name element with a brief letter pop when it enters the viewport.
     * @param {HTMLElement} el
     */
    function animateName(el) {
        if (el.dataset.animated === '1') return;
        el.dataset.animated = '1';
        ensureLetterSpans(el);
        const letters = el.querySelectorAll(`.${CLS.letter}`);
        anime({
            targets: letters,
            scale: [
                { value: 1.0, duration: 0 },
                { value: 1.15, duration: 120, delay: anime.stagger(12, { start: 0 }) },
                { value: 1.0, duration: 140 }
            ],
            translateY: [
                { value: -2, duration: 100, delay: anime.stagger(12) },
                { value: 0, duration: 140 }
            ],
            easing: 'easeOutQuad'
        });
    }

    /** ---------------------------------------
     * Tooltip / Info Cards
     * ------------------------------------- */

    /**
     * Creates the information dot element shown next to a name.
     * @param {string} color
     * @returns {HTMLSpanElement}
     */
    function makeInfoDot(color) {
        const dot = document.createElement('span');
        dot.className = CLS.infoDot;
        dot.style.color = color;
        dot.setAttribute('title', 'Character details');
        return dot;
    }

    /**
     * Shows a tooltip for a given dot element.
     * @param {HTMLElement} dot
     * @param {string} contentHTML
     */
    function showTooltip(dot, contentHTML) {
        let tip = dot._tip;
        if (!tip) {
            tip = document.createElement('div');
            tip.className = CLS.tooltip;
            document.body.appendChild(tip);
            dot._tip = tip;
        }
        tip.innerHTML = contentHTML;
        const rect = dot.getBoundingClientRect();
        tip.style.left = (rect.left + rect.width / 2) + 'px';
        tip.style.top = (window.scrollY + rect.top) + 'px';
        requestAnimationFrame(() => {
            tip.style.opacity = '1';
            tip.style.transform = 'translate(-50%, calc(-100% - 8px))';
        });
    }

    /**
     * Hides an active tooltip for a dot element.
     * @param {HTMLElement} dot
     */
    function hideTooltip(dot) {
        const tip = dot._tip;
        if (!tip) return;
        tip.style.opacity = '0';
        tip.style.transform = 'translate(-50%, calc(-100% - 2px))';
        setTimeout(() => {
            if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
            dot._tip = null;
        }, 160);
    }

    /** ---------------------------------------
     * POV Controls
     * ------------------------------------- */

    /**
     * Selects a candidate POV name based on the highest mentions, preferring majors when tied.
     * @param {Persist} persist
     * @returns {string|null}
     */
    function determinePOVName(persist) {
        let best = null, bestCount = -1;
        for (const [n, d] of Object.entries(persist.characters)) {
            if (d.mentions > bestCount) {
                best = n;
                bestCount = d.mentions;
            }
        }
        const majorsWithBest = Object.entries(persist.characters)
            .filter(([n, d]) => d.kind === 'major' && d.mentions === bestCount);
        if (majorsWithBest.length === 1) return majorsWithBest[0][0];
        return best;
    }

    /** ---------------------------------------
     * Side Panel UI
     * ------------------------------------- */

    /**
     * Builds the side panel that lists characters and provides controls.
     * @param {Persist} persist
     * @param {(name: string, kind?: 'major'|'minor')=>void} upsertName
     * @param {(name: string)=>void} removeName
     * @param {()=>void} togglePin
     * @returns {HTMLElement}
     */
    function buildPanel(persist, upsertName, removeName, togglePin) {
        const panel = document.createElement('aside');
        panel.className = CLS.panel + (persist.pinnedPanel ? ` ${CLS.panelPinned}` : '');
        panel.style.height = `${persist.panelHeight}px`;
        panel.setAttribute('aria-label', 'AO3 Character Panel');

        const header = document.createElement('div');
        header.className = CLS.panelHeader;

        const pin = document.createElement('button');
        pin.className = CLS.iconBtn;
        pin.textContent = persist.pinnedPanel ? '📌 Shelve' : '📌 Unshelve';
        pin.title = 'Click to pin/unpin the panel';
        pin.addEventListener('click', () => {
            togglePin();
            panel.classList.toggle(CLS.panelPinned);
            pin.textContent = panel.classList.contains(CLS.panelPinned) ? '📌 Shelve' : '📌 Unshelve';
        });

        const compact = document.createElement('button');
        compact.className = CLS.iconBtn;
        compact.textContent = '🗂️ Compact';
        compact.title = 'Toggle compact mode';
        compact.addEventListener('click', () => {
            panel.classList.toggle(CLS.panelCollapsed);
        });

        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.textContent = 'Characters';

        header.append(pin, compact, title);

        const manual = document.createElement('div');
        manual.className = CLS.manualBox;
        const input = document.createElement('input');
        input.placeholder = 'Add a character name…';
        const addBtn = document.createElement('button');
        addBtn.className = CLS.btn;
        addBtn.textContent = 'Add';
        addBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (!val) return;
            upsertName(val, 'major');
            input.value = '';
            renderLists();
            if (typeof refreshPOVOptions === 'function') refreshPOVOptions();
        });
        manual.append(input, addBtn);

        /* Controls: POV selector */
        const controls = document.createElement('div');
        controls.style.display = 'grid';
        controls.style.padding = '8px 10px';
        controls.style.background = '#fff';
        controls.style.borderBottom = '1px solid #eee';

        const povRow = document.createElement('div');
        povRow.style.display = 'grid';
        povRow.style.gridTemplateColumns = 'auto 1fr auto';
        povRow.style.gap = '6px';

        const povLabel = document.createElement('label');
        povLabel.textContent = 'POV:';

        const povSelect = document.createElement('select');

        function refreshPOVOptions() {
            const sel = povSelect.value;
            povSelect.innerHTML = '';
            const optNone = document.createElement('option');
            optNone.value = '';
            optNone.textContent = '(auto)';
            povSelect.appendChild(optNone);
            Object.keys(persist.characters).sort().forEach(n => {
                const o = document.createElement('option');
                o.value = n;
                o.textContent = n;
                if (persist.povName === n) o.selected = true;
                povSelect.appendChild(o);
            });
            if (!persist.povName && sel === '') povSelect.value = '';
        }

        refreshPOVOptions();

        const povBtn = document.createElement('button');
        povBtn.className = CLS.btn;
        povBtn.textContent = 'Set';
        povBtn.addEventListener('click', () => {
            const chosen = povSelect.value.trim();
            persist.povName = chosen || determinePOVName(persist);
            savePersist(persist);
            renderLists();
            document.querySelectorAll(`.${CLS.name}[data-main="1"]`).forEach(el => el.removeAttribute('data-main'));
            if (persist.povName && persist.characters[persist.povName]) {
                const base = persist.characters[persist.povName].color;
                const { c1, c2 } = povGradientFrom(base);
                document.documentElement.style.setProperty('--ao3sn-pov-c1', c1);
                document.documentElement.style.setProperty('--ao3sn-pov-c2', c2);
                document.querySelectorAll(`.${CLS.name}[data-name="${CSS.escape(persist.povName)}"]`)
                    .forEach(el => el.setAttribute('data-main', '1'));
            }
        });

        povRow.append(povLabel, povSelect, povBtn);
        controls.append(povRow);

        const list = document.createElement('div');
        list.className = CLS.list;

        const minorHeader = document.createElement('div');
        minorHeader.textContent = 'Minor Characters';
        minorHeader.style.fontSize = '12px';
        minorHeader.style.opacity = '0.8';

        const listMinor = document.createElement('div');
        listMinor.className = CLS.list + ' ' + CLS.listMinor;

        const resizer = document.createElement('div');
        resizer.className = CLS.resizer;

        panel.append(header, manual, controls, list, minorHeader, listMinor, resizer);
        document.body.appendChild(panel);

        // Add drag-to-resize logic
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = panel.offsetHeight;

            function onMouseMove(e) {
                const newHeight = startHeight + e.clientY - startY;
                panel.style.height = `${newHeight}px`;
            }

            function onMouseUp() {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                persist.panelHeight = panel.offsetHeight;
                savePersist(persist);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        /**
         * Rebuilds the major/minor lists in the panel, featuring POV at the top.
         */
        function renderLists() {
            list.innerHTML = '';
            listMinor.innerHTML = '';
            const major = [];
            const minor = [];
            for (const [name, data] of Object.entries(persist.characters)) {
                (data.kind === 'major' ? major : minor).push([name, data]);
            }

            /**
             * Builds a character card for the panel.
             * @param {string} name
             * @param {Persist['characters'][string]} data
             * @returns {HTMLDivElement}
             */
            const makeCard = (name, data) => {
                const card = document.createElement('div');
                card.className = CLS.card;
                if (persist.povName && persist.povName === name) {
                    card.classList.add('ao3sn-featured');
                }
                const img = document.createElement('img');
                img.className = CLS.avatar;
                img.alt = `${name} avatar`;
                img.src = getAvatar(name, data.color);
                const text = document.createElement('div');
                text.className = CLS.row;
                const nm = document.createElement('div');
                nm.className = CLS.compactName;
                nm.textContent = name;
                nm.style.color = data.color;
                const factsEl = document.createElement('div');
                factsEl.style.fontSize = '12px';
                factsEl.style.opacity = '0.8';

                const factItems = [];
                if (data.role) factItems.push(data.role);
                if (data.physical_description?.gender) factItems.push(data.physical_description.gender);
                if (data.physical_description?.age) factItems.push(`Age ${data.physical_description.age}`);

                factsEl.textContent = factItems.join(' • ') || '—';
                text.append(nm, factsEl);

                const rm = document.createElement('button');
                rm.className = CLS.iconBtn;
                rm.textContent = '✖';
                rm.title = 'Remove';
                rm.addEventListener('click', () => {
                    removeName(name);
                    renderLists();
                    if (typeof refreshPOVOptions === 'function') refreshPOVOptions();
                });
                card.append(img, text, rm);
                return card;
            };

            if (persist.povName && persist.characters[persist.povName] && persist.characters[persist.povName].kind === 'major') {
                const pov = persist.povName;
                list.appendChild(makeCard(pov, persist.characters[pov]));
                for (let i = major.length - 1; i >= 0; i--) {
                    if (major[i][0] === pov) major.splice(i, 1);
                }
            }
            major.forEach(([n, d]) => list.appendChild(makeCard(n, d)));
            minor.forEach(([n, d]) => listMinor.appendChild(makeCard(n, d)));
            if (typeof refreshPOVOptions === 'function') refreshPOVOptions();
        }

        renderLists();
        return panel;
    }

    /** ---------------------------------------
     * Main Orchestration
     * ------------------------------------- */

    const throbber = document.createElement('div');
    throbber.className = CLS.throbber;
    throbber.textContent = 'Analyzing story';
    document.body.appendChild(throbber);

    /**
     * Shows or hides a small progress indicator.
     * @param {boolean} on
     */
    function setThrobber(on) {
        throbber.style.display = on ? 'block' : 'none';
    }

    (async function init() {
        setThrobber(true);

        const persist = loadPersist();
        savePersistSafe(persist);

        // Ensure container keys exist (defense-in-depth)
        persist.characters = persist.characters || {};
        persist.pronouns = persist.pronouns || {};

        let backend;
        try {
            const fullText = collectStoryText();
            backend = await fetchBackendCharacters(fullText);
        } catch (err) {
            console.warn('[AO3SN] Backend unreachable, using mock:', err);
            backend = MOCK_BACKEND_RESPONSE;
        }

        // Process backend data to populate internal persist structure
        for (const ch of backend.characters || []) {
            const name = (ch.name || '').trim();
            if (!name) continue;

            const allNames = [name, ...(ch.aliases || [])];

            const prev = persist.characters[name];
            const color = (prev && prev.color) || nameToColor(name);
            const avatar = (prev && prev.avatar) || makeAvatarDataURL(name, color);

            for (const currentName of allNames) {
                const existing = persist.characters[currentName];
                if (!existing) {
                    persist.characters[currentName] = {
                        color,
                        avatar,
                        mentions: 0,
                        name: ch.name,
                        kind: ch.kind || 'minor',
                        role: ch.role,
                        personality: ch.personality,
                        physical_description: ch.physical_description,
                        sexual_characteristics: ch.sexual_characteristics,
                        notable_actions: ch.notable_actions
                    };
                } else {
                    Object.assign(existing, {
                        kind: ch.kind || existing.kind,
                        role: ch.role || existing.role,
                        personality: ch.personality || existing.personality,
                        physical_description: { ...(existing.physical_description || {}), ...(ch.physical_description || {}) },
                        sexual_characteristics: { ...(existing.sexual_characteristics || {}), ...(ch.sexual_characteristics || {}) },
                        notable_actions: ch.notable_actions || existing.notable_actions
                    });
                }
            }
        }

        // Pronoun setup
        for (const p of ['he', 'she', 'they']) {
            const k = p.toLowerCase();
            if (!persist.pronouns[k]) persist.pronouns[k] = { color: nameToColor(k) };
        }

        savePersist(persist);

        // Build explicit name list strictly from backend + any user-added entries.
        const explicitNames = new Set(Object.keys(persist.characters));

        // Include aliases from stored character records (if any were merged from backend)
        for (const [n, d] of Object.entries(persist.characters)) {
            if (Array.isArray(d.aliases)) {
                d.aliases.forEach(a => a && explicitNames.add(a));
            }
        }

        // Build regex; if none, skip name pass gracefully.
        const nameRegex = buildNameRegexExact(explicitNames);
        const pronounRegex = buildPronounRegex(Object.keys(persist.pronouns));

        /**
         * Inserts or updates a character record and persists it.
         * @param {string} name
         * @param {'major'|'minor'} [kind]
         */
        function upsertName(name, kind = 'major') {
            const trimmed = name.trim();
            if (!trimmed) return;
            if (!persist.characters[trimmed]) {
                const color = nameToColor(trimmed);
                persist.characters[trimmed] = {
                    color,
                    kind,
                    name: trimmed,
                    mentions: 0
                };
            } else {
                persist.characters[trimmed].kind = kind;
            }
            scheduleSave(persist); // debounced, not immediate
        }

        /**
         * Removes a character from persistence.
         * @param {string} name
         */
        function removeName(name) {
            delete persist.characters[name];
            savePersist(persist);
        }

        /**
         * Toggles the pinned/expanded state of the side panel.
         */
        function togglePin() {
            persist.pinnedPanel = !persist.pinnedPanel;
            savePersist(persist);
        }

        const panel = buildPanel(persist, upsertName, removeName, togglePin);

        const targets = [];
        for (const sel of STORY_SELECTORS) {
            document.querySelectorAll(sel).forEach(n => targets.push(n));
        }

        const wrapQueue = [];
        targets.forEach(root => {
            for (const tn of textNodeWalker(root)) wrapQueue.push(tn);
        });

        /**
         * Creates a wrapped element for a detected character name.
         * @param {string} txt
         * @returns {Node}
         */
        function makeNameSpan(txt) {
            const norm = txt;
            const charData = persist.characters[norm];
            if (!charData) return document.createTextNode(norm);

            charData.mentions++;

            const span = document.createElement('span');
            span.className = `${CLS.name} ${CLS.shine}`;
            span.dataset.name = norm;
            span.style.color = charData.color;
            span.textContent = norm;

            const dot = makeInfoDot(charData.color);
            dot.addEventListener('mouseenter', () => {
                const d = persist.characters[norm] || {};
                const factItems = [];
                if (d.role) factItems.push(`<b>Role:</b> ${d.role}`);
                if (d.personality) factItems.push(`<b>Personality:</b> ${d.personality}`);

                const pd = d.physical_description || {};
                const pd_items = Object.entries(pd).map(([k, v]) => v ? `• ${k.replace(/_/g, ' ')}: ${v}` : null).filter(Boolean);
                if (pd_items.length) factItems.push(`<b>Physical:</b><br>${pd_items.join('<br>')}`);

                const sc = d.sexual_characteristics || {};
                const sc_items = Object.entries(sc).map(([k, v]) => v ? `• ${k.replace(/_/g, ' ')}: ${v}` : null).filter(Boolean);
                if (sc_items.length) factItems.push(`<b>Sexual:</b><br>${sc_items.join('<br>')}`);

                const html = `
                <div style="font-weight:700;margin-bottom:4px;color:${charData.color}">${norm}</div>
                <div style="opacity:0.85; display: grid; gap: 4px;">${factItems.join('<br>')}</div>
            `;
                showTooltip(dot, html || 'No details yet.');
            });
            dot.addEventListener('mouseleave', () => hideTooltip(dot));

            const wrapper = document.createElement('span');
            wrapper.className = 'ao3sn-wrap';
            wrapper.appendChild(dot);
            wrapper.appendChild(span);

            span.setAttribute('data-kind', charData.kind || 'minor');
            if (persist.povName && persist.povName === norm) {
                span.setAttribute('data-main', '1');
            }

            return wrapper;
        }

        /**
         * Creates a wrapped element for a pronoun token.
         * @param {string} txt
         * @returns {HTMLElement}
         */
        function makePronounSpan(txt) {
            const k = txt.toLowerCase();
            const color = (persist.pronouns[k] && persist.pronouns[k].color) || nameToColor(k);
            const span = document.createElement('span');
            span.className = CLS.pronoun;
            span.style.color = color;
            span.textContent = txt;
            span.setAttribute('title', `Pronoun: ${txt}`);
            return span;
        }

        /**
         * Processes queued text nodes in separate passes for names and pronouns.
         */
        async function processBatch() {
            const BATCH = 50;

            // --- Pass 1: wrap names ---
            while (wrapQueue.length) {
                for (let i = 0; i < BATCH && wrapQueue.length; i++) {
                    const tn = wrapQueue.shift();
                    if (!isSafeTextNode(tn)) continue;
                    if (nameRegex) wrapMatchesInTextNode(tn, nameRegex, makeNameSpan);
                }
                await new Promise(res => ric(res));
            }

            // --- Pass 2: wrap pronouns (after names done) ---
            const pronounNodes = [];
            for (const sel of STORY_SELECTORS) {
                document.querySelectorAll(sel).forEach(root => {
                    for (const tn of textNodeWalker(root)) pronounNodes.push(tn);
                });
            }
            for (const tn of pronounNodes) {
                if (!isSafeTextNode(tn)) continue;
                wrapMatchesInTextNode(tn, pronounRegex, makePronounSpan);
            }
        }

        await processBatch();

        // Classify characters by mention count
        for (const [name, data] of Object.entries(persist.characters)) {
            if (data.mentions >= MIN_MAJOR_MENTIONS) data.kind = 'major';
            else if (data.mentions < MIN_MAJOR_MENTIONS && data.mentions >= MIN_MINOR_MENTIONS) data.kind = 'minor';
        }

        // Determine POV and apply gradient safely
        if (!persist.povName) {
            persist.povName = determinePOVName(persist);
        }
        if (persist.povName && persist.characters[persist.povName]) {
            const base = persist.characters[persist.povName].color;
            const { c1, c2 } = povGradientFrom(base);

            // Set CSS variables BEFORE marking elements as data-main
            document.documentElement.style.setProperty('--ao3sn-pov-c1', c1);
            document.documentElement.style.setProperty('--ao3sn-pov-c2', c2);

            document.querySelectorAll(`.${CLS.name}[data-name="${CSS.escape(persist.povName)}"]`)
                .forEach(el => el.setAttribute('data-main', '1'));
        }

        savePersist(persist);
        panel.dispatchEvent(new Event('mouseenter'));
        setTimeout(() => panel.dispatchEvent(new Event('mouseleave')), 100);

        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                const el = e.target;
                if (e.isIntersecting) {
                    el.classList.add(CLS.inview);
                    animateName(el);
                }
            }
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

        document.querySelectorAll(`.${CLS.name}`).forEach(span => {
            const el = span.matches(`.${CLS.name}`) ? span : span.querySelector(`.${CLS.name}`);
            if (el) io.observe(el);
        });

        document.querySelectorAll(`.${CLS.name}[data-name]`).forEach(el => {
            const nm = el.getAttribute('data-name');
            const d = persist.characters[nm];
            if (d && !el.getAttribute('data-kind')) el.setAttribute('data-kind', d.kind || 'minor');
        });

        setThrobber(false);

        // Observe new content for dynamic chapters or user loads
        const mo = new MutationObserver(debounce(() => {
            // Placeholder for dynamic re-processing if needed
        }, 500));
        mo.observe(document.body, { childList: true, subtree: true });

    })().catch(err => {
        console.error('[AO3SN] init error', err);
        const e = document.createElement('div');
        e.style.cssText = 'position:fixed; bottom:20px; right:20px; background:crimson; color:#fff; padding:8px 12px; border-radius:8px; z-index:9999;';
        e.textContent = 'AO3 Smart Names: failed to load';
        document.body.appendChild(e);
        setTimeout(() => e.remove(), 5000);
    }).finally(() => {
        if (window.__AO3SN_PERSIST_DISABLED__ && !window.__AO3SN_TOLD__) {
            window.__AO3SN_TOLD__ = true;
            const e = document.createElement('div');
            e.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#222;color:#fff;padding:8px 12px;border-radius:8px;z-index:9999;';
            e.textContent = 'AO3 Smart Names: localStorage full; persistence temporarily disabled.';
            document.body.appendChild(e);
            setTimeout(() => e.remove(), 5000);
        }
    });
})();