// In-browser QR scanner for the QR Info static site.
//
// Full-screen camera scanning, started on load and via the "Skanna ny kod"
// button. On a hit the camera STOPS and the destination is shown (no inline
// camera). A "Koder" button opens a grid of previously-scanned codes (stored on
// this device) as thumbnails — the Wikipedia lead image for external articles,
// or the first /info/images/<target>_N.jpg for internal taxa; tapping one
// re-opens it.
//
// Wikipedia targets are rendered as a custom image-first page from the
// Wikipedia REST API. Other external targets are shown in an iframe; internal
// codes load /info/<target>.html. Codes are identified by the pair
// (customerId, qid), carried in the URL as /q/<customerId>/<qid> and used here
// as the string id "<customerId>-<qid>". Resolution is client-side against the
// published /codes.json (id → label + target).

(function () {
  "use strict";

  // Matches a code id "<customerId>-<qid>" (both positive integers).
  var VALID_ID = /^[1-9][0-9]*-[1-9][0-9]*$/;
  // Ignore a repeat decode of the same id within this window.
  var REPEAT_MS = 2000;
  var HISTORY_KEY = "qrinfo.history.v1";
  var HISTORY_MAX = 60;

  var els = {
    status: document.getElementById("status"),
    video: document.getElementById("video"),
    overlay: document.getElementById("overlay"),
    scanNew: document.getElementById("scanNew"),
    showHistory: document.getElementById("showHistory"),
    dest: document.getElementById("dest"),
    label: document.getElementById("label"),
    close: document.getElementById("close"),
    frame: document.getElementById("frame"),
    wiki: document.getElementById("wiki"),
    wikiHero: document.getElementById("wikiHero"),
    wikiTitle: document.getElementById("wikiTitle"),
    wikiSummary: document.getElementById("wikiSummary"),
    wikiReadMore: document.getElementById("wikiReadMore"),
    wikiMore: document.getElementById("wikiMore"),
    wikiCredit: document.getElementById("wikiCredit"),
    history: document.getElementById("history"),
    historyGrid: document.getElementById("historyGrid"),
    historyClose: document.getElementById("historyClose"),
    historyEditBar: document.getElementById("historyEditBar"),
    historySave: document.getElementById("historySave"),
    historyCancel: document.getElementById("historyCancel"),
  };

  var codesById = {};
  var last = { id: null, at: 0 };
  var wikiReq = 0; // guards against a slow fetch landing after the view changed

  // Delete mode: true while the user is marking history cards for removal.
  // markedIds holds the code ids tapped for deletion; nothing is persisted until
  // they press "Spara" (cancel/close discards the marks).
  var deleting = false;
  var markedIds = {};

  var reader = null; // BrowserMultiFormatReader (ZXing fallback)
  var controls = null; // active camera controls (.stop())
  var scanning = false;

  // Native BarcodeDetector path. When available (Android Chrome, etc.) this taps
  // the platform's hardware-backed detector — the same engine the phone's camera
  // app uses — which reads low-contrast / colored codes far better than ZXing's
  // pure-JS luminance binarizer. iOS Safari lacks it, so we fall back to ZXing.
  var nativeStream = null; // MediaStream held open by the native path
  var nativeRAF = 0; // requestAnimationFrame handle for the native scan loop

  // ZXing's TRY_HARDER decode hint (DecodeHintType.TRY_HARDER === 3 in
  // @zxing/library). Passed to the reader so the JS fallback spends more effort
  // per frame (extra thresholds/rotations) on marginal colored codes.
  var ZXING_TRY_HARDER = 3;

  els.close.addEventListener("click", function () { closeViews(); startScanner(); });
  els.historyClose.addEventListener("click", function () { closeViews(); startScanner(); });
  els.scanNew.addEventListener("click", function () { closeViews(); startScanner(); });
  els.showHistory.addEventListener("click", openHistory);
  els.historySave.addEventListener("click", commitDelete);
  els.historyCancel.addEventListener("click", cancelDelete);

  function setStatus(msg) { els.status.textContent = msg; }

  function showOverlay(msg) {
    els.overlay.textContent = msg;
    els.overlay.classList.remove("hidden");
  }

  /** Pull a qrinfo code id ("<customerId>-<qid>") out of a decoded QR string,
   *  or null if it isn't one. Accepts a bare id or a /q/<customerId>/<qid> URL. */
  function extractId(raw) {
    var text = (raw || "").trim();
    if (VALID_ID.test(text)) return text; // bare id
    try {
      var u = new URL(text);
      var m = u.pathname.match(/\/q\/([1-9][0-9]*)\/([1-9][0-9]*)\/?$/);
      if (m) return m[1] + "-" + m[2];
    } catch (e) { /* not a URL */ }
    return null;
  }

  // ---- camera control -------------------------------------------------------

  function stopCamera() {
    if (controls) { try { controls.stop(); } catch (e) {} controls = null; }
    if (nativeRAF) { cancelAnimationFrame(nativeRAF); nativeRAF = 0; }
    if (nativeStream) {
      try { nativeStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      nativeStream = null;
      try { els.video.srcObject = null; } catch (e) {}
    }
    scanning = false;
  }

  // True when the platform exposes a usable BarcodeDetector for QR codes.
  function hasNativeDetector() {
    return typeof window.BarcodeDetector === "function";
  }

  // Close any open destination/history view and reveal the camera area.
  function closeViews() {
    wikiReq++; // invalidate any in-flight wiki fetch
    exitDeleteMode(); // discard any pending marks when leaving the history
    els.dest.classList.add("hidden");
    els.dest.classList.remove("is-wiki");
    els.frame.src = "about:blank";
    document.body.classList.remove("history-open");
    document.body.classList.remove("viewing");
    last = { id: null, at: 0 };
  }

  /** String id "<customerId>-<qid>" for a code/registry/history entry. */
  function idOf(code) {
    return code.customerId + "-" + code.qid;
  }

  // Map a getUserMedia / scanner startup error to a user-facing overlay.
  function reportCameraError(err) {
    scanning = false;
    var name = err && err.name;
    if (name === "NotAllowedError") {
      showOverlay("Kameraåtkomst nekades. Tillåt kameran och ladda om sidan.");
    } else if (name === "NotFoundError") {
      showOverlay("Ingen kamera hittades på den här enheten.");
    } else {
      showOverlay("Kunde inte starta kameran.");
    }
    setStatus("Kameran kunde inte startas.");
  }

  // Feed a decoded QR string through the id pipeline, reporting non-qrinfo
  // codes. Shared by the native and ZXing scan paths.
  function onDecoded(text) {
    var id = extractId(text);
    if (id) {
      handleId(id);
    } else {
      setStatus("Den här koden hör inte till QR Info.");
    }
  }

  function startScanner() {
    if (scanning) return;
    if (!window.isSecureContext) {
      showOverlay("Kameran kräver en säker anslutning (HTTPS).");
      setStatus("Kameran är blockerad.");
      return;
    }
    els.overlay.classList.add("hidden");
    setStatus("Rikta kameran mot en QR-kod…");

    // Prefer the platform detector; only fall back to ZXing when it's missing.
    if (hasNativeDetector()) {
      startNativeScanner();
    } else {
      startZxingScanner();
    }
  }

  // Native BarcodeDetector loop: open the rear camera ourselves, then sample
  // video frames on each animation frame and ask the platform to detect QR
  // codes. Reads colored / low-contrast codes that defeat the JS fallback.
  function startNativeScanner() {
    var detector;
    try {
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) {
      startZxingScanner(); // formats unsupported — let ZXing try
      return;
    }
    scanning = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(function (stream) {
        if (!scanning) { // stopped while permission was pending
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        nativeStream = stream;
        els.video.srcObject = stream;
        els.video.setAttribute("playsinline", "true");
        return els.video.play().catch(function () {}); // autoplay may resolve late
      })
      .then(function () {
        if (scanning && nativeStream) scanNativeFrame(detector);
      })
      .catch(reportCameraError);
  }

  function scanNativeFrame(detector) {
    if (!scanning || !nativeStream) return;
    detector
      .detect(els.video)
      .then(function (codes) {
        if (codes && codes.length) onDecoded(codes[0].rawValue);
      })
      .catch(function () { /* transient frame error — keep going */ })
      .finally(function () {
        if (scanning && nativeStream) {
          nativeRAF = requestAnimationFrame(function () { scanNativeFrame(detector); });
        }
      });
  }

  // ZXing fallback (iOS Safari and any browser without BarcodeDetector). The
  // TRY_HARDER hint trades CPU for a better shot at marginal colored codes.
  function startZxingScanner() {
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
      showOverlay("Kunde inte ladda skannern.");
      return;
    }
    if (!reader) {
      var hints = new Map();
      hints.set(ZXING_TRY_HARDER, true);
      reader = new window.ZXingBrowser.BrowserMultiFormatReader(hints);
    }
    scanning = true;

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        els.video,
        function (result) {
          if (result) onDecoded(result.getText());
        }
      )
      .then(function (c) { controls = c; })
      .catch(reportCameraError);
  }

  function handleId(id) {
    var now = Date.now();
    if (last.id === id && now - last.at < REPEAT_MS) return;
    last = { id: id, at: now };

    var code = codesById[id];
    if (!code || code.enabled === false) {
      setStatus("Den här koden finns inte eller är avstängd.");
      return;
    }
    stopCamera(); // a hit opens a page; no inline camera
    recordHistory(code);
    showDestination(code);
  }

  // ---- history (this device) ------------------------------------------------

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // Move/insert this code at the front of the history (most-recent first),
  // preserving any cached thumbnail we fetched earlier.
  function recordHistory(code) {
    var id = idOf(code);
    var list = loadHistory();
    var prev = null;
    list = list.filter(function (h) {
      if (h.id === id) { prev = h; return false; }
      return true;
    });
    list.unshift({
      id: id,
      customerId: code.customerId,
      qid: code.qid,
      label: code.label || id,
      type: code.type,
      target: code.target,
      thumb: prev && prev.thumb ? prev.thumb : null,
    });
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
  }

  // Persist a fetched thumbnail URL for a code id so the grid is instant next time.
  function cacheThumb(id, url) {
    if (!url) return;
    var list = loadHistory();
    var changed = false;
    list.forEach(function (h) {
      if (h.id === id && h.thumb !== url) { h.thumb = url; changed = true; }
    });
    if (changed) saveHistory(list);
  }

  function openHistory() {
    stopCamera();
    document.body.classList.add("viewing");
    document.body.classList.add("history-open");
    renderHistory();
  }

  function renderHistory() {
    var list = loadHistory();
    els.historyGrid.innerHTML = "";
    if (!list.length) {
      exitDeleteMode();
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Inga skannade koder än. Tryck “Skanna ny kod”.";
      els.historyGrid.appendChild(empty);
      return;
    }
    list.forEach(function (h) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      if (markedIds[h.id]) card.classList.add("marked");

      var img = document.createElement("img");
      img.className = "thumb";
      img.alt = h.label;
      img.loading = "lazy";
      if (h.thumb) {
        img.src = h.thumb;
      } else {
        fetchThumb(h, img); // lazily resolve a thumbnail
      }

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = h.label;

      var overlay = document.createElement("span");
      overlay.className = "del-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.appendChild(trashIcon());

      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(overlay);
      card.addEventListener("click", function () {
        // In delete mode a tap toggles this card's removal mark instead of
        // opening it. Nothing is persisted until "Spara".
        if (deleting) {
          if (markedIds[h.id]) delete markedIds[h.id];
          else markedIds[h.id] = true;
          card.classList.toggle("marked");
          return;
        }
        var code = codesById[h.id] || h;
        closeViews();
        stopCamera();
        document.body.classList.add("viewing");
        recordHistory(code);
        showDestination(code);
      });
      els.historyGrid.appendChild(card);
    });

    // Trash toggle: a card at the end of the grid that enters/exits delete mode.
    var trash = document.createElement("button");
    trash.type = "button";
    trash.className = "card trash";
    trash.setAttribute("aria-label", deleting ? "Avsluta radering" : "Radera koder");
    trash.appendChild(trashIcon());
    trash.addEventListener("click", function () {
      if (deleting) cancelDelete(); // re-tap discards marks and leaves the mode
      else enterDeleteMode();
    });
    els.historyGrid.appendChild(trash);
  }

  // ---- delete mode ----------------------------------------------------------

  // A classic wastebasket icon (lid + handle + ribbed can) as a fresh inline
  // SVG. Returns a new node each call since the same element can't be reused in
  // two places. Color comes from the CSS `fill: currentColor`.
  function trashIcon() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "trash-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    var path = document.createElementNS(NS, "path");
    // Lid (with handle tab) + can body with three ribs.
    path.setAttribute(
      "d",
      "M9 3a1 1 0 0 0-1 1v1H4a1 1 0 0 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 " +
      "2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zM9 9a1 1 0 0 " +
      "1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm3 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 " +
      "0v-7a1 1 0 0 1 1-1zm3 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1z"
    );
    svg.appendChild(path);
    return svg;
  }

  function enterDeleteMode() {
    deleting = true;
    markedIds = {};
    document.body.classList.add("history-deleting");
    els.historyEditBar.classList.remove("hidden");
    renderHistory();
  }

  // Leave delete mode and discard any pending marks (used by Ångra and on close).
  function exitDeleteMode() {
    deleting = false;
    markedIds = {};
    document.body.classList.remove("history-deleting");
    els.historyEditBar.classList.add("hidden");
  }

  // "Ångra": discard any pending marks and close the history without changes.
  // (closeViews calls exitDeleteMode, dropping the marks.)
  function cancelDelete() {
    closeViews();
    startScanner();
  }

  // "Släng": forget every marked code, then close the history.
  function commitDelete() {
    var list = loadHistory().filter(function (h) { return !markedIds[h.id]; });
    saveHistory(list);
    closeViews(); // also exits delete mode
    startScanner();
  }

  // Resolve a thumbnail for a history card. Internal taxon pages keep their
  // images under /info/images/<target>_1.jpg, so use the first one directly.
  // Otherwise fall back to the Wikipedia summary image. Either way we cache the
  // resolved URL so future opens are instant.
  function fetchThumb(h, img) {
    if (h.type === "internal" && h.target) {
      var src = "/info/images/" + h.target + "_1.jpg";
      img.onload = function () { img.onload = null; cacheThumb(h.id, src); };
      img.onerror = function () { img.onerror = null; }; // leave placeholder
      img.src = src;
      return;
    }
    var article = wikiArticle(h.target);
    if (!article) return;
    fetch(summaryApi(article), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var src = data.thumbnail || data.originalimage;
        if (src && src.source) {
          img.src = src.source;
          cacheThumb(h.id, src.source);
        }
      })
      .catch(function () { /* leave placeholder */ });
  }

  // ---- Wikipedia article ----------------------------------------------------

  // Parse a Wikipedia article URL into { lang, title } if it is one, else null.
  function wikiArticle(raw) {
    try {
      var u = new URL(raw);
      var host = u.hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/);
      var path = u.pathname.match(/^\/wiki\/(.+)$/);
      if (host && path) {
        return { lang: host[1], title: decodeURIComponent(path[1]) };
      }
    } catch (e) { /* not a URL */ }
    return null;
  }

  function summaryApi(article) {
    return (
      "https://" + article.lang + ".wikipedia.org/api/rest_v1/page/summary/" +
      encodeURIComponent(article.title.replace(/ /g, "_"))
    );
  }

  // Render the image-first Wikipedia view from the REST summary API, then lazily
  // fetch the fuller extract behind a "Läs mer" button.
  function showWikipedia(code, article) {
    var token = ++wikiReq;

    els.wikiHero.hidden = true;
    els.wikiHero.removeAttribute("src");
    els.wikiTitle.textContent = code.label || article.title.replace(/_/g, " ");
    els.wikiSummary.textContent = "Laddar…";
    els.wikiMore.textContent = "";
    els.wikiReadMore.classList.add("hidden");
    els.wikiCredit.textContent = "";
    els.wiki.scrollTop = 0;

    els.dest.classList.add("is-wiki");
    els.dest.classList.remove("hidden");
    document.body.classList.add("viewing");
    setStatus("Visar: " + (code.label || idOf(code)));

    fetch(summaryApi(article), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (token !== wikiReq) return; // user moved on
        els.wikiTitle.textContent = data.title || els.wikiTitle.textContent;
        els.wikiSummary.textContent = data.extract || "";
        var img = data.originalimage || data.thumbnail;
        if (img && img.source) {
          els.wikiHero.src = img.source;
          els.wikiHero.alt = data.title || "";
          els.wikiHero.hidden = false;
        }
        if (data.thumbnail && data.thumbnail.source) {
          cacheThumb(idOf(code), data.thumbnail.source);
        }
        var pageUrl =
          (data.content_urls &&
            data.content_urls.desktop &&
            data.content_urls.desktop.page) ||
          code.target;
        els.wikiCredit.innerHTML =
          'Källa: <a href="' + pageUrl +
          '" target="_blank" rel="noopener noreferrer">Wikipedia</a>';
        wireReadMore(token, article, pageUrl);
      })
      .catch(function () {
        if (token !== wikiReq) return;
        els.wikiSummary.textContent = "Kunde inte ladda artikeln just nu.";
      });
  }

  // "Läs mer" pulls the plain-text intro section(s) so the user can scroll past
  // the summary into the article without leaving our styled page.
  function wireReadMore(token, article, pageUrl) {
    els.wikiReadMore.classList.remove("hidden");
    els.wikiReadMore.disabled = false;
    els.wikiReadMore.textContent = "Läs mer ↓";
    els.wikiReadMore.onclick = function () {
      els.wikiReadMore.disabled = true;
      els.wikiReadMore.textContent = "Laddar…";
      var api =
        "https://" + article.lang +
        ".wikipedia.org/w/api.php?origin=*&format=json&action=query" +
        "&prop=extracts&explaintext=1&redirects=1&titles=" +
        encodeURIComponent(article.title);
      fetch(api)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (token !== wikiReq) return;
          var pages = (data.query && data.query.pages) || {};
          var key = Object.keys(pages)[0];
          var text = key ? pages[key].extract : "";
          renderExtract(text);
        })
        .catch(function () {
          if (token !== wikiReq) return;
          els.wikiMore.innerHTML =
            '<p>Kunde inte ladda mer. ' +
            '<a href="' + pageUrl +
            '" target="_blank" rel="noopener noreferrer">Öppna på Wikipedia ↗</a></p>';
        })
        .finally(function () {
          els.wikiReadMore.classList.add("hidden");
        });
    };
  }

  // Turn the plain-text extract into paragraphs. We skip the lead (already shown
  // as the summary) by dropping the first blank-line-separated block.
  function renderExtract(text) {
    var blocks = (text || "").split(/\n{2,}/).map(function (s) { return s.trim(); });
    var rest = blocks.slice(1).filter(Boolean);
    if (!rest.length) { rest = blocks.filter(Boolean); }
    els.wikiMore.innerHTML = "";
    rest.forEach(function (para) {
      var p = document.createElement("p");
      p.textContent = para;
      els.wikiMore.appendChild(p);
    });
  }

  function showDestination(code) {
    var external = code.type === "external";
    els.label.textContent = code.label || idOf(code);

    if (external) {
      var article = wikiArticle(code.target);
      if (article) {
        showWikipedia(code, article);
        return;
      }
    }

    // Non-Wikipedia: internal info page or a plain external site in an iframe.
    // Internal codes are served as a static page at /info/<target>.html (the
    // build validates that file exists). Loading /q/<customerId>/<qid> here would
    // redirect back to scan.html and loop.
    wikiReq++; // not a wiki view
    els.dest.classList.remove("is-wiki");
    els.frame.src = external ? code.target : "/info/" + code.target + ".html";
    els.dest.classList.remove("hidden");
    document.body.classList.add("viewing");
    setStatus("Visar: " + (code.label || idOf(code)));
  }

  // Release the camera when the page is hidden/navigated away.
  window.addEventListener("pagehide", stopCamera);

  // Code id from ?c=<customerId>&q=<qid> — set when a printed code's
  // /q/<customerId>/<qid> redirected here. We open that destination immediately
  // (same in-page view as a 2nd scan) instead of starting the camera.
  function entryId() {
    try {
      var params = new URL(window.location.href).searchParams;
      var c = params.get("c");
      var q = params.get("q");
      var id = c && q ? c + "-" + q : null;
      return id && VALID_ID.test(id) ? id : null;
    } catch (e) { return null; }
  }

  // Load the published code registry, then either open the entry code or start
  // the camera.
  fetch("/codes.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      (data.codes || []).forEach(function (c) { codesById[idOf(c)] = c; });
    })
    .catch(function () { /* registry unavailable — scanner still runs, just no matches */ })
    .finally(function () {
      var id = entryId();
      var code = id && codesById[id];
      if (code && code.enabled !== false) {
        // Arrived from a printed code: show the page, camera stays off until
        // the user taps "Skanna ny kod".
        document.body.classList.add("viewing");
        recordHistory(code);
        showDestination(code);
      } else {
        startScanner();
      }
    });
})();
