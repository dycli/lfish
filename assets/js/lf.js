/* ────────────────────────────────────────────────────────────────────────
   lf.js — keyboard navigation for lfish, the lf-style Hugo theme.

   The site is server-rendered: every "directory" and "file" is a real page,
   so navigation is just following links. This script adds the lf feel on top:
   a moving cursor, live preview swapping, and lf's vi-style keybindings.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* PWA: register the minimal service worker so the site is installable, and
     suppress the automatic install prompt. The capability stays (Android offers
     "Install app", desktop shows the URL-bar install button) — it just never
     pops up asking. Runs before the #lf early-return so it applies everywhere. */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); });

  /* fastfetch "uptime": live time since the site launched (data-since = unix secs).
     Runs everywhere (the readout shows in the reader AND in dir previews). */
  var upEls = document.querySelectorAll(".lf-uptime[data-since]");
  if (upEls.length) {
    var renderUptime = function () {
      var now = Date.now() / 1000;
      for (var i = 0; i < upEls.length; i++) {
        var s = Math.max(0, Math.floor(now - parseInt(upEls[i].getAttribute("data-since"), 10)));
        var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
        upEls[i].textContent = d + " days, " + h + " hours, " + m + " mins";
      }
    };
    renderUptime();
    setInterval(renderUptime, 60000);
  }

  var root = document.getElementById("lf");
  if (!root) return;

  // Clicking a breadcrumb or the dylan@host prompt restores the cursor in the
  // target directory the same way keyboard `h` does — carry #from=here (the
  // directory reads it on load). Works from the manager, reader, or a photo page.
  var hereNow = root.getAttribute("data-here") || "";
  var topbar = root.querySelector(".lf-topbar");
  if (topbar && hereNow) topbar.addEventListener("click", function (ev) {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target.closest("a.lf-crumb, a.lf-prompt");
    if (!a) return;
    ev.preventDefault();
    window.location.href = a.getAttribute("href") + "#from=" + encodeURIComponent(hereNow);
  });

  /* ── theme toggle (T) — works in both manager and reader ───────────── */
  var themeBtn = document.getElementById("lf-theme");
  function curTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  // monochrome icons (fill/stroke = currentColor, so they take the theme tint)
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
  var ICON_SUN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6l-1.4 1.4M5.6 18.4l1.4-1.4"/></svg>';
  function renderThemeBtn() { if (themeBtn) themeBtn.innerHTML = curTheme() === "light" ? ICON_SUN : ICON_MOON; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("lf:theme", t); } catch (e) {}
    renderThemeBtn();
  }
  function toggleTheme() { applyTheme(curTheme() === "dark" ? "light" : "dark"); }
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  renderThemeBtn();

  /* ── breadcrumb condensing — universal (manager, reader, photo) ─────── */
  // When the bar is too narrow, shorten the crumbs ABOVE the current/last one to
  // single letters, highest → lowest; the last crumb (current dir / open file)
  // never becomes a letter — it ellipsizes (CSS). Wired here, before the reader
  // and photo branches return, so it applies on every kind of page.
  var mqMobile = window.matchMedia("(max-width: 600px)");   // keep in sync with lf.css
  var pathEl = document.querySelector(".lf-path-m") || document.querySelector(".lf-path");
  var pathCrumbs = pathEl ? Array.prototype.slice.call(pathEl.querySelectorAll(".lf-crumb")) : [];
  function condensePath() {
    if (!pathEl || pathCrumbs.length < 2) return;
    var last = pathCrumbs.length - 1;
    for (var i = 1; i < last; i++) {                  // reset the crumbs above the last to full
      if (pathCrumbs[i]._full == null) pathCrumbs[i]._full = pathCrumbs[i].textContent;
      pathCrumbs[i].textContent = pathCrumbs[i]._full;
    }
    if (!mqMobile.matches) return;
    var cur = pathCrumbs[last];
    for (var j = 1; j < last; j++) {                  // shorten until the last crumb stops truncating
      if (cur.scrollWidth <= cur.clientWidth + 1) break;
      pathCrumbs[j].textContent = pathCrumbs[j]._full.slice(0, 1);
    }
  }
  var pathRaf;
  window.addEventListener("resize", function () {
    if (pathRaf) return;
    pathRaf = requestAnimationFrame(function () { pathRaf = 0; condensePath(); });
  });
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", condensePath);
  else if (mqMobile.addListener) mqMobile.addListener(condensePath);
  if (window.requestAnimationFrame) requestAnimationFrame(condensePath);

  /* ── reader mode (full-screen "open in editor" view) ───────────────── */
  if (root.getAttribute("data-reader") === "1") {
    var body    = document.getElementById("lf-reader-body");
    var cmdEl   = document.getElementById("lf-cmd");
    var fileEl  = document.getElementById("lf-nv-file");
    var rulerEl = document.getElementById("lf-nv-ruler");
    var pctEl   = document.getElementById("lf-nv-pct");
    var up      = root.getAttribute("data-up") || "/";
    var here    = root.getAttribute("data-here") || "";
    var step    = 90;
    var inCmd   = false, cmd = "", gp = false, zp = false;

    // Close back to the manager, one directory up. A symlink you followed passes
    // #up=<the dir it lives in> so you return there (its logical home) rather than
    // the target's real parent; a normally-opened file just goes up structurally.
    var upM = location.hash.match(/(?:^#|&)up=([^&]*)/);
    var backTo = upM ? decodeURIComponent(upM[1]) : up;
    if (upM) history.replaceState(null, "", location.pathname + location.search);
    function quit() {
      window.location.href = backTo + (here ? "#from=" + encodeURIComponent(here) : "");
    }
    function renderCmd() {
      if (cmdEl) { cmdEl.hidden = !inCmd; cmdEl.textContent = inCmd ? ":" + cmd : ""; }
      if (fileEl) fileEl.hidden = inCmd;
    }
    // Neovim-style ruler: line,col on the left of the right group, %P after it.
    function updateRuler() {
      var lh = parseFloat(getComputedStyle(body).lineHeight) || 24;
      var total = Math.max(1, Math.round(body.scrollHeight / lh));
      var line = Math.min(total, Math.round(body.scrollTop / lh) + 1);
      if (rulerEl) rulerEl.textContent = line + ",1";
      var max = body.scrollHeight - body.clientHeight, pct;
      if (max <= 1) pct = "All";
      else if (body.scrollTop <= 0) pct = "Top";
      else if (body.scrollTop >= max - 1) pct = "Bot";
      else pct = Math.round((body.scrollTop / max) * 100) + "%";
      if (pctEl) pctEl.textContent = pct;
    }
    body.addEventListener("scroll", updateRuler, { passive: true });
    updateRuler();

    document.addEventListener("keydown", function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      // vim command line: `:q` (also :quit / :x / :wq) to close
      if (inCmd) {
        if (ev.key === "Escape") { inCmd = false; cmd = ""; renderCmd(); }
        else if (ev.key === "Enter") {
          var c = cmd.trim(); inCmd = false; cmd = ""; renderCmd();
          if (c === "q" || c === "quit" || c === "x" || c === "wq") quit();
        }
        else if (ev.key === "Backspace") { cmd = cmd.slice(0, -1); renderCmd(); }
        else if (ev.key.length === 1) { cmd += ev.key; renderCmd(); }
        ev.preventDefault();
        return;
      }

      // `Z` prefix: ZZ / ZQ quit (vim)
      if (zp) {
        zp = false;
        if (ev.key === "Z" || ev.key === "Q") { quit(); ev.preventDefault(); return; }
      }

      switch (ev.key) {
        case "j": case "ArrowDown": body.scrollBy(0, step); ev.preventDefault(); break;
        case "k": case "ArrowUp":   body.scrollBy(0, -step); ev.preventDefault(); break;
        case "d": body.scrollBy(0, body.clientHeight / 2); ev.preventDefault(); break;
        case "u": body.scrollBy(0, -body.clientHeight / 2); ev.preventDefault(); break;
        case " ": body.scrollBy(0, body.clientHeight * 0.9); ev.preventDefault(); break;
        case "g": if (gp) { body.scrollTo(0, 0); gp = false; } else { gp = true; setTimeout(function () { gp = false; }, 500); } ev.preventDefault(); break;
        case "G": body.scrollTo(0, body.scrollHeight); ev.preventDefault(); break;
        case "Z": zp = true; setTimeout(function () { zp = false; }, 500); ev.preventDefault(); break;
        case "T": toggleTheme(); ev.preventDefault(); break;
        case ":": inCmd = true; cmd = ""; renderCmd(); ev.preventDefault(); break;
        case "q": case "Escape": case "h": case "ArrowLeft": quit(); ev.preventDefault(); break;
        default: break;
      }
    });
    return; // reader mode handled; skip the miller setup
  }

  /* ── photo page (one picture in an album, with its own URL) ─────────── */
  // j/k (and ↓/↑) step to the prev/next picture's page and loop at the ends
  // (not `l`); h/Esc/q return to the album. Neighbours are prefetched.
  if (root.getAttribute("data-photopage") === "1") {
    var ppUp = root.getAttribute("data-up") || "/";
    var ppPrev = root.getAttribute("data-prev") || "";
    var ppNext = root.getAttribute("data-next") || "";
    var ppHere = root.getAttribute("data-here") || "";
    // Status bar = two buttons. Left (title·size·dimensions) → full info box.
    // Right (album + n/n) → a grid of every photo in the album. i / Esc close.
    var infobox = document.getElementById("lf-infobox");
    var infoBtn = document.getElementById("lf-photo-info");
    var albumbox = document.getElementById("lf-albumbox");
    var albumBtn = document.getElementById("lf-photo-album");
    var albumClose = document.getElementById("lf-albumbox-close");
    function infoOpen() { return infobox && !infobox.hidden; }
    function albumOpen() { return albumbox && !albumbox.hidden; }
    function showInfo(on) { if (infobox) infobox.hidden = !on; }
    function showAlbum(on) {
      if (!albumbox) return;
      albumbox.hidden = !on;
      if (on) {   // open on — and highlight — the photo you're viewing
        var c = albumbox.querySelector(".lf-albumthumb--cur") || albumbox.querySelector(".lf-albumthumb");
        if (c) c.focus();
      }
      // on close, focus just falls to the body (hiding the grid blurs the thumb) —
      // don't pull it to the album button, or the button shows a focus box.
    }
    // move the grid selection. next/prev flow through reading order — down a
    // column, then wrap to the top of the next (masonry lays out in DOM order);
    // left/right jump to the nearest thumbnail in the adjacent column.
    function moveAlbumFocus(dir) {
      var thumbs = Array.prototype.slice.call(albumbox.querySelectorAll(".lf-albumthumb"));
      var idx = thumbs.indexOf(document.activeElement);
      if (idx === -1) { if (thumbs[0]) thumbs[0].focus(); return; }
      if (dir === "next" || dir === "prev") {   // loop at the ends: last → first (top of column one), first → last
        var n = thumbs.length;
        thumbs[(idx + (dir === "next" ? 1 : -1) + n) % n].focus();
        return;
      }
      var r = thumbs[idx].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var best = null, bestScore = Infinity;
      thumbs.forEach(function (t, i) {
        if (i === idx) return;
        var tr = t.getBoundingClientRect(), dx = tr.left + tr.width / 2 - cx, dy = tr.top + tr.height / 2 - cy;
        if (dir === "left" ? dx >= -1 : dx <= 1) return;   // must be genuinely left / right
        var score = Math.abs(dx) + Math.abs(dy) * 2;
        if (score < bestScore) { bestScore = score; best = t; }
      });
      if (!best) {   // edge column → wrap to the far column (left→rightmost, right→leftmost), nearest row
        var edgeX = null;
        thumbs.forEach(function (t, i) {
          if (i === idx) return;
          var tl = t.getBoundingClientRect().left;
          if (edgeX === null || (dir === "left" ? tl > edgeX : tl < edgeX)) edgeX = tl;
        });
        bestScore = Infinity;
        thumbs.forEach(function (t, i) {
          if (i === idx || edgeX === null) return;
          var tr = t.getBoundingClientRect();
          if (Math.abs(tr.left - edgeX) > 4) return;   // only the far column
          var d = Math.abs(tr.top + tr.height / 2 - cy);
          if (d < bestScore) { bestScore = d; best = t; }
        });
      }
      if (best) best.focus();
    }
    if (infoBtn) infoBtn.addEventListener("click", function () { showInfo(!infoOpen()); });
    if (infobox) infobox.addEventListener("click", function () { showInfo(false); });
    if (albumBtn) albumBtn.addEventListener("click", function () { showAlbum(!albumOpen()); });
    if (albumClose) albumClose.addEventListener("click", function () { showAlbum(false); });
    if (albumbox) albumbox.addEventListener("click", function (e) { if (e.target === albumbox) showAlbum(false); });
    document.addEventListener("keydown", function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (albumOpen()) {  // sxiv-style thumbnail grid: hjkl / arrows move, Enter or click opens, Esc/q/o close
        if (/^(Escape|q|o)$/.test(ev.key)) { showAlbum(false); ev.preventDefault(); return; }
        var adir = { ArrowLeft: "left", h: "left", ArrowRight: "right", l: "right",
                     ArrowUp: "prev", k: "prev", ArrowDown: "next", j: "next" }[ev.key];
        if (adir) { moveAlbumFocus(adir); ev.preventDefault(); }
        return;
      }
      if (infoOpen()) {   // the info box swallows keys until closed
        if (/^(Escape|q|h|i|ArrowLeft)$/.test(ev.key)) { showInfo(false); ev.preventDefault(); }
        return;
      }
      switch (ev.key) {
        case "j": case "ArrowDown": if (ppNext) window.location.href = ppNext; ev.preventDefault(); break;
        case "k": case "ArrowUp":   if (ppPrev) window.location.href = ppPrev; ev.preventDefault(); break;
        case "h": case "ArrowLeft": case "Escape": case "q":
          window.location.href = ppUp + (ppHere ? "#from=" + encodeURIComponent(ppHere) : ""); ev.preventDefault(); break;
        case "i": showInfo(true); ev.preventDefault(); break;
        case "o": showAlbum(true); ev.preventDefault(); break;   // open the album grid (sxiv thumbnail view)
        case "T": toggleTheme(); ev.preventDefault(); break;
        default: break;
      }
    });
    // mobile chevrons (no keyboard): ← back to album, ^ = prev, v = next (loop)
    var backBtn = document.getElementById("lf-photo-back");
    var prevBtn = document.getElementById("lf-photo-prev");
    var nextBtn = document.getElementById("lf-photo-next");
    if (backBtn) backBtn.addEventListener("click", function () { window.location.href = ppUp + (ppHere ? "#from=" + encodeURIComponent(ppHere) : ""); });
    if (prevBtn) prevBtn.addEventListener("click", function () { if (ppPrev) window.location.href = ppPrev; });
    if (nextBtn) nextBtn.addEventListener("click", function () { if (ppNext) window.location.href = ppNext; });
    [ppPrev, ppNext, ppUp].forEach(function (u) {
      if (!u) return;
      var l = document.createElement("link"); l.rel = "prefetch"; l.href = u; document.head.appendChild(l);
    });
    return; // photo page handled; skip the miller setup
  }

  var list     = document.getElementById("lf-list");
  var entries  = list ? Array.prototype.slice.call(list.querySelectorAll(".lf-entry")) : [];
  var previews = Array.prototype.slice.call(document.querySelectorAll("#lf-preview .lf-prev"));
  var statMain = document.getElementById("lf-stat-main");
  var statTime = document.getElementById("lf-stat-time");
  var statLink = document.getElementById("lf-stat-link");
  var posEl    = document.getElementById("lf-pos");
  var cwdEntry = document.getElementById("lf-cwd-entry");
  var searchEl = document.getElementById("lf-search");
  var termEl   = document.getElementById("lf-search-term");
  var helpEl   = document.getElementById("lf-help");
  var modal    = document.getElementById("lf-modal");

  // session settings (hidden/sort/info/reverse) — persist across navigation
  // within a tab, reset on a fresh visit (lf-style session options).
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  var upHref   = root.getAttribute("data-up") || "";
  var here     = root.getAttribute("data-here") || "";
  var cursor   = parseInt(root.getAttribute("data-selected"), 10) || 0;

  /* ── hidden files (lf's `zh`) ──────────────────────────────────────── */
  // Hidden entries (front matter `hidden: true`) live in the DOM but are
  // skipped by navigation, search, and counts until `zh` reveals them.
  var showHidden = false;
  function entryHidden(i) { return !!entries[i] && entries[i].getAttribute("data-hidden") === "1"; }
  function visible(i) { return showHidden || !entryHidden(i); }

  function firstVisible() { for (var i = 0; i < entries.length; i++) if (visible(i)) return i; return -1; }
  function lastVisible() { for (var i = entries.length - 1; i >= 0; i--) if (visible(i)) return i; return -1; }
  function stepVisible(from, dir) {
    for (var i = from + dir; i >= 0 && i < entries.length; i += dir) if (visible(i)) return i;
    return from; // no visible entry that way: stay put
  }
  function visibleCount() { var c = 0; for (var i = 0; i < entries.length; i++) if (visible(i)) c++; return c; }
  function visibleRank(idx) { var r = 0; for (var i = 0; i <= idx && i < entries.length; i++) if (visible(i)) r++; return r; }
  /* ── prefetch (snappy navigation) ──────────────────────────────────── */
  var prefetched = {};
  function prefetch(href) {
    if (!href || prefetched[href]) return;
    prefetched[href] = 1;
    var l = document.createElement("link");
    l.rel = "prefetch"; l.href = href;
    document.head.appendChild(l);
  }

  /* ── remembered cursor per directory (lf keeps your place) ─────────── */
  // pos maps a directory href -> the child href last selected inside it, so
  // returning to a directory restores the cursor and the preview underline.
  var POS_KEY = "lf:pos";
  var pos = (function () { try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch (e) { return {}; } })();
  function rememberCursor() {
    if (!entries[cursor]) return;
    pos[here] = entries[cursor].getAttribute("data-href");
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
  }
  // Mark each shown directory's preview underline: the entry last left on, or —
  // failing that — the first visible one (which is what you'd land on, and which
  // moves when the preview is re-sorted).
  function updateWillSelect() {
    for (var i = 0; i < previews.length; i++) {
      var e = entries[i];
      if (!e || e.getAttribute("data-dir") !== "1") continue;
      var lis = previews[i].querySelectorAll(".lf-dirprev-list li");
      if (!lis.length) continue;
      var want = pos[e.getAttribute("data-href")], target = null;
      if (want) {
        for (var j = 0; j < lis.length; j++) {
          var a = lis[j].querySelector("a");
          if (a && a.getAttribute("href") === want) { target = lis[j]; break; }
        }
      }
      if (!target) {  // no remembered entry → first visible, honouring zh
        for (var f = 0; f < lis.length; f++) {
          if (showHidden || !lis[f].classList.contains("lf-hidden")) { target = lis[f]; break; }
        }
      }
      if (target) {
        for (var k = 0; k < lis.length; k++) lis[k].classList.remove("lf-will-select");
        target.classList.add("lf-will-select");
      }
    }
  }

  /* ── cursor & preview ──────────────────────────────────────────────── */
  function showPreview(i) {
    for (var p = 0; p < previews.length; p++) {
      previews[p].hidden = (p !== i);
    }
  }

  function setCursor(i, opts) {
    if (!entries.length) return;
    i = Math.max(0, Math.min(entries.length - 1, i));
    cursor = i;
    for (var e = 0; e < entries.length; e++) {
      entries[e].classList.toggle("lf-cursor", e === i);
    }
    showPreview(i);
    if (!opts || !opts.noScroll) {
      entries[i].scrollIntoView({ block: "nearest" });
    }
    prefetch(entries[i] && entries[i].getAttribute("data-href"));
    rememberCursor();
    // reflect the highlighted entry as the last segment of the path bar
    if (cwdEntry && entries[i]) cwdEntry.textContent = entries[i].getAttribute("data-name");
    updateStatus();
  }

  // Desktop only: the mobile directory bar is icon controls (back / home / menu),
  // so there is no stat or position text to maintain there.
  function updateStatus() {
    if (mqMobile.matches) return;
    if (posEl) posEl.textContent = visibleCount() ? visibleRank(cursor) + "/" + visibleCount() : "0/0";
    if (statMain) {
      var el = entries[cursor];
      statMain.textContent = el ? (el.getAttribute("data-stat") || "") : "";
      var t = el ? (el.getAttribute("data-stattime") || "") : "";
      statTime.textContent = t ? "  " + t : "";
      // symlinks show their target, lf-style: "… -> /path"
      var sl = el ? (el.getAttribute("data-symlink") || "") : "";
      if (statLink) statLink.textContent = sl ? " -> " + sl : "";
    }
  }
  // re-fit across breakpoint crossings (close the mobile menu when leaving mobile)
  // and viewport resizes / rotation
  function onBreakpoint() { if (!mqMobile.matches) closeMenu(); updateStatus(); }
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", onBreakpoint);
  else if (mqMobile.addListener) mqMobile.addListener(onBreakpoint);
  /* ── navigation ────────────────────────────────────────────────────── */
  // external links (symlinks to other sites) open in a new tab; internal nav
  // stays in this tab.
  function go(href) {
    if (!href) return;
    if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener");
    else window.location.href = href;
  }
  // Open an entry. A symlink logically lives in THIS directory, so its target is
  // told to exit back here (#up=); a normal file just goes up to its own parent.
  function navTo(el) {
    if (!el) return;
    var href = el.getAttribute("data-href");
    // external symlinks open the URL as-is — #up only means something to our reader
    if (el.getAttribute("data-symlink") && !/^https?:\/\//i.test(href)) href += "#up=" + encodeURIComponent(here);
    go(href);
  }
  function open(i) { navTo(entries[i]); }
  // Going up carries where we came from (#from=) so the parent can restore
  // the cursor onto this folder instead of jumping to the top of the list.
  function goUp() { if (upHref) window.location.href = upHref + "#from=" + encodeURIComponent(here); }

  /* ── incremental search (lf's `/`) ─────────────────────────────────── */
  var searching = false, term = "", lastTerm = "";

  function enterSearch() {
    searching = true; term = "";
    root.classList.add("lf-searching");   // search takes over the whole status bar
    if (searchEl) searchEl.hidden = false;
    renderTerm();
  }
  function exitSearch(keep) {
    searching = false;
    if (keep) lastTerm = term;
    root.classList.remove("lf-searching");
    if (searchEl) searchEl.hidden = true;
  }
  function renderTerm() { if (termEl) termEl.textContent = term; }

  function matchFrom(start, dir, query) {
    query = (query || "").toLowerCase();
    if (!query) return -1;
    var n = entries.length;
    for (var s = 0; s < n; s++) {
      var i = ((start + dir * s) % n + n) % n;
      if (!visible(i)) continue;
      var name = (entries[i].getAttribute("data-name") || "").toLowerCase();
      if (name.indexOf(query) !== -1) return i;
    }
    return -1;
  }

  function searchJump() {
    var hit = matchFrom(0, 1, term);
    if (hit !== -1) setCursor(hit);
  }

  /* ── help (desktop overlay) / status-bar menu (mobile) ─────────────── */
  function toggleModal(force) {
    if (!modal) return;
    modal.hidden = (force === undefined) ? !modal.hidden : !force;
  }
  if (modal) modal.addEventListener("click", function (ev) { if (ev.target === modal) toggleModal(false); });

  // Desktop: the top-bar "?" (with the other controls) opens the cheatsheet.
  // Mobile: the status-bar gear turns the bar itself into a tappable menu (the
  // keys the cheatsheet lists don't exist on a touch screen). "find" instead
  // turns the bar into a "/" prompt you type into — the current column jumps
  // to (and highlights) the match. All of this reuses the same engine functions.
  var menuSorts = Array.prototype.slice.call(document.querySelectorAll(".lf-statusmenu [data-sort]"));
  var findInput = document.getElementById("lf-find-input");
  var menuInfo = Array.prototype.slice.call(document.querySelectorAll(".lf-statusmenu [data-info]"));
  var menuEl = document.querySelector(".lf-menu");
  function menuView(v) { if (menuEl) menuEl.setAttribute("data-view", v); }   // top / sort / show
  function refreshMenu() {
    for (var i = 0; i < menuSorts.length; i++) menuSorts[i].classList.toggle("lf-on", menuSorts[i].getAttribute("data-sort") === sortKey);
    var hb = document.querySelector('.lf-statusmenu [data-act="hidden"]');  if (hb) hb.classList.toggle("lf-on", showHidden);
    var rb = document.querySelector('.lf-statusmenu [data-act="reverse"]'); if (rb) rb.textContent = reverseOn ? "desc" : "asc";
    for (var k = 0; k < menuInfo.length; k++) menuInfo[k].classList.toggle("lf-on", infoMode.indexOf(menuInfo[k].getAttribute("data-info")) !== -1);
  }
  function closeMenu() { root.classList.remove("lf-menuopen", "lf-finding"); if (findInput) findInput.blur(); updateStatus(); }
  function openMenu()  { menuView("top"); refreshMenu(); root.classList.remove("lf-finding"); root.classList.add("lf-menuopen"); }
  function enterFind() { root.classList.add("lf-menuopen", "lf-finding"); if (findInput) { findInput.value = ""; findInput.focus(); } }
  if (helpEl) helpEl.addEventListener("click", function () { toggleModal(true); });
  var menuBtn = document.getElementById("lf-menu");
  if (menuBtn) menuBtn.addEventListener("click", function () {
    if (root.classList.contains("lf-menuopen")) closeMenu(); else openMenu();
  });
  // mobile directory nav buttons: ← up a dir, ~ home (same targets as h / goHome)
  var updirBtn = document.getElementById("lf-updir");
  if (updirBtn) updirBtn.addEventListener("click", function (ev) { ev.preventDefault(); goUp(); });
  var gohomeBtn = document.getElementById("lf-gohome");
  if (gohomeBtn) gohomeBtn.addEventListener("click", function (ev) { ev.preventDefault(); goHome(); });
  if (findInput) {
    findInput.addEventListener("input", function () { var hit = matchFrom(0, 1, findInput.value); if (hit !== -1) setCursor(hit); });
    findInput.addEventListener("keydown", function (ev) {
      ev.stopPropagation();  // typed letters are search text, not nav keys
      if (ev.key === "Enter") { open(cursor); ev.preventDefault(); }
      else if (ev.key === "Escape") { closeMenu(); ev.preventDefault(); }
    });
  }
  // The menu stays open on every selection — only ✕ or a tap outside closes it.
  Array.prototype.slice.call(document.querySelectorAll(".lf-statusmenu .lf-menu-item")).forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-view");
      if (v) { menuView(v); return; }                              // find/sort/show ⇄ sub-menu / back
      var s = b.getAttribute("data-sort");
      if (s) { setSort(s); refreshMenu(); return; }                // sort
      var ib = b.getAttribute("data-info");
      if (ib) {                                                    // info detail: independent toggle
        var hasS = infoMode.indexOf("size") !== -1, hasT = infoMode.indexOf("time") !== -1;
        if (ib === "size") hasS = !hasS; else hasT = !hasT;
        setInfo(hasS && hasT ? "size:time" : hasS ? "size" : hasT ? "time" : "");
        refreshMenu(); return;
      }
      var act = b.getAttribute("data-act");
      if (act === "find") enterFind();
      else if (act === "hidden") { toggleHidden(); refreshMenu(); }
      else if (act === "reverse") { toggleReverse(); refreshMenu(); }   // asc ⇄ desc
    });
  });
  // tap outside the open menu (and not the ✕ button) closes it — capture phase so
  // the first outside tap just dismisses, without also triggering what was tapped.
  document.addEventListener("click", function (ev) {
    if (!root.classList.contains("lf-menuopen")) return;
    if (ev.target.closest(".lf-statusmenu") || ev.target.closest(".lf-help")) return;
    ev.preventDefault(); ev.stopPropagation();
    closeMenu();
  }, true);

  /* ── toggle hidden (zh) ────────────────────────────────────────────── */
  // Persisted (sessionStorage) so it carries across navigation in this tab —
  // every column move / folder change is a full page load.
  function applyHidden(state, persist) {
    showHidden = state;
    root.classList.toggle("lf--show-hidden", showHidden);
    if (persist) sset("lf:hidden", state ? "1" : "0");
    // If we just hid the entry under the cursor, move to the nearest visible one.
    if (!visible(cursor)) {
      var n = stepVisible(cursor, 1);
      if (n === cursor) n = stepVisible(cursor, -1);
      setCursor(n);
    } else {
      updateStatus();
    }
  }
  function toggleHidden() { applyHidden(!showHidden, true); }

  /* ── sort & info (lf's sortby / set info / reverse, persisted) ─────── */
  // A directory can set its own default order in front matter (sortby/reverse,
  // rendered server-side and mirrored in data-sort-default/-reverse-default).
  // Until the user explicitly picks a sort, the server order is authoritative
  // for every column — the defaults below only exist so the menu reads right.
  var userSorted = sget("lf:sort") !== null || sget("lf:reverse") !== null;
  var sortKey   = sget("lf:sort") || root.getAttribute("data-sort-default") || "natural";
  var reverseOn = sget("lf:reverse") !== null ? sget("lf:reverse") === "1"
                                              : root.getAttribute("data-reverse-default") === "1";
  var infoMode  = sget("lf:info"); if (infoMode === null) infoMode = "time";   // time (date) on by default

  function num(el, a) { return parseFloat(el.getAttribute(a)) || 0; }
  function ext(n) { var i = (n || "").lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; }
  function entryCmp(a, b) {
    if (sortKey === "size") return num(a, "data-size") - num(b, "data-size");
    if (/time/.test(sortKey)) return num(a, "data-time") - num(b, "data-time");  // atime/btime/ctime share the date
    var na = a.getAttribute("data-name") || "", nb = b.getAttribute("data-name") || "";
    if (sortKey === "ext") { var ea = ext(na), eb = ext(nb); if (ea !== eb) return ea < eb ? -1 : 1; }
    return na.localeCompare(nb, undefined, { numeric: true });  // natural
  }
  // dirfirst, then the sort key, then reverse — for any <li> carrying the data-*
  function cmpLi(a, b) {
    var ad = a.getAttribute("data-dir") === "1", bd = b.getAttribute("data-dir") === "1";
    if (ad !== bd) return ad ? -1 : 1;               // dirfirst (lf default)
    return entryCmp(a, b) * (reverseOn ? -1 : 1);
  }
  // reorder a <ul>'s direct <li> children in place
  function sortLis(ul) {
    if (!ul) return;
    var lis = Array.prototype.slice.call(ul.children);
    lis.sort(cmpLi);
    for (var i = 0; i < lis.length; i++) ul.appendChild(lis[i]);
  }
  // the current pane, keeping each entry's preview index-aligned for showPreview
  function applySort() {
    if (!list) return;
    var lfPrev = document.getElementById("lf-preview"), cur = entries[cursor];
    var pairs = entries.map(function (li, i) { return { li: li, prev: previews[i] }; });
    pairs.sort(function (x, y) { return cmpLi(x.li, y.li); });
    // skip the DOM reparenting when nothing moved — the common case, since the
    // server already emits dirfirst + natural order, so the default sort is a no-op
    var moved = false;
    for (var i = 0; i < pairs.length; i++) { if (pairs[i].li !== entries[i]) { moved = true; break; } }
    if (!moved) return;
    pairs.forEach(function (p) { list.appendChild(p.li); if (p.prev && lfPrev) lfPrev.appendChild(p.prev); });
    entries = pairs.map(function (p) { return p.li; });
    previews = pairs.map(function (p) { return p.prev; });
    cursor = entries.indexOf(cur); if (cursor < 0) cursor = 0;
  }
  // the other visible columns: the parent pane and every preview's listing
  // (desktop shows all three; on mobile the preview is hidden, so this is a no-op
  // there visually — still cheap, only directory previews have a list)
  function sortColumns() {
    sortLis(document.querySelector(".lf-parent .lf-list"));
    var dl = document.querySelectorAll("#lf-preview .lf-dirprev-list");
    for (var i = 0; i < dl.length; i++) sortLis(dl[i]);
  }
  function applyInfoClass() {
    var hasS = /size/.test(infoMode), hasT = /time/.test(infoMode);
    root.classList.remove("lf--info-size", "lf--info-time", "lf--info-both", "lf--info-none");
    root.classList.add(hasS && hasT ? "lf--info-both" : hasS ? "lf--info-size" : hasT ? "lf--info-time" : "lf--info-none");
  }
  // An explicit choice snapshots BOTH keys, so the session sort behaves the
  // same in every directory afterwards regardless of per-dir defaults.
  function sortChosen() { userSorted = true; sset("lf:sort", sortKey); sset("lf:reverse", reverseOn ? "1" : "0"); }
  function setSort(key) { sortKey = key; sortChosen(); applySort(); sortColumns(); setCursor(cursor); updateWillSelect(); }
  function toggleReverse() { reverseOn = !reverseOn; sortChosen(); applySort(); sortColumns(); setCursor(cursor); updateWillSelect(); }
  function setInfo(mode) { infoMode = mode; sset("lf:info", mode); applyInfoClass(); }
  function toggleMark() { if (entries[cursor]) entries[cursor].classList.toggle("lf-marked"); }
  function goHome() { window.location.href = "/"; }

  /* ── pointer interaction ───────────────────────────────────────────── */
  // Single click bumps you into the next column (Miller-columns style).
  // The selection only changes on click — never on hover.
  entries.forEach(function (el) {
    // navigate by the element's own href, so it survives re-sorting.
    // Modified clicks (cmd/ctrl/shift — open in new tab/window) keep the
    // browser's native behaviour on the entry's real <a>.
    el.addEventListener("click", function (ev) {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      navTo(el);
    });
    // prefetch on hover (does not change the selection) for instant opens
    el.addEventListener("mouseenter", function () { prefetch(el.getAttribute("data-href")); });
  });

  /* ── keyboard ──────────────────────────────────────────────────────── */
  // multi-key prefixes (g…, z…, s…), lf-style
  var prefix = "";
  function setPrefix(k) { prefix = k; setTimeout(function () { prefix = ""; }, 600); }
  function handlePrefix(p, key) {
    if (p === "g") {                                    // gg top, gh cd ~
      if (key === "g") { setCursor(firstVisible()); return true; }
      if (key === "h") { goHome(); return true; }
    } else if (p === "z") {                             // hidden / reverse / info
      if (key === "h") { toggleHidden(); return true; }
      if (key === "r") { toggleReverse(); return true; }
      if (key === "n") { setInfo(""); return true; }
      if (key === "s") { setInfo("size"); return true; }
      if (key === "t") { setInfo("time"); return true; }
      if (key === "a") { setInfo("size:time"); return true; }
    } else if (p === "s") {                             // sortby (+ matching info)
      if (key === "n") { setSort("natural"); setInfo("time"); return true; }
      if (key === "s") { setSort("size"); setInfo("size"); return true; }
      if (key === "t") { setSort("time"); setInfo("time"); return true; }
      if (key === "a") { setSort("atime"); setInfo("time"); return true; }
      if (key === "b") { setSort("btime"); setInfo("time"); return true; }
      if (key === "c") { setSort("ctime"); setInfo("time"); return true; }
      if (key === "e") { setSort("ext"); setInfo("time"); return true; }
    }
    return false;
  }

  document.addEventListener("keydown", function (ev) {
    // Let the browser handle modified chords (copy, open-in-tab, etc.).
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    // Modal captures everything until dismissed.
    if (modal && !modal.hidden) {
      if (ev.key === "Escape" || ev.key === "q" || ev.key === "?") { toggleModal(false); ev.preventDefault(); }
      return;
    }

    // Search mode: type to filter, Enter/Esc to leave.
    if (searching) {
      if (ev.key === "Escape") { exitSearch(false); ev.preventDefault(); }
      else if (ev.key === "Enter") { exitSearch(true); ev.preventDefault(); }
      else if (ev.key === "Backspace") { term = term.slice(0, -1); renderTerm(); searchJump(); ev.preventDefault(); }
      else if (ev.key.length === 1) { term += ev.key; renderTerm(); searchJump(); ev.preventDefault(); }
      return;
    }

    // resolve a pending prefix; if unhandled, fall through to the normal keys
    if (prefix) {
      var p = prefix; prefix = "";
      if (handlePrefix(p, ev.key)) { ev.preventDefault(); return; }
    }

    switch (ev.key) {
      case "j": case "ArrowDown": setCursor(stepVisible(cursor, 1)); ev.preventDefault(); break;
      case "k": case "ArrowUp":   setCursor(stepVisible(cursor, -1)); ev.preventDefault(); break;
      case "l": case "ArrowRight": case "Enter": open(cursor); ev.preventDefault(); break;
      case "h": case "ArrowLeft": goUp(); ev.preventDefault(); break;
      case "G": setCursor(lastVisible()); ev.preventDefault(); break;
      case "g": case "z": case "s": setPrefix(ev.key); ev.preventDefault(); break;
      case " ": toggleMark(); setCursor(stepVisible(cursor, 1)); ev.preventDefault(); break;
      case "/": enterSearch(); ev.preventDefault(); break;
      case "n": if (lastTerm) { var f = matchFrom(cursor + 1, 1, lastTerm); if (f !== -1) setCursor(f); ev.preventDefault(); } break;
      case "N": if (lastTerm) { var b = matchFrom(cursor - 1, -1, lastTerm); if (b !== -1) setCursor(b); ev.preventDefault(); } break;
      case "T": toggleTheme(); ev.preventDefault(); break;
      case "?": toggleModal(true); ev.preventDefault(); break;
      default: break;
    }
  });

  // Returning to a parent via `h`: put the cursor back on the folder we came
  // from (passed in #from=) rather than the server default at the top.
  var restored = false;
  var fromMatch = location.hash.match(/(?:^#|&)from=([^&]*)/);
  if (fromMatch) {
    var fromHref = decodeURIComponent(fromMatch[1]), bestLen = -1;
    // match the entry we came from — exactly, or the child folder that leads to
    // it, so a breadcrumb jump from deep in the tree lands on the right one.
    for (var fi = 0; fi < entries.length; fi++) {
      var eh = entries[fi].getAttribute("data-href") || "";
      if (eh && fromHref.indexOf(eh) === 0 && eh.length > bestLen) { cursor = fi; restored = true; bestLen = eh.length; }
    }
    history.replaceState(null, "", location.pathname + location.search);
  }

  // Otherwise, restore the cursor to where we last were in this directory.
  if (!restored && pos[here]) {
    for (var pi = 0; pi < entries.length; pi++) {
      if (entries[pi].getAttribute("data-href") === pos[here]) { cursor = pi; restored = true; break; }
    }
  }

  // Restore the hidden setting so it carries across navigation (this session).
  if (sget("lf:hidden") === "1") { showHidden = true; root.classList.add("lf--show-hidden"); }

  // If we landed directly on a hidden page, reveal hidden entries so the
  // cursor (which sits on that page) is actually visible.
  if (entryHidden(cursor) && !showHidden) applyHidden(true, true);

  // Apply the persisted sort + info mode (reorders the pane, keeps cursor).
  // No explicit user sort → leave every column in its server order (each
  // directory may carry its own front-matter default).
  applyInfoClass();
  if (userSorted) {
    applySort();
    sortColumns();   // parent pane + previews match the current pane's sort
  }
  // Reflect the chosen selection (scroll it into view when we restored one).
  setCursor(cursor, { noScroll: !restored });
  // Underline each directory's preview at the entry you last left on.
  updateWillSelect();
  // Warm the parent so going up (h) is as fast as going in (l), which is
  // already prefetched as the cursor moves.
  prefetch(upHref);
  // On mobile there's no cursor-hover to warm the next page and every tap is a
  // full load, so it feels slower — eagerly prefetch this directory's entries
  // (capped) so the likely next tap is already cached.
  if (mqMobile.matches) {
    requestAnimationFrame(function () {
      for (var pf = 0; pf < entries.length && pf < 16; pf++) {
        prefetch(entries[pf].getAttribute("data-href"));
      }
    });
  }
  // Reveal the cursor now that it's positioned (see html.js rule in lf.css).
  root.classList.add("lf-ready");
  // re-fit the mobile status once layout has settled (the breadcrumb is handled
  // by the universal condensePath wired near the top)
  if (window.requestAnimationFrame) requestAnimationFrame(updateStatus);
})();
