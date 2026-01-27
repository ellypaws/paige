// ==UserScript==
// @name         AO3/Inkbunny Smart Name Highlighter + Pronoun Colorizer (SSE, Timeline, Aliases)
// @namespace    ao3-inkbunny-smart-names
// @version      1.9.0
// @description  Highlight names & pronouns on AO3 and Inkbunny. Streams /api/summarize (SSE), updates on EVERY event, canonical alias merging, side panel + timeline, and tooltip truncation of notable actions only.
// @author       you
// @match        https://archiveofourown.org/works/*
// @match        https://archiveofourown.org/chapters/*
// @match        https://inkbunny.net/s/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @run-at       document-idle
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js
// ==/UserScript==

(() => {
    'use strict';

    /** ---------------------------------------
     * Constants & Config
     * ------------------------------------- */

    /** Backend endpoints */
    const SUMMARIZE_URL = 'http://localhost:8080/api/summarize';
    const EDIT_URL = 'http://localhost:8080/api/edit';
    const PORTRAIT_URL = 'http://localhost:8080/api/portrait';

    /** Pronouns to colorize (case-insensitive word matches). */
    const PRONOUNS = ['he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'they', 'them', 'their', 'theirs', 'themself', 'themselves', 'xe', 'xem', 'xyr', 'xyrs', 'xemself', 'ze', 'zir', 'zirs', 'zirself', 'fae', 'faer', 'faers', 'faerself', 'it', 'its', 'itself'];

    const DEFAULT_EDIT_RULES = `Keep POV, tense, and narrative voice unless I explicitly ask for a change.
    Preserve canonical names, relationship dynamics, and plot beats unless overwritten.
    Stay within 25% of the original length and keep the same paragraph count when practical.
    Remove decorative heat markers like 🔥 as this is not part of the story.
    Return only the rewritten prose—no commentary, markdown, or explanations.`;

    /** Mentions heuristics for major/minor classification. */
    const MIN_MAJOR_MENTIONS = 6;
    const MIN_MINOR_MENTIONS = 2;

    /** Work-scoped key (per-site). Chapter-specific on AO3 unless viewing full work. */
    const getWorkId = () => {
        if (location.hostname.includes('archiveofourown.org')) {
            const isFullWork = new URLSearchParams(window.location.search).get("view_full_work") === "true";
            const workMatch = location.pathname.match(/\/works\/(\d+)/);
            const workId = workMatch ? workMatch[1] : null;
            if (!workId) return location.pathname; // Fallback

            if (isFullWork) return `work:${workId}`;

            const chapterMatch = location.pathname.match(/\/chapters\/(\d+)/);
            return chapterMatch ? `work:${workId}:chapter:${chapterMatch[1]}` : `work:${workId}`;
        }
        return (location.pathname + location.search) || location.pathname;
    };
    const WORK_ID = getWorkId() || location.href;
    const LS_KEY = `ao3-smart-names:v1:${location.hostname}:${WORK_ID}`;

    /** CSS class names used by the script. */
    const FIRE_EMOJI_RX = /\u{1F525}/gu;

    function stripHeatEmojis(text) {
        if (typeof text !== 'string' || text === '') return text || '';
        FIRE_EMOJI_RX.lastIndex = 0;
        return text.replace(FIRE_EMOJI_RX, '');
    }

    function sanitizeTextareaValue(el, sanitizer = stripHeatEmojis) {
        if (!el || typeof el.value !== 'string') return '';
        const raw = el.value;
        const cleaned = sanitizer(raw);
        if (raw === cleaned) return cleaned;
        const start = Number.isInteger(el.selectionStart) ? el.selectionStart : raw.length;
        const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : raw.length;
        const cleanStart = sanitizer(raw.slice(0, start)).length;
        const cleanEnd = sanitizer(raw.slice(0, end)).length;
        el.value = cleaned;
        if (typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(cleanStart, cleanEnd);
        }
        return cleaned;
    }

    const CLS = {
        name: 'ao3sn-name',
        pronoun: 'ao3sn-pronoun',
        shine: 'ao3sn-shine',
        inview: 'ao3sn-inview',
        letter: 'ao3sn-letter',
        infoDot: 'ao3sn-info-dot',
        tooltip: 'ao3sn-tooltip',
        panel: 'ao3sn-panel',
        panelPinned: 'ao3sn-panel-pinned',
        panelCollapsed: 'ao3sn-panel-collapsed',
        panelFullscreen: 'ao3sn-panel-fullscreen',
        panelHeader: 'ao3sn-panel-header',
        throbber: 'ao3sn-throbber',
        btn: 'ao3sn-btn',
        iconBtn: 'ao3sn-icon-btn',
        manualBox: 'ao3sn-manual',
        resizer: 'ao3sn-resizer',
        tabs: 'ao3sn-tabs',
        tab: 'ao3sn-tab',
        tabActive: 'ao3sn-tab-active',
        section: 'ao3sn-section',
        editBox: 'ao3sn-edit-box',
        editTextarea: 'ao3sn-edit-textarea',
        editHistory: 'ao3sn-edit-history',
        editHistoryItem: 'ao3sn-edit-history-item',
        editHistoryMeta: 'ao3sn-edit-history-meta',
        editResult: 'ao3sn-edit-result',
        editControls: 'ao3sn-edit-controls',
        editFab: 'ao3sn-edit-fab',
        editBadge: 'ao3sn-edit-badge',
        editEmpty: 'ao3sn-edit-empty',
        editToolbar: 'ao3sn-edit-toolbar',
        editHistoryWrap: 'ao3sn-edit-history-wrap',
        editHistoryActions: 'ao3sn-edit-history-actions',
        list: 'ao3sn-list',
        listMinor: 'ao3sn-list-minor',
        card: 'ao3sn-card',
        avatar: 'ao3sn-avatar',
        avatarImg: 'ao3sn-avatar-img',
        avatarLoading: 'ao3sn-avatar-loading',
        row: 'ao3sn-row',
        compactName: 'ao3sn-compact-name',
        details: 'ao3sn-details',
        chip: 'ao3sn-chip',
        field: 'ao3sn-field',
        grid2: 'ao3sn-grid2',
        tlDay: 'ao3sn-tl-day',
        tlEvent: 'ao3sn-tl-event',
        tlTime: 'ao3sn-tl-time',
        tlDesc: 'ao3sn-tl-desc',
        tlChars: 'ao3sn-tl-chars',
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
    .${CLS.name}:hover, .${CLS.pronoun}:hover { filter: brightness(1.15); }

    .${CLS.shine} {
      background-image: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%);
      background-size: 200% 100%;
      background-position: -120% 0%;
      -webkit-background-clip: text; background-clip: text;
      color: currentColor;
    }
    .${CLS.inview}.${CLS.shine} { animation: ao3sn-shine 1.1s ease forwards; }
    @keyframes ao3sn-shine { 0% { background-position: -120% 0%; } 100% { background-position: 120% 0%; } }

    .${CLS.letter} { display: inline-block; will-change: transform, filter; }

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
      background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), transparent);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.35);
    }
    .${CLS.infoDot}:hover { filter: brightness(1.25); }

    .${CLS.tooltip} {
      position: absolute;
      z-index: 9999;
      background: linear-gradient(135deg, rgba(10,10,20,0.9), rgba(40,40,80,0.85));
      color: #fff;
      padding: 8px 10px;
      border-radius: 10px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.6);
      font-size: 0.9em;
      line-height: 1.35em;
      max-width: 320px;
      pointer-events: none;
      transform: translate(-50%, calc(-100% - 12px));
      border: 1px solid rgba(255,255,255,0.22);
      opacity: 0;
      transition: opacity 150ms ease, transform 150ms ease;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .${CLS.panel} {
      position: fixed;
      top: 10%;
      right: 0;
      transform: translateX(calc(100% - 48px));
      width: 360px;
      height: 60vh;
      min-height: 250px;
      max-height: 90vh;
      background: linear-gradient(135deg, rgba(18,18,28,0.85), rgba(40,40,70,0.75));
      border-left: 1px solid rgba(255,255,255,0.25);
      border-top: 1px solid rgba(255,255,255,0.16);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      border-top-left-radius: 12px;
      border-bottom-left-radius: 12px;
      box-shadow: -18px 22px 40px rgba(0,0,0,0.45);
      backdrop-filter: blur(16px) saturate(150%);
      -webkit-backdrop-filter: blur(16px) saturate(150%);
      transition: transform 200ms ease, width 200ms ease, background-color 200ms ease, box-shadow 200ms ease;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      color: #f5f5ff;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: none;
    }
    .${CLS.panel}:hover,
    .${CLS.panel}.${CLS.panelPinned} {
      transform: translateX(0);
    }
        .${CLS.panel}.${CLS.panelCollapsed} {
            width: 260px;
        }

        .${CLS.panel}.${CLS.panelFullscreen} {
            position: fixed;
            top: 0;
            right: 0;
            left: 0;
            width: 100vw !important;
            height: 100vh !important;
            max-height: none;
            border-radius: 0;
            transform: none;
            z-index: 9999;
        }

    .${CLS.panelHeader} {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
    }

    .${CLS.grid2} {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .${CLS.row} {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 12px;
    }

    .${CLS.field} {
      font-size: 11px;
      opacity: 0.9;
    }

    .${CLS.resizer} {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 12px;
      cursor: ns-resize;
      display: flex;
      justify-content: center;
      align-items: center;
      background: linear-gradient(180deg, transparent, rgba(0,0,0,0.18));
      border-top: 1px solid rgba(255,255,255,0.15);
    }
    .${CLS.resizer}::before {
      content: "";
      width: 40px;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0.12));
      box-shadow: 0 1px 2px rgba(0,0,0,0.35);
    }

    .ao3sn-resizer-side {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 6px;
      cursor: ew-resize;
      background: repeating-linear-gradient(
        90deg,
        rgba(255,255,255,0.12),
        rgba(255,255,255,0.12) 4px,
        rgba(255,255,255,0.02) 4px,
        rgba(255,255,255,0.02) 8px
      );
      border-right: 1px solid rgba(255,255,255,0.18);
    }

    /* Buttons / Pills / Badges */

    .${CLS.btn},
    .${CLS.iconBtn} {
      border: 1px solid rgba(255,255,255,0.3);
      background: linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04));
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      color: inherit;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .${CLS.btn}:hover,
    .${CLS.iconBtn}:hover {
      background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08));
    }
    .${CLS.iconBtn} {
      padding: 4px 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .${CLS.chip} {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.35);
      margin: 2px 4px 2px 0;
      background: linear-gradient(120deg, rgba(255,255,255,0.32), rgba(255,255,255,0.06));
      box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: #0b1020;
      white-space: nowrap;
    }

    .${CLS.compactName} {
      font-weight: 600;
      font-size: 13px;
      opacity: 0.95;
    }

        /* Tabs + manual box */

        .${CLS.tabs} {
            display: flex;
            flex-wrap: wrap;
            border-bottom: 1px solid rgba(255,255,255,0.12);
            background: linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
        }
    .${CLS.tab} {
      padding: 8px 10px;
      text-align: center;
      cursor: pointer;
      font-weight: 600;
      opacity: 0.7;
      flex: 1 1 140px;
      min-width: 120px;
      white-space: nowrap;
      border-radius: 25px 25px 0 0;
      transition: background 160ms ease, opacity 160ms ease;
    }
    .${CLS.tab}.${CLS.tabActive} {
      opacity: 1;
      background: rgba(255,255,255,0.14);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.18) inset;
    }

    .${CLS.manualBox} {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.12);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .${CLS.manualBox} input {
      padding: 6px 8px;
      border: 1px solid rgba(255,255,255,0.32);
      border-radius: 999px;
      font-size: 13px;
      background: rgba(0,0,0,0.25);
      color: #f5f5ff;
    }
    .${CLS.manualBox} input::placeholder {
      color: rgba(245,245,255,0.6);
    }

    .${CLS.editBox} {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.03);
    }
    .${CLS.editTextarea} {
        width: 100%;
        min-height: 70px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.25);
        background: rgba(0,0,0,0.3);
        color: #f5f5ff;
        padding: 8px;
        font-size: 13px;
        resize: vertical;
    }
    .${CLS.editTextarea}[readonly] {
        opacity: 0.85;
    }
    .${CLS.editControls} {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
    }
    .${CLS.editResult} {
        min-height: 90px;
        border-radius: 10px;
        border: 1px dashed rgba(255,255,255,0.2);
        padding: 10px;
        background: rgba(0,0,0,0.25);
        font-size: 13px;
        white-space: pre-wrap;
        line-height: 1.45;
    }
    .${CLS.editHistoryWrap} {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-top: 1px solid rgba(255,255,255,0.08);
    }
    .${CLS.editToolbar} {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.03);
    }
    .${CLS.editHistory} {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow: auto;
    }
    .${CLS.editHistoryItem} {
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.18);
        padding: 10px;
        background: linear-gradient(135deg, rgba(20,25,60,0.55), rgba(10,10,20,0.4));
        box-shadow: 0 12px 24px rgba(0,0,0,0.3);
    }
    .${CLS.editHistoryMeta} {
        font-size: 11px;
        opacity: 0.75;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
    }
    .${CLS.editHistoryActions} {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }
    .${CLS.editHistoryItem} pre {
        margin: 0;
        font-size: 12px;
        white-space: pre-wrap;
    }
    .${CLS.editBadge} {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.25);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }
    .${CLS.editEmpty} {
        font-size: 12px;
        opacity: 0.75;
        text-align: center;
        padding: 16px;
    }

    .${CLS.editFab} {
        position: absolute;
        z-index: 9999;
        display: none;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.45);
        background: linear-gradient(135deg, rgba(20,20,40,0.9), rgba(60,60,120,0.85));
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        box-shadow: 0 12px 30px rgba(0,0,0,0.45);
    }

    /* Main lists */

    .${CLS.section} {
      flex-grow: 1;
      overflow: auto;
      background: radial-gradient(circle at top left, rgba(255,255,255,0.06), transparent 55%);
    }

    .${CLS.list} {
      padding: 8px;
      display: grid;
      gap: 8px;
    }
    .${CLS.listMinor} {
      border-top: 1px dashed rgba(255,255,255,0.2);
      margin-top: 4px;
      padding-top: 6px;
    }

    .${CLS.card} {
      display: grid;
      grid-template-columns: 42px 1fr auto;
      gap: 10px;
      align-items: start;
      border: 1px solid rgba(255,255,255,0.28);
      background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05));
      border-radius: 14px;
      padding: 8px;
      box-shadow: 0 14px 35px rgba(0,0,0,0.45);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    .${CLS.avatar} {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,0.65);
      background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.6), rgba(80,90,160,0.4));
      overflow: hidden;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
      position: relative;
    }

    .${CLS.avatarImg} {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .${CLS.avatar}.${CLS.avatarLoading} .${CLS.avatarImg} {
      opacity: 0.7;
      filter: blur(0.2px) saturate(0.85);
    }

    .${CLS.avatar}.${CLS.avatarLoading}::after {
      content: "";
      position: absolute;
      inset: 6px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.35);
      border-top-color: rgba(255,255,255,0.95);
      animation: ao3sn-spin 0.9s linear infinite;
      pointer-events: none;
    }

    @keyframes ao3sn-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .${CLS.details} {
      grid-column: 1 / -1;
      margin-top: 6px;
      padding: 8px;
      border: 1px dashed rgba(255,255,255,0.24);
      border-radius: 10px;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: none;
    }

    /* Timeline */

    .${CLS.tlDay} {
      margin-top: 8px;
      margin-bottom: 4px;
      font-weight: 600;
      font-size: 13px;
      opacity: 0.95;
    }

    .${CLS.tlEvent} {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 8px;
      align-items: baseline;
      padding: 6px 8px;
      margin-bottom: 4px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04));
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .${CLS.tlTime} {
      font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      opacity: 0.8;
    }

    .${CLS.tlDesc} {
      font-size: 12px;
      opacity: 0.95;
    }

    .${CLS.tlChars} {
      margin-top: 2px;
      font-size: 11px;
      opacity: 0.8;
    }

    /* Throbber */

    .${CLS.throbber} {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: linear-gradient(135deg, rgba(10,10,20,0.9), rgba(80,80,160,0.8));
      color: #fff;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      box-shadow: 0 16px 38px rgba(0,0,0,0.65);
      display: none;
      border: 1px solid rgba(255,255,255,0.32);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    /* AO3 / text markers */

    .ao3sn-featured { border: 1px solid #ffd9b3; background: linear-gradient(180deg, #fffaf5, #fff); box-shadow: 0 6px 22px rgba(229,46,113,0.12); }
/* paragraph heat wrappers */
.ao3sn-para {
  position: relative;
  padding-left: 0.6em;
  margin-left: 1.25em;
  --ao3sn-heat: 0; /* 0..1 maps to transparency of the red bar */
}
.ao3sn-para::before {
  content: "";
  position: absolute;
  left: -0.35em;
  top: 0; bottom: 0;
  width: 6px;
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255,0,0,var(--ao3sn-heat)) 0%, rgba(255,0,0,0) 100%);
}
.ao3sn-heat {
  position: absolute;
  left: -1.6em;
  top: 0;
  font-size: 0.95em;
  line-height: 1;
  user-select: none;
}
  `);

    /** ---------------------------------------
     * Site Adapters
     * ------------------------------------- */

    /**
     * @typedef {{
     *   id: 'ao3'|'inkbunny',
     *   source: 'ao3'|'inkbunny',
     *   match: ()=>boolean,
     *   isFullWork: ()=>boolean,
     *   parseWorkAndChapterID: ()=>{id:string, chapter:string},
     *   collectChapters: ()=>{article:Element, chapterId:string, text:string}[],
     *   collectSingleText: ()=>string,
     *   findWrapTargets: ()=>Element[],
     *   name: string
     * }} SiteAdapter
     */

    /** AO3 adapter */
    const AO3Adapter = /** @type {SiteAdapter} */({
        id: 'ao3',
        source: 'ao3',
        name: 'Archive of Our Own',
        match: () => location.hostname.includes('archiveofourown.org'),
        isFullWork: () => new URLSearchParams(window.location.search).get("view_full_work") === "true",
        parseWorkAndChapterID() {
            const m = location.pathname.match(/\/works\/(\d+)(?:\/chapters\/(\d+))?/);
            return { id: m?.[1] || "", chapter: m?.[2] || "" };
        },
        collectChapters() {
            const out = [];
            document.querySelectorAll("div.chapter").forEach(ch => {
                const article = ch.querySelector('div.userstuff.module[role="article"]') || ch.querySelector('[role="article"].userstuff') || ch.querySelector('.userstuff');
                if (!article) return;

                // Prefer the chapter ID from the title link, as it's the canonical ID.
                // The element ID (`chapter-2`) is just the chapter number.
                let chapterId = '';
                const link = ch.querySelector('h3.title a[href*="/chapters/"]');
                const lm = link && link.getAttribute('href').match(/\/chapters\/(\d+)/);
                if (lm) chapterId = lm[1];

                const idMatch = (ch.id || '').match(/^chapter-(\d+)/);
                if (!chapterId && idMatch) chapterId = idMatch[1];

                const clone = article.cloneNode(true);
                const stray = clone.querySelector("h3#work.landmark.heading");
                if (stray) stray.remove();
                const text = (clone.innerText || '').trim();
                if (!text) return;

                out.push({ article, chapterId, text });
            });
            return out;
        },
        collectSingleText() {
            const selectors = ['#workskin .userstuff', '#workskin .preface .notes'];
            const exclude = ['#feedback', '#comments', 'nav', 'header', 'footer', '.splash', '.index', '.bookmark', '.tags'];
            const nodes = [];
            selectors.forEach(sel => document.querySelectorAll(sel).forEach(n => nodes.push(n)));
            const excluded = new Set();
            exclude.forEach(sel => document.querySelectorAll(sel).forEach(n => excluded.add(n)));
            const chunks = [];
            nodes.forEach(root => {
                if ([...excluded].some(ex => ex.contains(root) || root.contains(ex))) return;
                chunks.push(root.innerText);
            });
            return chunks.join('\n\n').trim();
        },
        findWrapTargets() {
            const selectors = ['#workskin .userstuff', '#workskin .preface .notes'];
            const exclude = ['#feedback', '#comments', 'nav', 'header', 'footer', '.splash', '.index', '.bookmark', '.tags'];
            const nodes = [];
            selectors.forEach(sel => document.querySelectorAll(sel).forEach(n => nodes.push(n)));
            const excluded = new Set();
            exclude.forEach(sel => document.querySelectorAll(sel).forEach(n => excluded.add(n)));
            return nodes.filter(root => ![...excluded].some(ex => ex.contains(root) || root.contains(ex)));
        }
    });

    /** Inkbunny adapter */
    const InkbunnyAdapter = /** @type {SiteAdapter} */({
        id: 'inkbunny',
        source: 'inkbunny',
        name: 'Inkbunny', // Only match InkBunny when the page actually contains the expected story container
        match: () => location.hostname.includes('inkbunny.net') && (!!document.querySelector('#storysectionbar') || !!document.querySelector('#storysectionfoo')),
        isFullWork: () => false, // stories are single text blocks on a page
        parseWorkAndChapterID() {
            // Strictly extract InkBunny submission ID from /s/2869684
            const m = location.pathname.match(/\/s\/(\d+)/);
            return { id: m ? m[1] : (location.pathname + location.search) || location.pathname, chapter: '' };
        },
        collectChapters() {
            return [];
        },
        collectSingleText() {
            // Typical story container: #storysectionbar (inner content) or #storysectionfoo (scroll container).
            const el = document.querySelector('#storysectionbar') || document.querySelector('#storysectionfoo') || document.querySelector('#content') || document.body;
            const clone = el.cloneNode(true);
            const text = (clone.innerText || '').replace(/\u00a0/g, ' ').trim(); // normalize &nbsp;
            return text;
        },
        findWrapTargets() {
            const targets = [];
            const primary = document.querySelector('#storysectionbar') || document.querySelector('#storysectionfoo');
            if (primary) targets.push(primary);
            // Fallback if Inkbunny theme differs
            const alt = document.querySelectorAll('#content .content, .pagestuff, #content');
            alt.forEach(n => {
                if (!targets.includes(n)) targets.push(n);
            });
            return targets.length ? targets : [document.body];
        }
    });

    /** Choose active adapter (or bail if neither site). */
    const ADAPTERS = [AO3Adapter, InkbunnyAdapter];
    const adapter = ADAPTERS.find(a => a.match());
    if (!adapter) return; // Not a supported site/page

    /** ---------------------------------------
     * Types (JSDoc)
     * ------------------------------------- */
    /**
     * @typedef {{
     *   height: string=,
     *   build: string=,
     *   fur: string=,
     *   hair: string=,
     *   other: string=
     * }} PhysicalDescription
     */

    /**
     * @typedef {{
     *   genitalia: string=,
     *   penis_length_flaccid: string=,
     *   penis_length_erect: string=,
     *   pubic_hair: string=,
     *   other: string=
     * }} SexualCharacteristics
     */

    /**
     * @typedef {{
     *   name: string,
     *   age: string=,
     *   gender: string=,
     *   aliases: string[]=,
     *   kind: 'main'|'major'|'minor'=,
     *   role: string=,
     *   species: string=,
     *   personality: string=,
     *   physical_description: PhysicalDescription=,
     *   sexual_characteristics: SexualCharacteristics=,
     *   notable_actions: string[]=,
     * }} CharacterData
     */

    /**
     * @typedef {{
     *   time: string,
     *   description: string,
     *   characters_involved: string[]
     * }} EventItem
     */

    /**
     * @typedef {{
     *   date: string,
     *   events: EventItem[]
     * }} TimelineDay
     */

    /**
     * @typedef {{
     *   id: string,
     *   chapter: string,
     *   prompt: string,
     *   rules: string,
     *   original: string,
     *   result: string,
     *   created_at: string,
     *   paragraph_keys?: string[]
     * }} EditHistoryEntry
     */

    /**
     * @typedef {{
     *   characters: Record<string, ({color:string, mentions:number} & CharacterData)>,
     *   pronouns: Record<string, {color:string}>,
     *   timeline: TimelineDay[],
     *   pinnedPanel: boolean,
     *   fullscreenPanel: boolean,
     *   panelHeight: number,
     *   panelWidth: number,
     *   povName: string|null,
     *   heat: Record<string, number>=
     *   edits?: {
     *     rules: string,
     *     lastPrompt: string,
     *     draftSelection: string,
     *     lastResult: string,
     *     historyByChapter: Record<string, EditHistoryEntry[]>
     *   }
     * }} Persist
     */

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

    function hslWithAlpha(hsl, a = 0.18) {
        const m = hsl.match(/hsl\(\s*([\d.]+)deg\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
        if (!m) return `rgba(0,0,0,${a})`;
        const [, h, s, l] = m;
        return `hsl(${h} ${s}% ${l}% / ${a})`;
    }

    function povGradientFrom(colorHsl) {
        const m = colorHsl.match(/hsl\(\s*([\d.]+)deg\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
        if (!m) return { c1: "#ff8a00", c2: "#e52e71" };
        let h = (+m[1]) % 360, s = +m[2], l = +m[3];
        const c1 = `hsl(${(h + 10) % 360}deg ${Math.min(95, s + 20)}% ${Math.min(65, l + 10)}%)`;
        const c2 = `hsl(${(h + 300) % 360}deg ${Math.min(95, s + 10)}% ${Math.max(35, l - 5)}%)`;
        return { c1, c2 };
    }

    /** Debounce utility. */
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

    /** Ensure a paragraph element is wrapped for heat styling and labeled with a section key. */
    function ensureParaWrapper(p, key) {
        const existing = p.closest('.ao3sn-para');
        if (existing) {
            existing.dataset.sectionKey = key; // Always set the key to ensure it's up-to-date
            return existing;
        }
        const wrap = document.createElement('div');
        wrap.className = 'ao3sn-para';
        wrap.dataset.sectionKey = key;
        wrap.title = `Paragraph #${key}`;

        const badge = document.createElement('span');
        badge.className = 'ao3sn-heat';
        badge.textContent = '';
        wrap.appendChild(badge);

        p.parentNode.insertBefore(wrap, p);
        wrap.appendChild(p);
        return wrap;
    }

    /** Map 0..3 into alpha + emojis, then paint a section container. */
    function setParagraphHeat(container, level) {
        const n = Math.max(0, Math.min(3, level));
        const alpha = n === 0 ? 0 : n <= 1 ? 0.25 : n <= 2 ? 0.55 : 0.85;
        container.style.setProperty('--ao3sn-heat', String(alpha));
        const badge = container.querySelector('.ao3sn-heat');
        if (badge) {
            const full = Math.floor(n);
            const half = n - full >= 0.5;
            let html = '🔥<br>'.repeat(full);
            if (half) html += '<span style="display:inline-block;height:0.5em;overflow:hidden;line-height:1em;">🔥</span><br>';
            badge.innerHTML = html;
        }
    }

    /** Extract numbered paragraphs from a given article/root node. Returns { map, dom }. */
    /**
     * Extracts numbered paragraphs from a given article/root node.
     * @param {Element} root The root element to search for paragraphs.
     * @param {string} [keyPrefix=''] An optional prefix for generated paragraph keys to ensure global uniqueness.
     * @returns {{map: Record<string, string>, dom: Record<string, Element>}} An object containing a map of paragraph keys to text content, and a map of paragraph keys to their DOM wrapper elements.
     */
    function collectParagraphsFromRoot(root, keyPrefix = '') {
        const map = {};
        const dom = {};
        let idx = 1;

        if (adapter.id === 'inkbunny' && root.querySelector('br')) {
            const content = root.innerHTML.split(/<br\s*\/?>\s*<br\s*\/?>/i);
            root.innerHTML = '';

            content.forEach(p_html => {
                const paraDiv = document.createElement('div');
                paraDiv.innerHTML = p_html.trim();
                paraDiv.style.marginBottom = '1em';
                const text = (paraDiv.textContent || '').trim();
                if (!text) return;

                const key = keyPrefix + String(idx++);
                map[key] = text;

                // Re-use the paragraph wrapper from AO3 logic
                const wrapper = document.createElement('div');
                wrapper.className = 'ao3sn-para';
                wrapper.dataset.sectionKey = key;
                const badge = document.createElement('span');
                badge.className = 'ao3sn-heat';
                badge.textContent = '';
                wrapper.appendChild(badge);
                wrapper.appendChild(paraDiv);

                root.appendChild(wrapper);
                dom[key] = wrapper;
            });
            return { map, dom };
        }

        const paras = root.querySelectorAll('p');
        if (paras.length) {
            paras.forEach(p => {
                const text = (p.innerText || '').trim();
                if (!text) return;
                const key = keyPrefix + String(idx++);
                map[key] = text;
                dom[key] = ensureParaWrapper(p, key);
            });
            return { map, dom };
        }

        // Fallback: split text by blank lines (DOM heat placement may be limited here)
        const raw = (root.innerText || '').trim();
        raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).forEach(s => {
            const key = keyPrefix + String(idx++);
            map[key] = s;
        });
        return { map, dom };
    }

    /** Merge all paragraphs from multiple targets (AO3 single-chapter case). */
    /**
     * Merges all paragraphs from multiple target elements into a single map and DOM mapping.
     * @param {Element[]} targets An array of target elements to collect paragraphs from.
     * @returns {{map: Record<string, string>, dom: Record<string, Element>}} An object containing a map of paragraph keys to text content, and a map of paragraph keys to their DOM wrapper elements.
     */
    function collectParagraphsFromTargets(targets) {
        const map = {};
        const dom = {};
        let idx = 1;
        for (const t of targets) {
            const { map: m, dom: d } = collectParagraphsFromRoot(t);
            for (const k of Object.keys(m)) {
                const nk = String(idx++);
                map[nk] = m[k];
                if (d[k]) {
                    d[k].dataset.sectionKey = nk; // Update the data-sectionKey on the DOM element
                    d[k].title = `Paragraph #${nk}`;
                    dom[nk] = d[k];
                }
            }
        }
        return { map, dom };
    }

    /** ---------------------------------------
     * Persistence
     * ------------------------------------- */

    /** Loads persisted state and migrates older schemas. Avatars are not stored. */
    function loadPersist() {
        const freshDefault = {
            characters: {},
            pronouns: {},
            timeline: [],
            pinnedPanel: false,
            fullscreenPanel: false,
            panelHeight: Math.round(window.innerHeight * 0.6),
            panelWidth: 360,
            povName: null,
            heat: {},
            edits: {
                rules: DEFAULT_EDIT_RULES,
                lastPrompt: '',
                draftSelection: '',
                lastResult: '',
                historyByChapter: {}
            }
        };
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return freshDefault;
            const parsed = JSON.parse(raw);
            const out = {
                ...freshDefault, ...parsed,
                characters: parsed.characters || {},
                pronouns: parsed.pronouns || {},
                timeline: parsed.timeline || [],
                heat: parsed.heat || {},
                pinnedPanel: typeof parsed.pinnedPanel === 'boolean' ? parsed.pinnedPanel : false,
                fullscreenPanel: typeof parsed.fullscreenPanel === 'boolean' ? parsed.fullscreenPanel : false,
                edits: {
                    rules: (parsed.edits && parsed.edits.rules) || DEFAULT_EDIT_RULES,
                    lastPrompt: (parsed.edits && parsed.edits.lastPrompt) || '',
                    draftSelection: (parsed.edits && parsed.edits.draftSelection) || '',
                    lastResult: (parsed.edits && parsed.edits.lastResult) || '',
                    historyByChapter: (parsed.edits && parsed.edits.historyByChapter) || {}
                }
            };
            for (const v of Object.values(out.characters)) {
                if (v && 'avatar' in v) delete v.avatar;
            }
            return out;
        } catch {
            return freshDefault;
        }
    }

    /** Prunes big fields if localStorage quota is exceeded. */
    function prunePersist(persist) {
        for (const v of Object.values(persist.characters)) {
            if ('avatar' in v) delete v.avatar;
            if ('personality' in v && (v.personality || '').length > 400) v.personality = (v.personality || '').slice(0, 400) + '…';
            if ('notable_actions' in v && Array.isArray(v.notable_actions) && v.notable_actions.length > 10) v.notable_actions = v.notable_actions.slice(0, 10);
            if ('sexual_characteristics' in v && v.sexual_characteristics) {
                const sc = v.sexual_characteristics;
                for (const k of Object.keys(sc)) {
                    if (String(sc[k] || '').length > 120) sc[k] = String(sc[k]).slice(0, 120) + '…';
                }
            }
        }
        if (persist.timeline && persist.timeline.length > 50) persist.timeline = persist.timeline.slice(-50);
        if (persist.heat && Object.keys(persist.heat).length > 2000) persist.heat = {};
        if (persist.edits && persist.edits.historyByChapter) {
            for (const key of Object.keys(persist.edits.historyByChapter)) {
                const list = persist.edits.historyByChapter[key] || [];
                if (list.length > 30) persist.edits.historyByChapter[key] = list.slice(0, 30);
            }
            if (persist.edits.lastResult && persist.edits.lastResult.length > 2000) {
                persist.edits.lastResult = persist.edits.lastResult.slice(0, 2000) + '…';
            }
        }
    }

    /** Writes persist safely; prunes on QuotaExceededError. */
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
                    console.warn('[Paige] Persist disabled: quota still exceeded after pruning.', e2);
                    window.__AO3SN_PERSIST_DISABLED__ = true;
                }
            } else {
                throw e;
            }
        }
    }

    /**
     * Saves persisted state immediately.
     * @param {Persist} data
     */
    function savePersist(data) {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    }

    /** Debounced saver to avoid frequent writes during scanning. */
    const scheduleSave = ((/* capture */) => {
        const fn = debounce(() => savePersistSafe(persist), 500);
        return () => fn();
    })();

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

    /** Creates a round avatar with initials for a given name. */
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

    /** Portrait generation state (in-memory only). */
    const PORTRAIT_STATE = new Map();
    const PORTRAIT_QUEUE = [];
    const PORTRAIT_REQUESTS = new Map();
    let portraitQueueRunning = false;

    function portraitKey(id, name) {
        return `${id}::${name}`;
    }

    function setPortraitState(key, next) {
        const prev = PORTRAIT_STATE.get(key);
        if (prev && prev.url && prev.url.startsWith('blob:') && prev.url !== next.url) {
            try {
                URL.revokeObjectURL(prev.url);
            } catch { /* ignore */ }
        }
        PORTRAIT_STATE.set(key, next);
    }

    function findCardsByName(name) {
        return Array.from(document.querySelectorAll(`.${CLS.card}[data-name]`)).filter(card => card.dataset.name === name);
    }

    function setAvatarLoading(name, on) {
        for (const card of findCardsByName(name)) {
            const avatar = card.querySelector(`.${CLS.avatar}`);
            if (avatar) avatar.classList.toggle(CLS.avatarLoading, on);
        }
    }

    function setAvatarSrc(name, src) {
        for (const card of findCardsByName(name)) {
            const img = card.querySelector(`.${CLS.avatarImg}`);
            if (img) img.src = src;
        }
    }

    async function requestPortrait({ id, name, force }) {
        const payload = { id, name, source: adapter.source };
        if (force) payload.force = true;
        const res = await fetch(PORTRAIT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            throw new Error(`Portrait error: ${res.status}`);
        }
        return res.blob();
    }

    async function generatePortrait({ id, name, force }) {
        const key = portraitKey(id, name);
        const state = PORTRAIT_STATE.get(key);
        if (!force && state && state.status === 'ready') return;
        if (!force && state && state.status === 'error') return;

        setPortraitState(key, { status: 'loading', url: state?.url || '' });
        setAvatarLoading(name, true);
        try {
            const blob = await requestPortrait({ id, name, force });
            const url = URL.createObjectURL(blob);
            setPortraitState(key, { status: 'ready', url });
            setAvatarSrc(name, url);
        } catch (err) {
            console.warn('[Paige] portrait generation failed', err);
            setPortraitState(key, { status: 'error', url: '' });
            const fallback = getAvatar(name, (persist.characters[name] && persist.characters[name].color) || nameToColor(name));
            setAvatarSrc(name, fallback);
        } finally {
            setAvatarLoading(name, false);
        }
    }

    function enqueuePortrait({ id, name, force }) {
        const key = portraitKey(id, name);
        const existing = PORTRAIT_REQUESTS.get(key);
        if (existing) {
            if (force) existing.force = true;
            return;
        }
        PORTRAIT_REQUESTS.set(key, { id, name, force: Boolean(force) });
        PORTRAIT_QUEUE.push(key);
        runPortraitQueue();
    }

    function runPortraitQueue() {
        if (portraitQueueRunning) return;
        portraitQueueRunning = true;
        (async () => {
            while (PORTRAIT_QUEUE.length) {
                const key = PORTRAIT_QUEUE.shift();
                const req = PORTRAIT_REQUESTS.get(key);
                PORTRAIT_REQUESTS.delete(key);
                if (!req) continue;
                await generatePortrait(req);
            }
            portraitQueueRunning = false;
        })().catch(err => {
            console.warn('[Paige] portrait queue failed', err);
            portraitQueueRunning = false;
        });
    }

    function queuePortraitsInOrder({ listRoot, listMinorRoot, force }) {
        if (!summaryReady) return;
        const id = currentWorkId || WORK_ID;
        if (!id) return;
        const ordered = [];
        [listRoot, listMinorRoot].forEach(root => {
            if (!root) return;
            root.querySelectorAll(`.${CLS.card}[data-name]`).forEach(card => {
                const name = card.dataset.name;
                if (name) ordered.push(name);
            });
        });
        ordered.forEach(name => enqueuePortrait({ id, name, force }));
    }

    /** ---------------------------------------
     * Backend (SSE) helpers
     * ------------------------------------- */

    /**
     * Consume a text/event-stream (SSE) Response body and emit parsed events.
     * Minimal parser assuming single-line `data:` JSON payload per event.
     * @param {ReadableStream<Uint8Array>} body
     * @param {(ev: {event: string, data: any})=>void} onEvent
     * @returns {Promise<void>}
     */
    async function readSSE(body, onEvent) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                if (!raw.trim()) continue;
                const ev = (raw.match(/^event:\s*(\w+)/m) || [])[1] || 'message';
                const dataLine = (raw.match(/^data:\s*(.*)$/ms) || [])[1] || '';
                let payload = null;
                try {
                    payload = dataLine ? JSON.parse(dataLine) : null;
                } catch {
                }
                onEvent({ event: ev, data: payload });
            }
        }
    }

    /**
     * Sends text (and optional seed characters) to /api/summarize, streaming SSE updates.
     * Calls `onUpdate` on EVERY SSE event (data & done).
     *
     * @param {(
     *   | { text: string, paragraphs?: Record<string, string>, id: string, chapter?: string, characters?: CharacterData[], timeline?: TimelineDay[], source: 'ao3'|'inkbunny', force?: boolean }
     *   | { text?: string, paragraphs: Record<string, string>, id: string, chapter?: string, characters?: CharacterData[], timeline?: TimelineDay[], source: 'ao3'|'inkbunny', force?: boolean }
     * )} req
     * @param {(partial: { characters?: CharacterData[], timeline?: TimelineDay[] }, event?: string) => void} onUpdate
     */
    async function streamSummarize(req, onUpdate) {
        // req.paragraphs is a Record<string,string> when we send sections
        const joinedText = req.paragraphs ? Object.keys(req.paragraphs).sort((a, b) => +a - +b).map(k => req.paragraphs[k]).join('\n\n') : (req.text || '');

        const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
        if (req.force) {
            headers['Cache-Control'] = 'no-cache';
        }

        const res = await fetch(SUMMARIZE_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                text: joinedText,
                paragraphs: req.paragraphs || null,
                id: req.id,
                chapter: req.chapter || '',
                source: req.source,
                characters: persist.characters ? Object.values(persist.characters) : [],
                timeline: persist.timeline || []
            }),
        });
        if (!res.ok || !res.body) throw new Error(`Summarize error: ${res.status}`);
        await readSSE(res.body, ({ event, data }) => {
            if ((event === 'data' || event === 'done') && data) onUpdate(data, event);
        });
    }

    async function requestEdit({ selection, prompt, rules, paragraphKeys, chapter }) {
        const payload = {
            id: currentWorkId || WORK_ID,
            chapter: chapter ?? (currentChapterId || ''),
            selection,
            prompt,
            rules,
            paragraph_keys: paragraphKeys || [],
            source: adapter.source,
        };
        const res = await fetch(EDIT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            throw new Error(`Edit error: ${res.status}`);
        }
        return res.json();
    }

    /** ---------------------------------------
     * DOM Helpers (Scanning & Wrapping)
     * ------------------------------------- */

    /** Checks if a text node is safe to manipulate. */
    function isSafeTextNode(node) {
        return !!(node && node.isConnected && node.parentNode && node.nodeValue && node.nodeValue.trim());
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
     * Builds an exact-match regex from a set of known names (and aliases).
     * Uses word boundaries; supports multi-word names.
     * @param {Set<string>} nameSet
     * @returns {RegExp|null}
     */
    function buildNameRegexExact(nameSet) {
        const names = [...nameSet].map(s => s && s.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!names.length) return null;
        // Allow Nathan, Nathan's, and James' (common style)
        return new RegExp(`\\b(?:${names.join('|')})(?:['’]s|['’])?\\b`, 'gi');
    }

    /**
     * Builds a case-insensitive pronoun regex with strict word boundaries.
     * Avoid matching contractions like "he's" / "she's" / "they're".
     * @param {string[]} prons
     */
    function buildPronounRegex(prons) {
        const alt = prons.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        return new RegExp(`\\b(?:${alt})\\b(?!['’])`, 'gi');
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

    /** Ensures each character of an element is wrapped in a span for per-letter animation. */
    function ensureLetterSpans(el) {
        if (el.dataset.letterized === '1') return;
        el.dataset.letterized = '1';
        const text = el.textContent || '';
        el.textContent = '';

        for (const ch of text) {
            // Preserve spaces / whitespace as normal text so word spacing stays intact
            if (ch.trim() === '') {
                el.appendChild(document.createTextNode(ch));
                continue;
            }
            const s = document.createElement('span');
            s.className = CLS.letter;
            s.textContent = ch;
            el.appendChild(s);
        }
    }

    /** Animates a name element with a brief letter pop when it enters the viewport. */
    function animateName(el) {
        if (el.dataset.animated === '1') return;
        el.dataset.animated = '1';
        ensureLetterSpans(el);
        const letters = el.querySelectorAll(`.${CLS.letter}`);
        anime({
            targets: letters,
            scale: [{ value: 1.0, duration: 0 }, {
                value: 1.15, duration: 120, delay: anime.stagger(12, { start: 0 })
            }, { value: 1.0, duration: 140 }],
            translateY: [{ value: -2, duration: 100, delay: anime.stagger(12) }, { value: 0, duration: 140 }],
            easing: 'easeOutQuad'
        });
    }

    /** ---------------------------------------
     * Tooltip / Info Cards
     * ------------------------------------- */

    function getMaxActionsForScreen() {
        const h = window.innerHeight, w = window.innerWidth;
        if (h < 700 || w < 900) return 4;
        if (h < 900 || w < 1200) return 6;
        return 10;
    }

    function escapeHTML(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function renderCharacterDetailsHTML(d, isHovered = false) {
        const aliasChips = (d.aliases || []).map(a => `<span class="${CLS.chip}">${escapeHTML(a)}</span>`).join(' ');
        const pd = d.physical_description || {};
        const sc = d.sexual_characteristics || {};
        const linesTop = [];
        if (d.role) linesTop.push(`<div class="${CLS.field}"><b>Role:</b> ${escapeHTML(d.role)}</div>`);
        if (d.personality) linesTop.push(`<div class="${CLS.field}"><b>Personality:</b> ${escapeHTML(d.personality)}</div>`);
        const topGrid = `
      <div class="${CLS.grid2}">
        <div class="${CLS.field}"><b>Age:</b> ${escapeHTML(d.age || '—')}</div>
        <div class="${CLS.field}"><b>Gender:</b> ${escapeHTML(d.gender || '—')}</div>
        <div class="${CLS.field}"><b>Species:</b> ${escapeHTML(d.species || '—')}</div>
        <div class="${CLS.field}"><b>Kind:</b> ${escapeHTML(d.kind || '—')}</div>
      </div>`;
        const phys = [pd.height && `<div class="${CLS.field}">• Height: ${escapeHTML(pd.height)}</div>`, pd.build && `<div class="${CLS.field}">• Build: ${escapeHTML(pd.build)}</div>`, pd.fur && `<div class="${CLS.field}">• Fur: ${escapeHTML(pd.fur)}</div>`, pd.hair && `<div class="${CLS.field}">• Hair: ${escapeHTML(pd.hair)}</div>`, pd.other && `<div class="${CLS.field}">• Other: ${escapeHTML(pd.other)}</div>`,].filter(Boolean).join('');
        const sex = [sc.genitalia && `<div class="${CLS.field}">• Genitalia: ${escapeHTML(sc.genitalia)}</div>`, sc.penis_length_flaccid && `<div class="${CLS.field}">• Penis (flaccid): ${escapeHTML(sc.penis_length_flaccid)}</div>`, sc.penis_length_erect && `<div class="${CLS.field}">• Penis (erect): ${escapeHTML(sc.penis_length_erect)}</div>`, sc.pubic_hair && `<div class="${CLS.field}">• Pubic hair: ${escapeHTML(sc.pubic_hair)}</div>`, sc.other && `<div class="${CLS.field}">• Other: ${escapeHTML(sc.other)}</div>`,].filter(Boolean).join('');

        const actsArr = Array.isArray(d.notable_actions) ? d.notable_actions : [];
        let actsList = '';
        if (actsArr.length) {
            const maxActs = getMaxActionsForScreen();
            const shown = isHovered ? actsArr.slice(0, maxActs) : actsArr;
            const extra = actsArr.length - shown.length;
            const items = shown.map(a => `<li>${escapeHTML(a)}</li>`).join('');
            actsList = `<ul style="margin:4px 0 0 16px; padding:0">${items}${extra > 0 ? `<li>… (+${extra} more)</li>` : ''}</ul>`;
        }

        return `
      <div style="font-weight:700;margin-bottom:6px">${escapeHTML(d.name)}</div>
      ${aliasChips ? `<div style="margin-bottom:4px">${aliasChips}</div>` : ''}
      ${topGrid}
      ${linesTop.join('')}
      ${phys ? `<div class="${CLS.field}" style="margin-top:6px"><b>Physical</b>${phys}</div>` : ''}
      ${sex ? `<div class="${CLS.field}" style="margin-top:6px"><b>Sexual</b>${sex}</div> ` : ''}
      ${actsArr.length ? `<div class="${CLS.field}" style="margin-top:6px"><b>Notable actions</b>${actsList}</div>` : ''}
    `;
    }

    /** Creates the information dot element shown next to a name. */
    function makeInfoDot(color) {
        const dot = document.createElement('span');
        dot.className = CLS.infoDot;
        dot.style.color = color;
        dot.setAttribute('title', 'Character details');
        return dot;
    }

    /** Shows a tooltip for a given dot element. */
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

    /** Hides an active tooltip for a dot element. */
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

    /** Selects a candidate POV name based on the highest mentions, preferring majors when tied. */
    function determinePOVName(persist) {
        let best = null, bestCount = -1;
        for (const [n, d] of Object.entries(persist.characters)) {
            if ((d.mentions || 0) > bestCount) {
                best = n;
                bestCount = d.mentions || 0;
            }
        }
        const majorsWithBest = Object.entries(persist.characters).filter(([n, d]) => d.kind === 'major' && (d.mentions || 0) === bestCount);
        if (majorsWithBest.length === 1) return majorsWithBest[0][0];
        return best;
    }

    /** ---------------------------------------
     * Alias normalization & name sets
     * ------------------------------------- */

    let aliasIndex = Object.create(null);

    function rebuildAliasIndex() {
        aliasIndex = Object.create(null);
        for (const [canon, d] of Object.entries(persist.characters)) {
            for (const a of (d.aliases || [])) aliasIndex[a] = canon;
        }
    }

    function normalizeCharactersStore() {
        const newChars = {};
        const addAlias = (obj, a) => {
            if (!a) return;
            obj.aliases = Array.from(new Set([...(obj.aliases || []), a].filter(Boolean)));
        };

        for (const [key, d] of Object.entries(persist.characters)) {
            const canon = (d.name || key).trim();
            if (!canon) continue;

            let dst = newChars[canon];
            if (!dst) {
                dst = newChars[canon] = {
                    color: d.color || nameToColor(canon),
                    mentions: d.mentions || 0,
                    name: canon,
                    age: d.age,
                    gender: d.gender,
                    aliases: Array.isArray(d.aliases) ? [...new Set(d.aliases)] : [],
                    kind: d.kind || 'minor',
                    role: d.role,
                    species: d.species,
                    personality: d.personality,
                    physical_description: d.physical_description || {},
                    sexual_characteristics: d.sexual_characteristics || {},
                    notable_actions: Array.isArray(d.notable_actions) ? d.notable_actions.slice(0) : [],
                };
            } else {
                dst.mentions = (dst.mentions || 0) + (d.mentions || 0);
                dst.age ??= d.age;
                dst.gender ??= d.gender;
                dst.role ??= d.role;
                dst.species ??= d.species;
                dst.personality ??= d.personality;
                dst.kind = dst.kind === 'main' || d.kind === 'main' ? 'main' : (dst.kind === 'major' || d.kind === 'major' ? 'major' : (dst.kind || d.kind || 'minor'));
                dst.physical_description = { ...(dst.physical_description || {}), ...(d.physical_description || {}) };
                dst.sexual_characteristics = { ...(dst.sexual_characteristics || {}), ...(d.sexual_characteristics || {}) };
                if (Array.isArray(d.notable_actions)) dst.notable_actions = Array.from(new Set([...(dst.notable_actions || []), ...d.notable_actions]));
                if (Array.isArray(d.aliases)) dst.aliases = Array.from(new Set([...(dst.aliases || []), ...d.aliases]));
            }
            if (key !== canon) addAlias(dst, key);
        }

        persist.characters = newChars;
        rebuildAliasIndex();
        savePersistSafe(persist);
    }

    function computeNameSet() {
        const set = new Set();
        for (const [canon, d] of Object.entries(persist.characters)) {
            set.add(canon);
            (d.aliases || []).forEach(a => set.add(a));
        }
        return set;
    }

    /** ---------------------------------------
     * Side Panel UI (Characters & Timeline tabs)
     * ------------------------------------- */

    const throbber = document.createElement('div');
    throbber.className = CLS.throbber;
    throbber.textContent = 'Analyzing story';
    document.body.appendChild(throbber);

    const selectionFab = document.createElement('button');
    selectionFab.className = CLS.editFab;
    selectionFab.textContent = 'Edit selection';
    selectionFab.style.display = 'none';
    document.body.appendChild(selectionFab);

    function setThrobber(on) {
        throbber.style.display = on ? 'block' : 'none';
    }

    let inflight = 0;
    let summaryReady = false;
    const inc = () => {
        inflight++;
        setThrobber(true);
    };
    const dec = () => {
        inflight = Math.max(0, inflight - 1);
        if (!inflight) setThrobber(false);
    };

    const wrapTargets = () => adapter.findWrapTargets();

    function hideSelectionFab() {
        selectionFab.style.display = 'none';
    }

    function collectSelectionKeys(range) {
        const keys = new Set();
        document.querySelectorAll('.ao3sn-para').forEach(para => {
            try {
                if (range.intersectsNode(para) && para.dataset.sectionKey) {
                    keys.add(para.dataset.sectionKey);
                }
            } catch { /* ignore */ }
        });
        return Array.from(keys).sort((a, b) => Number(a) - Number(b));
    }

    function deriveChapterFromKeys(keys) {
        if (!Array.isArray(keys) || !keys.length) return '';
        const first = keys[0];
        if (!first) return '';
        const match = first.match(/^ch-(\d+)-/);
        return match ? match[1] : '';
    }

    function withinStoryContainers(node) {
        if (!node) return false;
        return wrapTargets().some(root => root.contains(node instanceof Node ? node : node.parentNode));
    }

    function handleSelectionChange() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
            hideSelectionFab();
            pendingSelection = null;
            return;
        }
        const cleaned = stripHeatEmojis(sel.toString() || '');
        const text = cleaned.trim();
        if (!text || text.length < 4) {
            hideSelectionFab();
            pendingSelection = null;
            return;
        }
        const range = sel.getRangeAt(0).cloneRange();
        if (!withinStoryContainers(range.commonAncestorContainer)) {
            hideSelectionFab();
            pendingSelection = null;
            return;
        }
        const rect = range.getBoundingClientRect();
        selectionFab.style.top = `${window.scrollY + rect.top - 36}px`;
        selectionFab.style.left = `${window.scrollX + rect.left}px`;
        selectionFab.style.display = 'block';
        const keys = collectSelectionKeys(range);
        const chapterFromSelection = deriveChapterFromKeys(keys);
        pendingSelection = { text, keys, chapter: chapterFromSelection || currentChapterId || '' };
    }

    document.addEventListener('mouseup', () => setTimeout(handleSelectionChange, 0));
    document.addEventListener('keyup', (ev) => {
        if (ev.key === 'Escape') {
            hideSelectionFab();
            pendingSelection = null;
            return;
        }
        setTimeout(handleSelectionChange, 0);
    });

    selectionFab.addEventListener('click', () => {
        if (pendingSelection && editUI && typeof editUI.applySelection === 'function') {
            editUI.applySelection(pendingSelection);
        }
        hideSelectionFab();
    });

    function buildPanel() {
        const panel = document.createElement('aside');
        panel.className = CLS.panel + (persist.pinnedPanel ? ` ${CLS.panelPinned}` : '');
        let defaultHeight = Number.isFinite(persist.panelHeight) ? persist.panelHeight : Math.round(window.innerHeight * 0.6);
        let defaultWidth = Number.isFinite(persist.panelWidth) ? persist.panelWidth : 360;
        if (!Number.isFinite(persist.panelHeight)) persist.panelHeight = defaultHeight;
        if (!Number.isFinite(persist.panelWidth)) persist.panelWidth = defaultWidth;
        panel.style.height = `${defaultHeight}px`;
        panel.style.width = `${defaultWidth}px`;
        panel.setAttribute('aria-label', 'Paige panel');

        const header = document.createElement('div');
        header.className = CLS.panelHeader;
        const pin = document.createElement('button');
        pin.className = CLS.iconBtn;
        pin.textContent = persist.pinnedPanel ? '📌 Shelve' : '📌 Unshelve';
        pin.addEventListener('click', () => {
            persist.pinnedPanel = !persist.pinnedPanel;
            savePersist(persist);
            panel.classList.toggle(CLS.panelPinned);
            pin.textContent = panel.classList.contains(CLS.panelPinned) ? '📌 Shelve' : '📌 Unshelve';
        });
        const compact = document.createElement('button');
        compact.className = CLS.iconBtn;
        compact.textContent = '🗂️ Compact';
        compact.addEventListener('click', () => {
            if (persist.fullscreenPanel) return;
            const collapsed = panel.classList.toggle(CLS.panelCollapsed);
            if (collapsed) {
                panel.style.width = '260px';
            } else {
                const w = persist.panelWidth && Number.isFinite(persist.panelWidth) ? persist.panelWidth : 360;
                panel.style.width = `${w}px`;
            }
        });
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.className = CLS.iconBtn;
        fullscreenBtn.title = 'Expand panel';

        const applyFullscreenState = () => {
            const isFull = Boolean(persist.fullscreenPanel);
            panel.classList.remove(CLS.panelCollapsed);
            panel.classList.toggle(CLS.panelFullscreen, isFull);
            fullscreenBtn.textContent = isFull ? '🗗 Window' : '⛶ Fullscreen';
            fullscreenBtn.title = isFull ? 'Exit fullscreen view' : 'Expand panel';
            fullscreenBtn.setAttribute('aria-pressed', isFull ? 'true' : 'false');
            if (isFull) {
                panel.style.height = '100vh';
                panel.style.width = '100vw';
            } else {
                const h = Number.isFinite(persist.panelHeight) ? persist.panelHeight : defaultHeight;
                const w = Number.isFinite(persist.panelWidth) ? persist.panelWidth : defaultWidth;
                panel.style.height = `${h}px`;
                panel.style.width = `${w}px`;
                panel.classList.remove(CLS.panelCollapsed);
            }
        };

        fullscreenBtn.addEventListener('click', () => {
            if (!persist.fullscreenPanel) {
                persist.panelWidth = panel.offsetWidth;
                persist.panelHeight = panel.offsetHeight;
            }
            persist.fullscreenPanel = !persist.fullscreenPanel;
            applyFullscreenState();
            savePersistSafe(persist);
        });
        const regenPortraitsBtn = document.createElement('button');
        regenPortraitsBtn.className = CLS.iconBtn;
        regenPortraitsBtn.textContent = '🎨 Portraits';
        regenPortraitsBtn.title = 'Regenerate portraits';
        regenPortraitsBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (!summaryReady) return;
            queuePortraitsInOrder({ listRoot: list, listMinorRoot: listMinor, force: true });
        });
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.textContent = adapter.name;
        header.append(pin, compact, fullscreenBtn, regenPortraitsBtn, title);
        applyFullscreenState();

        const tabs = document.createElement('div');
        tabs.className = CLS.tabs;
        const tabChars = document.createElement('div');
        tabChars.className = `${CLS.tab} ${CLS.tabActive}`;
        tabChars.textContent = 'Characters';
        const tabTL = document.createElement('div');
        tabTL.className = CLS.tab;
        tabTL.textContent = 'Timeline';
        const tabEdits = document.createElement('div');
        tabEdits.className = CLS.tab;
        tabEdits.textContent = 'Edits';
        tabs.append(tabChars, tabTL, tabEdits);

        const manual = document.createElement('div');
        manual.className = CLS.manualBox;
        const input = document.createElement('input');
        input.placeholder = 'Add a character name…';
        const addBtn = document.createElement('button');
        addBtn.className = CLS.btn;
        addBtn.textContent = 'Add';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addBtn.click();
        });
        addBtn.addEventListener('click', () => {
            const v = input.value.trim();
            if (!v) return;
            upsertName(v, 'major');
            input.value = '';
            renderCharacters();
            reprocessNamesDebounced();
        });
        manual.append(input, addBtn);

        const sectionChars = document.createElement('div');
        sectionChars.className = CLS.section;
        const list = document.createElement('div');
        list.className = CLS.list;
        const minorHeader = document.createElement('div');
        minorHeader.textContent = 'Minor Characters';
        minorHeader.style.cssText = 'font-size:12px;opacity:.8;padding:5px;';
        const listMinor = document.createElement('div');
        listMinor.className = `${CLS.list} ${CLS.listMinor}`;
        sectionChars.append(list, minorHeader, listMinor);

        const sectionTL = document.createElement('div');
        sectionTL.className = CLS.section;
        sectionTL.style.display = 'none';
        const tlRoot = document.createElement('div');
        tlRoot.className = CLS.list;
        sectionTL.append(tlRoot);

        const sectionEdit = document.createElement('div');
        sectionEdit.className = CLS.section;
        sectionEdit.style.display = 'none';

        const editBox = document.createElement('div');
        editBox.className = CLS.editBox;

        const selectionInput = document.createElement('textarea');
        selectionInput.className = CLS.editTextarea;
        selectionInput.placeholder = 'Highlight story text or paste a section here…';
        const initialDraft = stripHeatEmojis(persist.edits.draftSelection || '');
        selectionInput.value = initialDraft;
        if (initialDraft !== (persist.edits.draftSelection || '')) {
            persist.edits.draftSelection = initialDraft;
            scheduleSave();
        }

        const promptInput = document.createElement('textarea');
        promptInput.className = CLS.editTextarea;
        promptInput.placeholder = 'Describe the edit you want…';
        promptInput.value = persist.edits.lastPrompt || '';

        const rulesInput = document.createElement('textarea');
        rulesInput.className = CLS.editTextarea;
        rulesInput.placeholder = 'Editing rules (optional)';
        rulesInput.value = persist.edits.rules || DEFAULT_EDIT_RULES;

        const editControls = document.createElement('div');
        editControls.className = CLS.editControls;
        const clearBtn = document.createElement('button');
        clearBtn.className = CLS.iconBtn;
        clearBtn.textContent = 'Clear selection';
        const sendBtn = document.createElement('button');
        sendBtn.className = CLS.btn;
        sendBtn.textContent = 'Send edit';
        editControls.append(clearBtn, sendBtn);

        const resultBox = document.createElement('div');
        resultBox.className = CLS.editResult;
        resultBox.textContent = persist.edits.lastResult || 'Edited text will appear here.';

        editBox.append(selectionInput, promptInput, rulesInput, editControls, resultBox);
        const historyWrap = document.createElement('div');
        historyWrap.className = CLS.editHistoryWrap;

        const historyToolbar = document.createElement('div');
        historyToolbar.className = CLS.editToolbar;
        const historyLabel = document.createElement('div');
        historyLabel.style.fontWeight = '600';
        historyLabel.textContent = 'History';
        const historyMeta = document.createElement('span');
        historyMeta.style.cssText = 'font-size:11px;opacity:0.75;margin-left:6px;';
        historyLabel.appendChild(historyMeta);

        const historyToolbarActions = document.createElement('div');
        historyToolbarActions.style.display = 'flex';
        historyToolbarActions.style.gap = '8px';

        const clearHistoryBtn = document.createElement('button');
        clearHistoryBtn.className = CLS.iconBtn;
        clearHistoryBtn.textContent = 'Clear history';
        historyToolbarActions.append(clearHistoryBtn);

        historyToolbar.append(historyLabel, historyToolbarActions);

        const historyRoot = document.createElement('div');
        historyRoot.className = CLS.editHistory;

        historyWrap.append(historyToolbar, historyRoot);
        sectionEdit.append(editBox, historyWrap);

        const syncSelectionDraft = debounce(() => {
            persist.edits.draftSelection = selectionInput.value;
            scheduleSave();
        }, 250);
        selectionInput.addEventListener('input', () => {
            sanitizeTextareaValue(selectionInput);
            syncSelectionDraft();
        });
        promptInput.addEventListener('input', () => {
            persist.edits.lastPrompt = promptInput.value;
            scheduleSave();
        });
        rulesInput.addEventListener('input', () => {
            persist.edits.rules = rulesInput.value || DEFAULT_EDIT_RULES;
            scheduleSave();
        });
        clearBtn.addEventListener('click', () => {
            selectionInput.value = '';
            persist.edits.draftSelection = '';
            pendingSelection = null;
            scheduleSave();
        });

        const clearHistoryForActiveChapter = () => {
            const chapterKey = currentChapterId || '';
            if (!persist.edits.historyByChapter || !Array.isArray(persist.edits.historyByChapter[chapterKey]) || !persist.edits.historyByChapter[chapterKey].length) {
                return false;
            }
            persist.edits.historyByChapter[chapterKey] = [];
            scheduleSave();
            return true;
        };

        const deleteHistoryEntryAt = (index) => {
            const chapterKey = currentChapterId || '';
            if (!persist.edits.historyByChapter || !Array.isArray(persist.edits.historyByChapter[chapterKey])) return false;
            const list = persist.edits.historyByChapter[chapterKey];
            if (index < 0 || index >= list.length) return false;
            list.splice(index, 1);
            scheduleSave();
            return true;
        };

        clearHistoryBtn.addEventListener('click', () => {
            if (clearHistoryBtn.disabled) return;
            if (clearHistoryForActiveChapter()) {
                renderEditHistory();
            }
        });

        const setEditLoading = (busy) => {
            sendBtn.disabled = busy;
            sendBtn.textContent = busy ? 'Sending…' : 'Send edit';
        };

        const renderEditHistory = () => {
            historyRoot.innerHTML = '';
            const chapterKey = currentChapterId || '';
            const entries = (persist.edits.historyByChapter && persist.edits.historyByChapter[chapterKey]) || [];
            const countLabel = entries.length ? `${entries.length} edit${entries.length === 1 ? '' : 's'}` : 'No edits yet';
            historyMeta.textContent = `(${countLabel})`;
            clearHistoryBtn.disabled = entries.length === 0;
            if (!entries.length) {
                const empty = document.createElement('div');
                empty.className = CLS.editEmpty;
                empty.textContent = 'No edits yet for this chapter.';
                historyRoot.appendChild(empty);
                return;
            }
            entries.forEach((entry, idx) => {
                const card = document.createElement('div');
                card.className = CLS.editHistoryItem;

                const meta = document.createElement('div');
                meta.className = CLS.editHistoryMeta;
                let when = 'just now';
                if (entry.created_at) {
                    const t = new Date(entry.created_at);
                    when = Number.isNaN(t.getTime()) ? entry.created_at : t.toLocaleString();
                }
                const promptSpan = document.createElement('span');
                promptSpan.textContent = entry.prompt || 'Prompt';
                const badge = document.createElement('span');
                badge.className = CLS.editBadge;
                badge.textContent = entry.chapter ? `Chapter ${entry.chapter}` : 'Story';
                const whenSpan = document.createElement('span');
                whenSpan.textContent = when;
                meta.append(promptSpan, badge, whenSpan);

                const actions = document.createElement('div');
                actions.className = CLS.editHistoryActions;
                const deleteBtn = document.createElement('button');
                deleteBtn.className = CLS.iconBtn;
                deleteBtn.textContent = 'Delete';
                deleteBtn.title = 'Remove this edit entry';
                deleteBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (deleteHistoryEntryAt(idx)) {
                        renderEditHistory();
                    }
                });
                actions.append(deleteBtn);
                meta.appendChild(actions);
                card.appendChild(meta);

                const original = document.createElement('pre');
                original.textContent = entry.original || '';
                original.style.opacity = '0.7';
                card.appendChild(original);

                const divider = document.createElement('div');
                divider.style.cssText = 'height:1px;background:rgba(255,255,255,0.15);margin:6px 0;';
                card.appendChild(divider);

                const result = document.createElement('pre');
                result.textContent = entry.result || '';
                card.appendChild(result);

                historyRoot.appendChild(card);
            });
        };

        async function sendEditFromPanel() {
            const sanitizedSelection = stripHeatEmojis(selectionInput.value || '');
            if (sanitizedSelection !== selectionInput.value) {
                selectionInput.value = sanitizedSelection;
                persist.edits.draftSelection = sanitizedSelection;
                scheduleSave();
            }
            const selection = sanitizedSelection.trim();
            const promptText = promptInput.value.trim();
            const rulesText = rulesInput.value.trim();
            if (!selection) {
                resultBox.textContent = 'Select or paste some story text first.';
                return;
            }
            if (!promptText) {
                resultBox.textContent = 'Add an edit prompt describing the change.';
                return;
            }
            if (!currentWorkId) {
                resultBox.textContent = 'Work ID not ready yet.';
                return;
            }

            setEditLoading(true);
            try {
                const payload = await requestEdit({
                    selection,
                    prompt: promptText,
                    rules: rulesText,
                    paragraphKeys: pendingSelection?.keys || [],
                    chapter: pendingSelection?.chapter,
                });
                resultBox.textContent = payload.result || 'No content returned.';
                persist.edits.lastResult = payload.result || '';
                persist.edits.lastPrompt = promptInput.value;
                persist.edits.rules = rulesInput.value;
                const chapterKey = (payload.chapter ?? pendingSelection?.chapter ?? currentChapterId) || '';
                if (payload.history) {
                    persist.edits.historyByChapter[chapterKey] = payload.history;
                } else if (payload.entry) {
                    const existing = persist.edits.historyByChapter[chapterKey] || [];
                    persist.edits.historyByChapter[chapterKey] = [payload.entry, ...existing].slice(0, 50);
                }
                pendingSelection = null;
                scheduleSave();
                renderEditHistory();
            } catch (err) {
                console.warn('[Paige] edit request failed', err);
                resultBox.textContent = `Edit failed: ${err?.message || err}`;
            } finally {
                setEditLoading(false);
            }
        }

        sendBtn.addEventListener('click', () => {
            if (sendBtn.disabled) return;
            sendEditFromPanel();
        });

        const resizer = document.createElement('div');
        resizer.className = CLS.resizer;

        panel.append(header, tabs, manual, sectionChars, sectionTL, sectionEdit, resizer);
        document.body.appendChild(panel);

        const setActiveTab = (tab) => {
            const isChars = tab === 'chars';
            const isTimeline = tab === 'timeline';
            const isEdits = tab === 'edits';
            tabChars.classList.toggle(CLS.tabActive, isChars);
            tabTL.classList.toggle(CLS.tabActive, isTimeline);
            tabEdits.classList.toggle(CLS.tabActive, isEdits);
            sectionChars.style.display = isChars ? 'block' : 'none';
            sectionTL.style.display = isTimeline ? 'block' : 'none';
            sectionEdit.style.display = isEdits ? 'block' : 'none';
            manual.style.display = isEdits ? 'none' : 'grid';
        };
        tabChars.addEventListener('click', () => setActiveTab('chars'));
        tabTL.addEventListener('click', () => setActiveTab('timeline'));
        tabEdits.addEventListener('click', () => setActiveTab('edits'));

        resizer.addEventListener('mousedown', (e) => {
            if (persist.fullscreenPanel) return;
            e.preventDefault();
            const startY = e.clientY;
            const startH = panel.offsetHeight;

            function onMove(ev) {
                const nh = startH + ev.clientY - startY;
                const minH = 200;
                const maxH = Math.round(window.innerHeight * 0.9);
                panel.style.height = `${Math.min(Math.max(nh, minH), maxH)}px`;
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                persist.panelHeight = panel.offsetHeight;
                savePersist(persist);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        const sideResizer = document.createElement('div');
        sideResizer.className = 'ao3sn-resizer-side';
        panel.appendChild(sideResizer);

        sideResizer.addEventListener('mousedown', (e) => {
            if (persist.fullscreenPanel) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;

            function onMove(ev) {
                const dx = startX - ev.clientX; // drag left => increase width
                const raw = startW + dx;
                const minW = 260;
                const maxW = Math.round(window.innerWidth * 0.8);
                const nw = Math.min(Math.max(raw, minW), maxW);
                panel.style.width = `${nw}px`;
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                persist.panelWidth = panel.offsetWidth;
                savePersist(persist);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        function makeCard(name, data, povName) {
            const card = document.createElement('div');
            card.className = CLS.card;
            card.dataset.name = name;
            if (povName === name) card.classList.add('ao3sn-featured');

            const avatar = document.createElement('div');
            avatar.className = CLS.avatar;
            const img = document.createElement('img');
            img.className = CLS.avatarImg;
            img.alt = `${name} avatar`;
            const key = portraitKey(currentWorkId || WORK_ID, name);
            const portrait = PORTRAIT_STATE.get(key);
            if (portrait && portrait.status === 'ready' && portrait.url) {
                img.src = portrait.url;
            } else {
                img.src = getAvatar(name, data.color);
                if (portrait && portrait.status === 'loading') {
                    avatar.classList.add(CLS.avatarLoading);
                }
            }
            avatar.appendChild(img);
            const text = document.createElement('div');
            text.className = CLS.row;
            const nm = document.createElement('div');
            nm.className = CLS.compactName;
            nm.textContent = name;
            nm.style.color = data.color;

            const factsEl = document.createElement('div');
            factsEl.style.cssText = 'font-size:12px;opacity:.8';
            const factItems = [];
            if (data.role) factItems.push(data.role);
            if (data.age) factItems.push(`Age ${data.age}`);
            if (data.gender) factItems.push(data.gender);
            if (data.species) factItems.push(data.species);
            factsEl.textContent = factItems.join(' • ') || '—';

            const rm = document.createElement('button');
            rm.className = CLS.iconBtn;
            rm.textContent = '✖';
            rm.title = 'Remove';
            rm.addEventListener('click', (ev) => {
                ev.stopPropagation();
                removeName(name);
                renderCharacters();
                reprocessNamesDebounced();
            });

            text.append(nm, factsEl);
            card.append(avatar, text, rm);

            const details = document.createElement('div');
            details.className = CLS.details;
            details.innerHTML = renderCharacterDetailsHTML(data);
            card.appendChild(details);

            const toggle = () => {
                details.style.display = details.style.display === 'none' || !details.style.display ? 'block' : 'none';
            };
            card.addEventListener('click', (e) => {
                if (e.target === rm) return;
                toggle();
            });
            nm.addEventListener('click', (e) => {
                e.stopPropagation();
                toggle();
            });

            return card;
        }

        function renderCharacters() {
            list.innerHTML = '';
            listMinor.innerHTML = '';
            const major = [];
            const minor = [];
            for (const [name, d] of Object.entries(persist.characters)) (d.kind === 'major' || d.kind === 'main' ? major : minor).push([name, d]);

            const pov = persist.povName && persist.characters[persist.povName] ? persist.povName : null;

            if (pov && persist.characters[pov] && (persist.characters[pov].kind === 'major' || persist.characters[pov].kind === 'main')) {
                list.appendChild(makeCard(pov, persist.characters[pov], pov));
                for (let i = major.length - 1; i >= 0; i--) if (major[i][0] === pov) major.splice(i, 1);
            }
            major.forEach(([n, d]) => list.appendChild(makeCard(n, d, pov)));
            minor.forEach(([n, d]) => listMinor.appendChild(makeCard(n, d, pov)));
            queuePortraitsInOrder({ listRoot: list, listMinorRoot: listMinor, force: false });
        }

        function renderTimeline() {
            tlRoot.innerHTML = '';
            for (const day of persist.timeline) {
                const dayEl = document.createElement('div');
                dayEl.className = CLS.tlDay;
                const hdr = document.createElement('div');
                hdr.style.cssText = 'font-weight:700;font-size:13px;margin:6px 0 2px';
                hdr.textContent = day.date || '—';
                dayEl.appendChild(hdr);
                for (const ev of day.events || []) {
                    const row = document.createElement('div');
                    row.className = CLS.tlEvent;
                    row.style.cssText = 'border:1px solid #eee;background:#fff;border-radius:8px;padding:6px;display:grid;gap:4px';
                    const tm = document.createElement('div');
                    tm.className = CLS.tlTime;
                    tm.style.cssText = 'font-size:12px;opacity:.8';
                    tm.textContent = ev.time || '';
                    const ds = document.createElement('div');
                    ds.className = CLS.tlDesc;
                    ds.textContent = ev.description || '';
                    const chs = document.createElement('div');
                    chs.className = CLS.tlChars;
                    chs.style.cssText = 'font-size:12px;opacity:.9';
                    if (Array.isArray(ev.characters_involved) && ev.characters_involved.length) {
                        // chs.textContent = `With: ${ev.characters_involved.join(', ')}`;
                        const NameChips = (ev.characters_involved || []).map(a => `<span class="${CLS.chip}">${escapeHTML(a)}</span>`).join(' ');
                        chs.innerHTML = `With: ${NameChips}`;
                    }
                    if (tm.textContent) row.appendChild(tm);
                    row.appendChild(ds);
                    if (chs.textContent) row.appendChild(chs);
                    dayEl.appendChild(row);
                }
                tlRoot.appendChild(dayEl);
            }
        }

        panel._renderCharacters = renderCharacters;
        panel._renderTimeline = renderTimeline;
        panel._renderEdits = renderEditHistory;
        panel._queuePortraits = () => queuePortraitsInOrder({ listRoot: list, listMinorRoot: listMinor, force: false });

        renderCharacters();
        renderTimeline();
        renderEditHistory();

        editUI = {
            selectionInput,
            promptInput,
            rulesInput,
            resultBox,
            renderHistory: renderEditHistory,
            setLoading: setEditLoading,
            applySelection(payload) {
                if (!payload || !payload.text) return;
                const cleanText = stripHeatEmojis(payload.text);
                selectionInput.value = cleanText;
                persist.edits.draftSelection = cleanText;
                pendingSelection = { ...payload, text: cleanText };
                if (payload.chapter) {
                    currentChapterId = payload.chapter;
                }
                scheduleSave();
                setActiveTab('edits');
                if (typeof renderEditHistory === 'function') {
                    renderEditHistory();
                }
            }
        };

        return panel;
    }

    /** ---------------------------------------
     * Main Orchestration
     * ------------------------------------- */

    const persist = loadPersist();
    savePersistSafe(persist);
    persist.characters = persist.characters || {};
    persist.pronouns = persist.pronouns || {};
    persist.timeline = persist.timeline || [];
    persist.heat = persist.heat || {};
    persist.edits = persist.edits || { rules: DEFAULT_EDIT_RULES, lastPrompt: '', draftSelection: '', lastResult: '', historyByChapter: {} };
    persist.edits.historyByChapter = persist.edits.historyByChapter || {};
    persist.fullscreenPanel = Boolean(persist.fullscreenPanel);

    let currentWorkId = '';
    let currentChapterId = '';
    let editUI = null;
    let pendingSelection = null;

    // DOM map for paragraph heat, populated during paragraph collection
    let paraDomMap = {};

    // Pronoun setup (stable colors)
    for (const p of ['he', 'she', 'they']) {
        const k = p.toLowerCase();
        if (!persist.pronouns[k]) persist.pronouns[k] = { color: nameToColor(k) };
    }

    normalizeCharactersStore();

    const initialIDs = adapter.parseWorkAndChapterID();
    currentWorkId = initialIDs.id || WORK_ID;
    currentChapterId = initialIDs.chapter || '';

    function upsertName(name, kind = 'major') {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (!persist.characters[trimmed]) {
            const color = nameToColor(trimmed);
            persist.characters[trimmed] = { color, name: trimmed, kind, mentions: 0, aliases: [] };
            rebuildAliasIndex();
        } else {
            persist.characters[trimmed].kind = kind;
        }
        scheduleSave();
    }

    function removeName(name) {
        delete persist.characters[name];
        rebuildAliasIndex();
        savePersist(persist);
    }

    const panel = buildPanel();
    const renderCharacters = () => panel._renderCharacters && panel._renderCharacters();
    const renderTimeline = () => panel._renderTimeline && panel._renderTimeline();

    /** Merge one CharacterData into persist and return true if a new visible name appeared. */
    function mergeCharacterIntoPersist(ch) {
        const incomingName = (ch.name || '').trim();
        if (!incomingName) return false;
        const canon = persist.characters[incomingName] ? incomingName : (aliasIndex[incomingName] || incomingName);
        const prev = persist.characters[canon];
        const color = (prev && prev.color) || nameToColor(canon);

        if (!prev) {
            persist.characters[canon] = {
                color,
                mentions: 0,
                name: canon,
                age: ch.age,
                gender: ch.gender,
                aliases: Array.isArray(ch.aliases) ? Array.from(new Set(ch.aliases)) : [],
                kind: ch.kind || 'minor',
                role: ch.role,
                species: ch.species,
                personality: ch.personality,
                physical_description: ch.physical_description || {},
                sexual_characteristics: ch.sexual_characteristics || {},
                notable_actions: Array.isArray(ch.notable_actions) ? ch.notable_actions.slice(0) : [],
            };
        } else {
            Object.assign(prev, {
                age: ch.age ?? prev.age,
                gender: ch.gender ?? prev.gender,
                kind: ch.kind || prev.kind,
                role: ch.role ?? prev.role,
                species: ch.species ?? prev.species,
                personality: ch.personality ?? prev.personality,
            });
            prev.physical_description = { ...(prev.physical_description || {}), ...(ch.physical_description || {}) };
            prev.sexual_characteristics = { ...(prev.sexual_characteristics || {}), ...(ch.sexual_characteristics || {}) };
            if (Array.isArray(ch.notable_actions)) prev.notable_actions = Array.from(new Set([...(prev.notable_actions || []), ...ch.notable_actions]));
            if (Array.isArray(ch.aliases)) prev.aliases = Array.from(new Set([...(prev.aliases || []), ...ch.aliases]));
        }

        if (incomingName !== canon) {
            const dst = persist.characters[canon];
            dst.aliases = Array.from(new Set([...(dst.aliases || []), incomingName]));
        }

        rebuildAliasIndex();
        return true;
    }

    function mergeTimeline(days) {
        if (!Array.isArray(days)) return false;
        let changed = false;
        const byDate = new Map(persist.timeline.map(d => [d.date, d]));
        for (const day of days) {
            if (!day || !day.date) continue;
            let target = byDate.get(day.date);
            if (!target) {
                target = { date: day.date, events: [] };
                byDate.set(day.date, target);
                persist.timeline.push(target);
                changed = true;
            }
            const existingKey = new Set(target.events.map(e => `${(e.time || '').toLowerCase()}|${(e.description || '').toLowerCase()}`));
            for (const ev of (day.events || [])) {
                const key = `${(ev.time || '').toLowerCase()}|${(ev.description || '').toLowerCase()}`;
                if (!existingKey.has(key)) {
                    target.events.push({
                        time: ev.time || '',
                        description: ev.description || '',
                        characters_involved: ev.characters_involved || []
                    });
                    existingKey.add(key);
                    changed = true;
                }
            }
        }
        persist.timeline.sort((a, b) => {
            const da = Date.parse(a.date), db = Date.parse(b.date);
            const na = Number.isNaN(da), nb = Number.isNaN(db);
            if (na && nb) return 0;
            if (na) return 1;
            if (nb) return -1;
            return da - db;
        });
        for (const day of persist.timeline) {
            day.events.sort((a, b) => {
                const pa = Date.parse(`${day.date} ${a.time || ''}`), pb = Date.parse(`${day.date} ${b.time || ''}`);
                const na = Number.isNaN(pa), nb = Number.isNaN(pb);
                if (na && nb) return 0;
                if (na) return 1;
                if (nb) return -1;
                return pa - pb;
            });
        }
        return changed;
    }

    /** Build regexes and process name wrapping across the page, then pronouns. */
    function reprocessNames() {
        const nameRegex = buildNameRegexExact(computeNameSet());
        const pronounRegex = buildPronounRegex(Object.keys(persist.pronouns));
        const targets = adapter.findWrapTargets();
        const wrapQueue = [];
        targets.forEach(root => {
            for (const tn of textNodeWalker(root)) wrapQueue.push(tn);
        });

        (async () => {
            const BATCH = 50;
            while (wrapQueue.length) {
                for (let i = 0; i < BATCH && wrapQueue.length; i++) {
                    const tn = wrapQueue.shift();
                    if (!isSafeTextNode(tn)) continue;
                    if (nameRegex) wrapMatchesInTextNode(tn, nameRegex, makeNameSpan);
                }
                await new Promise(res => ric(res));
            }
            // Pronouns pass after names
            const pronounNodes = [];
            adapter.findWrapTargets().forEach(root => {
                for (const tn of textNodeWalker(root)) pronounNodes.push(tn);
            });
            for (const tn of pronounNodes) {
                if (!isSafeTextNode(tn)) continue;
                wrapMatchesInTextNode(tn, pronounRegex, makePronounSpan);
            }

            // Classify characters by mention count
            for (const [name, data] of Object.entries(persist.characters)) {
                if ((data.mentions || 0) >= MIN_MAJOR_MENTIONS) data.kind = 'major'; else if ((data.mentions || 0) >= MIN_MINOR_MENTIONS) data.kind = 'minor';
            }

            // Apply POV gradient
            if (!persist.povName) {
                persist.povName = determinePOVName(persist);
            }
            if (persist.povName && persist.characters[persist.povName]) {
                const base = persist.characters[persist.povName].color;
                const { c1, c2 } = povGradientFrom(base);
                document.documentElement.style.setProperty('--ao3sn-pov-c1', c1);
                document.documentElement.style.setProperty('--ao3sn-pov-c2', c2);
                document.querySelectorAll(`.${CLS.name}[data-name="${CSS.escape(persist.povName)}"]`).forEach(el => el.setAttribute('data-main', '1'));
            }

            savePersist(persist);
            renderCharacters();
        })();
    }

    const reprocessNamesDebounced = debounce(reprocessNames, 150);

    /** Creates a wrapped element for a detected character name. */
    function makeNameSpan(txt) {
        const original = txt;
        // Strip possessive for lookup, keep original for display
        const base = original.replace(/(['’]s|['’])$/i, '');
        const canon = persist.characters[base] ? base : (aliasIndex[base] || null);
        if (!canon || !persist.characters[canon]) return document.createTextNode(original);

        const data = persist.characters[canon];
        data.mentions = (data.mentions || 0) + 1;

        const span = document.createElement('span');
        span.className = `${CLS.name} ${CLS.shine}`;
        span.dataset.name = canon;
        span.style.color = data.color;
        span.textContent = original; // includes the possessive
        const dot = makeInfoDot(data.color);
        dot.addEventListener('mouseenter', () => showTooltip(dot, renderCharacterDetailsHTML(data, true)));
        dot.addEventListener('mouseleave', () => hideTooltip(dot));

        const wrapper = document.createElement('span');
        wrapper.className = 'ao3sn-wrap';
        wrapper.appendChild(dot);
        wrapper.appendChild(span);
        if (persist.povName && persist.povName === canon) span.setAttribute('data-main', '1');
        return wrapper;
    }

    /** Creates a wrapped element for a pronoun token. */
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

    // Initial pass
    reprocessNames();

    // Animate when names come into view
    const ioNames = new IntersectionObserver(entries => {
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
        if (el) ioNames.observe(el);
    });

    // Observe new content (placeholder hook)
    const mo = new MutationObserver(debounce(() => { /* dynamic content hook */
    }, 500));
    mo.observe(document.body, { childList: true, subtree: true });

    // Streaming logic (site-specific)
    (async function run() {
        const id = currentWorkId;
        const chapter = currentChapterId;
        const perfEntry = performance.getEntriesByType("navigation")[0];
        let isForceReload = false;
        // type 'reload' can be a normal or hard reload. There's no perfect way to know,
        // but we can assume if the user is reloading, they might want fresh data.
        // A true hard reload (ctrl+f5) is type 'navigate' on some browsers, but sends `Cache-Control: no-cache`.
        if (perfEntry && perfEntry.type === 'reload') isForceReload = true;

        const integratePartial = (partial, event) => {
            const isDone = event === 'done';
            if (isDone) summaryReady = true;
            let changed = false;
            if (partial && Array.isArray(partial.characters)) {
                for (const ch of partial.characters) changed = mergeCharacterIntoPersist(ch) || changed;
            }
            if (partial && Array.isArray(partial.timeline)) {
                changed = mergeTimeline(partial.timeline) || changed;
            }
            if (partial && partial.heat) {
                Object.assign(persist.heat, partial.heat);
                changed = true;
            }
            if (partial && partial.edits) {
                persist.edits.historyByChapter = partial.edits || {};
                changed = true;
                if (editUI && typeof editUI.renderHistory === 'function') {
                    editUI.renderHistory();
                }
            }
            if (changed) {
                normalizeCharactersStore();
                savePersist(persist);
                renderCharacters();
                renderTimeline();
                reprocessNamesDebounced();
            }
            if (isDone && !changed && panel && typeof panel._queuePortraits === 'function') {
                panel._queuePortraits();
            }
            // Always try to render heat from any partial, even if no "changed" for persist
            if (partial && partial.heat && paraDomMap) {
                for (const [k, lvl] of Object.entries(partial.heat)) {
                    const el = paraDomMap[k];
                    if (el) setParagraphHeat(el, lvl); else console.warn('[Paige] paragraph for heat not found:', k);
                }
            }
        };

        try {
            if (adapter.isFullWork()) {
                // AO3 full-work path
                const chapters = adapter.collectChapters();
                if (!chapters.length) {
                    // Fallback: summarize entire page text
                    console.warn('[Paige] no chapters found, falling back to full text summarize');
                    inc();
                    await streamSummarize({
                        force: isForceReload,
                        text: adapter.collectSingleText(), id, chapter: '', source: adapter.source
                    }, integratePartial).finally(() => dec());
                } else {
                    const seen = new WeakSet();
                    const processing = new WeakSet();
                    const obs = new IntersectionObserver((entries) => {
                        entries.forEach((entry) => {
                            const article = entry.target;
                            if (!entry.isIntersecting) return;
                            if (seen.has(article) || processing.has(article)) return;
                            const node = chapters.find(c => c.article === article);
                            if (!node || !node.chapterId) return; // Ensure chapterId exists for prefixing
                            processing.add(article);
                            const { map: paraMap, dom } = collectParagraphsFromRoot(node.article, `ch-${node.chapterId}-`); // Prefix with chapter ID
                            Object.assign(paraDomMap, dom);

                            inc();
                            streamSummarize({ force: isForceReload, paragraphs: paraMap, id, chapter: node.chapterId || '', source: adapter.source }, integratePartial).catch(err => console.warn('[Paige] chapter stream failed:', err))
                                .finally(() => {
                                    dec();
                                    processing.delete(article);
                                    seen.add(article);
                                });
                        });
                    }, { threshold: 0.05, rootMargin: '800px 0px 800px 0px' });
                    chapters.forEach(({ article }) => obs.observe(article));
                }
            } else {
                // Single text block (AO3 single chapter or Inkbunny page)
                const targets = adapter.findWrapTargets();
                const { map: paraMap, dom } = collectParagraphsFromTargets(targets);
                paraDomMap = dom;

                // Render cached heat immediately
                for (const [k, lvl] of Object.entries(persist.heat || {})) {
                    const el = paraDomMap[k];
                    if (el) setParagraphHeat(el, lvl);
                }

                inc();
                await streamSummarize({ force: isForceReload, paragraphs: paraMap, id, chapter, source: adapter.source }, integratePartial).catch(err => {
                    console.error('[Paige] summarize failed:', err);
                    const e = document.createElement('div');
                    e.style.cssText = 'position:fixed;bottom:20px;right:20px;background:crimson;color:#fff;padding:8px 12px;border-radius:8px;z-index:9999;';
                    e.textContent = 'Paige: summarize failed';
                    document.body.appendChild(e);
                    setTimeout(() => e.remove(), 5000);
                }).finally(() => dec());
            }
        } catch (err) {
            console.error('[Paige] summarize error:', err);
            const e = document.createElement('div');
            e.style.cssText = 'position:fixed;bottom:20px;right:20px;background:crimson;color:#fff;padding:8px 12px;border-radius:8px;z-index:9999;';
            e.textContent = 'Paige: summarize failed';
            document.body.appendChild(e);
            setTimeout(() => e.remove(), 5000);
            dec();
        }
    })();

})();
