// In-browser QR scanner for the QR Info static site.
//
// Full-screen camera scanning, started on load and via the "Skanna ny kod"
// button. On a hit the camera STOPS and the destination is shown (no inline
// camera). A "Koder" button opens a grid of previously-scanned codes (stored on
// this device) as Wikipedia-image thumbnails; tapping one re-opens it.
//
// Wikipedia targets are rendered as a custom image-first page from the
// Wikipedia REST API. Other external targets are shown in an iframe; internal
// codes load /q/<slug>. Resolution is client-side against the published
// /codes.json (slug → label + target).

(function () {
  "use strict";

  // Same allowlist the rest of the system uses for /q/<slug>.
  var VALID_CODE = /^[a-z0-9]{4,16}$/;
  // Ignore a repeat decode of the same slug within this window.
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
  };

  var codesBySlug = {};
  var last = { slug: null, at: 0 };
  var wikiReq = 0; // guards against a slow fetch landing after the view changed

  var reader = null; // BrowserMultiFormatReader
  var controls = null; // active camera controls (.stop())
  var scanning = false;

  els.close.addEventListener("click", function () { closeViews(); startScanner(); });
  els.historyClose.addEventListener("click", function () { closeViews(); startScanner(); });
  els.scanNew.addEventListener("click", function () { closeViews(); startScanner(); });
  els.showHistory.addEventListener("click", openHistory);

  function setStatus(msg) { els.status.textContent = msg; }

  function showOverlay(msg) {
    els.overlay.textContent = msg;
    els.overlay.classList.remove("hidden");
  }

  /** Pull a qrinfo slug out of a decoded QR string, or null if it isn't one. */
  function extractSlug(raw) {
    var text = (raw || "").trim();
    if (VALID_CODE.test(text)) return text; // bare slug
    try {
      var u = new URL(text);
      var m = u.pathname.match(/\/q\/([a-z0-9]{4,16})\/?$/);
      if (m) return m[1];
    } catch (e) { /* not a URL */ }
    return null;
  }

  // ---- camera control -------------------------------------------------------

  function stopCamera() {
    if (controls) { try { controls.stop(); } catch (e) {} controls = null; }
    scanning = false;
  }

  // Close any open destination/history view and reveal the camera area.
  function closeViews() {
    wikiReq++; // invalidate any in-flight wiki fetch
    els.dest.classList.add("hidden");
    els.dest.classList.remove("is-wiki");
    els.frame.src = "about:blank";
    document.body.classList.remove("history-open");
    document.body.classList.remove("viewing");
    last = { slug: null, at: 0 };
  }

  function startScanner() {
    if (scanning) return;
    if (!window.isSecureContext) {
      showOverlay("Kameran kräver en säker anslutning (HTTPS).");
      setStatus("Kameran är blockerad.");
      return;
    }
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
      showOverlay("Kunde inte ladda skannern.");
      return;
    }
    els.overlay.classList.add("hidden");
    if (!reader) reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    scanning = true;
    setStatus("Rikta kameran mot en QR-kod…");

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        els.video,
        function (result) {
          if (!result) return;
          var slug = extractSlug(result.getText());
          if (slug) {
            handleSlug(slug);
          } else {
            setStatus("Den här koden hör inte till QR Info.");
          }
        }
      )
      .then(function (c) { controls = c; })
      .catch(function (err) {
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
      });
  }

  function handleSlug(slug) {
    var now = Date.now();
    if (last.slug === slug && now - last.at < REPEAT_MS) return;
    last = { slug: slug, at: now };

    var code = codesBySlug[slug];
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
    var list = loadHistory();
    var prev = null;
    list = list.filter(function (h) {
      if (h.slug === code.slug) { prev = h; return false; }
      return true;
    });
    list.unshift({
      slug: code.slug,
      label: code.label || code.slug,
      type: code.type,
      target: code.target,
      thumb: prev && prev.thumb ? prev.thumb : null,
    });
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
  }

  // Persist a fetched thumbnail URL for a slug so the grid is instant next time.
  function cacheThumb(slug, url) {
    if (!url) return;
    var list = loadHistory();
    var changed = false;
    list.forEach(function (h) {
      if (h.slug === slug && h.thumb !== url) { h.thumb = url; changed = true; }
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

      var img = document.createElement("img");
      img.className = "thumb";
      img.alt = h.label;
      img.loading = "lazy";
      if (h.thumb) {
        img.src = h.thumb;
      } else {
        fetchThumb(h, img); // lazily resolve a Wikipedia lead image
      }

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = h.label;

      card.appendChild(img);
      card.appendChild(name);
      card.addEventListener("click", function () {
        var code = codesBySlug[h.slug] || h;
        closeViews();
        stopCamera();
        document.body.classList.add("viewing");
        recordHistory(code);
        showDestination(code);
      });
      els.historyGrid.appendChild(card);
    });
  }

  // Resolve a thumbnail for a history card from the Wikipedia summary image,
  // then cache it so future opens are instant.
  function fetchThumb(h, img) {
    var article = wikiArticle(h.target);
    if (!article) return;
    fetch(summaryApi(article), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var src = data.thumbnail || data.originalimage;
        if (src && src.source) {
          img.src = src.source;
          cacheThumb(h.slug, src.source);
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
    setStatus("Visar: " + (code.label || code.slug));

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
          cacheThumb(code.slug, data.thumbnail.source);
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
    els.label.textContent = code.label || code.slug;

    if (external) {
      var article = wikiArticle(code.target);
      if (article) {
        showWikipedia(code, article);
        return;
      }
    }

    // Non-Wikipedia: internal info page or a plain external site in an iframe.
    wikiReq++; // not a wiki view
    els.dest.classList.remove("is-wiki");
    els.frame.src = external ? code.target : "/q/" + code.slug;
    els.dest.classList.remove("hidden");
    document.body.classList.add("viewing");
    setStatus("Visar: " + (code.label || code.slug));
  }

  // Release the camera when the page is hidden/navigated away.
  window.addEventListener("pagehide", stopCamera);

  // Slug from ?code=<slug> — set when a printed code's /q/<slug> redirected here.
  // We open that destination immediately (same in-page view as a 2nd scan)
  // instead of starting the camera.
  function entrySlug() {
    try {
      var slug = new URL(window.location.href).searchParams.get("code");
      return slug && VALID_CODE.test(slug) ? slug : null;
    } catch (e) { return null; }
  }

  // Load the published code registry, then either open the entry code or start
  // the camera.
  fetch("/codes.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      (data.codes || []).forEach(function (c) { codesBySlug[c.slug] = c; });
    })
    .catch(function () { /* registry unavailable — scanner still runs, just no matches */ })
    .finally(function () {
      var slug = entrySlug();
      var code = slug && codesBySlug[slug];
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
