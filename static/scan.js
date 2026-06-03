// In-browser continuous QR scanner for the QR Info static site.
//
// Runs the phone camera (getUserMedia, needs the trusted HTTPS this site is
// served over) and decodes continuously. When it reads one of OUR codes it
// shows the destination in an iframe while the camera keeps running, so the
// next plaque can be scanned without leaving the page.
//
// Resolution is client-side: the build publishes a slim /codes.json
// (slug → label + target), so no server API is needed.

(function () {
  "use strict";

  // Same allowlist the rest of the system uses for /q/<slug>.
  var VALID_CODE = /^[a-z0-9]{4,16}$/;
  // Ignore a repeat decode of the same slug within this window so a code held
  // in frame doesn't reload the iframe continuously.
  var REPEAT_MS = 2000;

  var els = {
    status: document.getElementById("status"),
    video: document.getElementById("video"),
    overlay: document.getElementById("overlay"),
    bar: document.getElementById("bar"),
    label: document.getElementById("label"),
    open: document.getElementById("open"),
    placeholder: document.getElementById("placeholder"),
    frame: document.getElementById("frame"),
  };

  var codesBySlug = {};
  var last = { slug: null, at: 0 };

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

  function showDestination(code) {
    var external = code.type === "external";
    var url = external ? code.target : "/q/" + code.slug; // internal → let CF rewrite serve the info page

    els.label.textContent = code.label || code.slug;
    els.bar.classList.remove("hidden");
    els.placeholder.classList.add("hidden");

    if (external) {
      els.open.href = code.target;
      els.open.classList.remove("hidden");
    } else {
      els.open.classList.add("hidden");
    }

    els.frame.src = url;
    els.frame.classList.remove("hidden");
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
