/* Ko-fi tip panel: any a.tip-btn opens Ko-fi's donation panel in an in-game modal (iframe made only on click).
   Without JS the link just opens Ko-fi in a new tab. */
(function () {
  var css = "" +
    ".tip-btn{display:inline-block;font-family:'Press Start 2P',monospace;font-size:11px;line-height:1.6;padding:10px 14px;" +
    "background:linear-gradient(#d9ae5c,#a8782f);color:#fee761;text-shadow:1px 1px 0 #3b2410;border:3px solid #f2d38a;" +
    "box-shadow:3px 3px 0 #000;text-decoration:none;cursor:pointer}" +
    ".tip-btn:hover{filter:brightness(1.08)}.tip-btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #000}" +
    ".tip-btn:focus-visible{outline:3px solid #2ce8f5;outline-offset:2px}" +
    ".tip-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,6,18,.82)}" +
    ".tip-box{position:relative;width:100%;max-width:420px;background:#1b1630;border:3px solid #c99a4a;box-shadow:5px 5px 0 #000;padding:12px}" +
    ".tip-box h2{margin:0 36px 10px 2px;font:12px/1.5 'Press Start 2P',monospace;color:#f2d38a}" +
    ".tip-box iframe{display:block;width:100%;height:min(600px,calc(100vh - 150px));border:0;background:#f9f9f9}" +
    ".tip-x{position:absolute;top:8px;right:8px;width:32px;height:32px;font:14px 'Press Start 2P',monospace;color:#f3ead8;" +
    "background:#4a3d60;border:2px solid #f2d38a;cursor:pointer;line-height:1}" +
    ".tip-alt{margin:8px 0 0;font:18px 'VT323',monospace;text-align:center}.tip-alt a{color:#f2d38a}";
  // Inside someone else's page (the itch.io embed): no account buttons and no tip panel, so nothing that
  // changes a player's account or takes money can be clickjacked by the framing page.
  var framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed) css += ".acct-badge,.tip-row,.acct,.acct-mail{display:none!important}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  if (framed) return;

  var last = null;
  function close() {
    var m = document.querySelector(".tip-modal");
    if (m) m.remove();
    document.removeEventListener("keydown", onKey, true);
    if (last) last.focus();
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
  function open(href, from) {
    last = from;
    var page = href.split("?")[0].replace(/\/$/, "");
    var m = document.createElement("div");
    m.className = "tip-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Leave a tip");
    m.innerHTML = '<div class="tip-box"><h2>KEEP THE TELESCOPE LIT</h2><button class="tip-x" type="button" aria-label="Close">×</button>' +
      '<iframe title="Tip on Ko-fi" loading="eager"></iframe>' +
      '<p class="tip-alt">Panel not loading? <a target="_blank" rel="noopener">Open on Ko-fi</a></p></div>';
    m.querySelector("iframe").src = page + "/?hidefeed=true&widget=true&embed=true";
    m.querySelector(".tip-alt a").href = page;
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".tip-x")) close(); });
    document.body.appendChild(m);
    document.addEventListener("keydown", onKey, true);
    m.querySelector(".tip-x").focus();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.tip-btn");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); open(a.href, a);
  });
})();
