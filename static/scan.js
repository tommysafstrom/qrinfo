// In-browser continuous QR scanner for the QR Info static site.
//
// Runs the phone camera (getUserMedia, needs the trusted HTTPS this site is
// served over) and decodes continuously. When it reads one of OUR codes it
// shows the destination while the camera keeps running, so the next plaque can
// be scanned without leaving the page.
//
// Wikipedia targets are rendered as a custom image-first page from the
// Wikipedia REST API (so we control the styling). Other external targets are
// shown in an iframe; internal codes load /q/<slug>.
//
// Resolution is client-side: the build publishes a slim /codes.json
// (slug → label + target), so no server API is needed.

(function () {
  "use strict";

  // Same allowlist the rest of the system uses for /q/<slug>.
  var VALID_CODE = /^[a-z0-9]{4,16}$/;
  // Ignore a repeat decode of the same slug within this window so a code held
  // in frame doesn't reload the page continuously.
  var REPEAT_MS = 2000;

  var els = {
    status: document.getElementById("status"),
    video: document.getElementById("video"),
    overlay: document.getElementById("overlay"),
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
  };

  var codesBySlug = {};
  var last = { slug: null, at: 0 };
  var wikiReq = 0; // guards against a slow fetch landing after the view changed

  els.close.addEventListener("click", hideDestination);

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

  function hideDestination() {
    wikiReq++; // invalidate any in-flight wiki fetch
    els.dest.classList.add("hidden");
    els.dest.classList.remove("is-wiki");
    els.frame.src = "about:blank";
    document.body.classList.remove("scanning");
    last = { slug: null, at: 0 }; // allow the same code to reopen after closing
    setStatus("Rikta kameran mot en QR-kod…");
  }

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

  // Render the image-first Wikipedia view from the REST summary API, then lazily
  // fetch the fuller extract behind a "Läs mer" button.
  function showWikipedia(code, article) {
    var token = ++wikiReq;
    var api =
      "https://" + article.lang + ".wikipedia.org/api/rest_v1/page/summary/" +
      encodeURIComponent(article.title.replace(/ /g, "_"));

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
    document.body.classList.add("scanning");
    setStatus("Visar: " + (code.label || code.slug));

    fetch(api, { headers: { Accept: "application/json" } })
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
        els.wikiSummary.textContent =
          "Kunde inte ladda artikeln just nu.";
      });
  }

  // "Läs mer" pulls the plain-text intro section(s) so the user can scroll past
  // the summary into the article without leaving our styled page.
  function wireReadMore(token, article, pageUrl) {
    els.wikiReadMore.classList.remove("hidden");
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
    document.body.classList.add("scanning"); // shrink camera to a thumbnail
    setStatus("Visar: " + (code.label || code.slug));
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
    showDestination(code);
  }

  function startScanner() {
    if (!window.isSecureContext) {
      showOverlay("Kameran kräver en säker anslutning (HTTPS).");
      setStatus("Kameran är blockerad.");
      return;
    }
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
      showOverlay("Kunde inte ladda skannern.");
      return;
    }

    var reader = new window.ZXingBrowser.BrowserMultiFormatReader();
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
      .then(function (controls) {
        // Release the camera when the page is hidden/navigated away.
        window.addEventListener("pagehide", function () { controls.stop(); });
      })
      .catch(function (err) {
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

  // Load the published code registry, then start the camera.
  fetch("/codes.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      (data.codes || []).forEach(function (c) { codesBySlug[c.slug] = c; });
    })
    .catch(function () { /* registry unavailable — scanner still runs, just no matches */ })
    .finally(startScanner);
})();
