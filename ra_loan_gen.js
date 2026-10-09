/* Loan Letter — Foundry VTT script macro (PF2e)
 *
 * Opens a window with the borrower (selected token, else the focused actor sheet,
 * else your assigned character). Drop purchased items into the window; they stay
 * where they are, only their name and price are copied. "Accept" creates a
 * Promissory Note item with the list, the total, the in-game date and a signature.
 */

const OPTIONS = {
  /** Where the note is created: "borrower" or "party" (the active PF2e party actor). */
  storeIn: "borrower",
  noteName: (name) => `Promissory Note of ${name}`,
  /** Add the in-game time after the date ("..., 4729 AR, 21:14"). */
  showTime: false,
  /** GM only, once per world: adds the signature font to the world font list so every client loads it. */
  registerFont: true,
  fontFamily: "Great Vibes",
  fontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/great-vibes@latest/latin-400-normal.woff2",
};

const { DialogV2 } = foundry.applications.api;
const SCROLL_PACK = "pf2e.equipment-srd";
const SCROLL_ID = "RjuupS9xyXDLgyIr"; // Scroll of 1st-rank Spell (same ID PF2e uses for spell scrolls)
const FALLBACK_ICON = "icons/svg/book.svg";

const GOLARION = {
  months: ["Abadius", "Calistril", "Pharast", "Gozran", "Desnus", "Sarenith", "Erastus", "Arodus", "Rova", "Lamashan", "Neth", "Kuthona"],
  weekdays: ["Moonday", "Toilday", "Wealday", "Oathday", "Fireday", "Starday", "Sunday"],
};
const AFTER_GAP_WEEKDAYS = ["Firstday", "Seconday", "Thirday", "Fourthday", "Fifthday", "Sixthday", "Seventhday"];
const YEAR_OFFSETS = { AR: 2700, IC: 5200, AG: -1700 }; // used only if CONFIG.PF2E has none
const EARTH = {
  months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

// ---------------------------------------------------------------- helpers

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Copper -> "1,250 gp 5 sp 2 cp" */
function fmtCoins(cp) {
  cp = Math.max(0, Math.round(cp));
  if (!cp) return "0 gp";
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp.toLocaleString("en-US")} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(" ");
}

/** PF2e price -> { cp: price for `per` units, per } or null if the item has no price */
function priceOf(item) {
  const price = item?.system?.price;
  if (!price || typeof price !== "object" || !("value" in price)) return null;
  const v = price.value ?? {};
  const cp = (+v.pp || 0) * 1000 + (+v.gp || 0) * 100 + (+v.sp || 0) * 10 + (+v.cp || 0);
  return { cp, per: Math.max(1, Math.floor(+price.per || 1)) };
}

/** Current in-game date (and optionally time) from the PF2e world clock, always in English. */
function gameDate(withTime = OPTIONS.showTime) {
  const attempt = (fn) => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const read = (key) => attempt(() => game.settings.get("pf2e", key));
  const wc = game.pf2e?.worldClock;
  // PF2e 7+ keeps all clock settings in one object; older versions used separate "worldClock.*" keys.
  const stored = game.pf2e?.settings?.worldClock ?? read("worldClock");
  const cfg = stored && typeof stored === "object" ? stored : {};

  const theme = attempt(() => wc.dateTheme) ?? cfg.dateTheme ?? read("worldClock.dateTheme") ?? "AR";
  const clock24 = Number(attempt(() => wc.timeConvention) ?? cfg.timeConvention ?? read("worldClock.timeConvention") ?? 24) !== 12;
  const fmtTime = (h, m) =>
    !withTime ? "" : clock24 ? `, ${pad(h)}:${pad(m)}` : `, ${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;

  // Date parts (UTC, like PF2e): first from the clock itself, else from the stored creation date.
  let t = null;
  const dt = attempt(() => wc.worldTime);
  if (dt?.isValid) {
    t = { year: dt.year, month: dt.month - 1, day: dt.day, weekday: dt.weekday - 1, hour: dt.hour, minute: dt.minute };
  } else {
    const createdOn = Date.parse(cfg.worldCreatedOn ?? read("worldClock.worldCreatedOn") ?? "");
    if (Number.isFinite(createdOn)) {
      const d = new Date(createdOn + (Number(game.time.worldTime) || 0) * 1000);
      t = {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        day: d.getUTCDate(),
        weekday: (d.getUTCDay() + 6) % 7, // Monday = 0
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
      };
    }
  }
  if (!t) {
    // No PF2e clock at all: plain Foundry world time
    const s = Math.max(0, Math.floor(Number(game.time.worldTime) || 0));
    return `Day ${Math.floor(s / 86400) + 1}${fmtTime(Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60))}`;
  }

  const golarion = ["AR", "IC", "AG"].includes(theme);
  const months = golarion ? GOLARION.months : EARTH.months;
  const weekdays = theme === "AG" ? AFTER_GAP_WEEKDAYS : golarion ? GOLARION.weekdays : EARTH.weekdays;
  const offset = Number(CONFIG.PF2E?.worldClock?.[theme]?.yearOffset ?? YEAR_OFFSETS[theme] ?? 0) || 0;
  const era = theme === "CE" ? "" : ` ${theme}`;
  return `${weekdays[t.weekday]}, ${ordinal(t.day)} of ${months[t.month]}, ${t.year + offset}${era}${fmtTime(t.hour, t.minute)}`;
}

/** Icon of the PF2e spell scroll. */
async function scrollIcon() {
  try {
    const pack = game.packs.get(SCROLL_PACK);
    const index = pack ? await pack.getIndex() : null;
    return index?.get(SCROLL_ID)?.img || FALLBACK_ICON;
  } catch {
    return FALLBACK_ICON;
  }
}

/** Loads the signature font here, and (GM) registers it for the whole world. */
async function ensureSignatureFont() {
  const family = OPTIONS.fontFamily;
  try {
    const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === family && f.status === "loaded");
    if (!loaded) document.fonts.add(await new FontFace(family, `url("${OPTIONS.fontUrl}")`).load());
  } catch (err) {
    console.warn("Loan Letter | Could not load the signature font", err);
  }
  if (!OPTIONS.registerFont || !game.user.isGM) return;
  try {
    const fonts = foundry.utils.deepClone(game.settings.get("core", "fonts") ?? {});
    if (fonts[family]) return;
    fonts[family] = { editor: true, fonts: [{ urls: [OPTIONS.fontUrl], weight: 400, style: "normal" }] };
    await game.settings.set("core", "fonts", fonts);
    ui.notifications.info(`Loan Letter: font "${family}" added to the world fonts.`);
  } catch (err) {
    console.warn("Loan Letter | Could not register the signature font", err);
  }
}

// ---------------------------------------------------------------- borrower

function pickBorrower() {
  const tokens = canvas?.ready ? (canvas.tokens?.controlled ?? []) : [];
  if (tokens.length > 1) throw new Error("Several tokens are selected. Select one token, or none to use the selected actor.");
  if (tokens.length === 1) {
    if (!tokens[0].actor) throw new Error("The selected token has no actor.");
    return tokens[0].actor;
  }
  const win = ui.activeWindow;
  const doc = win?.rendered ? (win.document ?? win.object) : null;
  if (doc instanceof Actor && doc.type !== "party") return doc;
  if (game.user.character) return game.user.character;
  throw new Error("Nothing is selected. Select a token, or open the actor's sheet.");
}

let borrower;
try {
  borrower = pickBorrower();
} catch (err) {
  return ui.notifications.warn(`Loan Letter: ${err.message}`);
}

ensureSignatureFont(); // runs in the background

// ---------------------------------------------------------------- dialog

const rows = []; // { uuid, name, unitCp, per, qty }
const lineCp = (r) => Math.round((r.unitCp * r.qty) / r.per);
const totalCp = () => rows.reduce((sum, r) => sum + lineCp(r), 0);

const content = `
<style>
  .ll-dlg { display: flex; flex-direction: column; gap: 10px; }
  .ll-dlg [hidden] { display: none !important; }
  .ll-borrower { display: flex; align-items: baseline; gap: 8px; padding: 8px 10px; border: 1px solid rgba(128,128,128,.45); border-radius: 6px; }
  .ll-borrower .ll-label { font-size: 11px; opacity: .7; text-transform: uppercase; letter-spacing: .05em; }
  .ll-borrower .ll-name { font-size: 1.2em; font-weight: bold; }
  .ll-borrower .ll-hint { margin-left: auto; font-size: 11px; opacity: .55; text-align: right; }
  .ll-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ll-bar .ll-total { font-size: 1.1em; }
  .ll-bar .ll-accept { flex: none; width: auto; min-width: 120px; }
  .ll-drop { min-height: 130px; border: 2px dashed rgba(128,128,128,.5); border-radius: 6px; padding: 6px; }
  .ll-over { border-color: #c9593f !important; background: rgba(201,89,63,.08); }
  .ll-empty { display: flex; align-items: center; justify-content: center; min-height: 114px; margin: 0; opacity: .6; text-align: center; }
  .ll-list { list-style: none; margin: 0; padding: 0; max-height: 45vh; overflow-y: auto; }
  .ll-list li { display: flex; align-items: center; gap: 8px; padding: 3px 2px; border-bottom: 1px solid rgba(128,128,128,.2); }
  .ll-list li:last-child { border-bottom: none; }
  .ll-list .ll-iname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ll-list .ll-x { flex: none; opacity: .6; }
  .ll-list input.ll-qty { width: 54px; flex: none; text-align: center; }
  .ll-list .ll-price { width: 96px; flex: none; text-align: right; }
  .ll-list .ll-remove { flex: none; cursor: pointer; opacity: .6; padding: 0 2px; }
  .ll-list .ll-remove:hover { opacity: 1; }
</style>
<div class="ll-dlg">
  <div class="ll-borrower"></div>
  <div class="ll-bar">
    <span class="ll-total">Total borrowed: <strong class="ll-sum">0 gp</strong></span>
    <button type="button" class="ll-accept" disabled>Accept</button>
  </div>
  <div class="ll-drop">
    <p class="ll-empty">Drag purchased items here from a character sheet or a compendium.<br>The items stay where they are.</p>
    <ol class="ll-list"></ol>
  </div>
</div>`;

function readDrop(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return null;
  }
}

function makeDropTarget(el, handler) {
  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    el.classList.add("ll-over");
  });
  el.addEventListener("dragleave", (ev) => {
    if (!el.contains(ev.relatedTarget)) el.classList.remove("ll-over");
  });
  el.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove("ll-over");
    const data = readDrop(ev);
    if (!data) return;
    try {
      await handler(data);
    } catch (err) {
      console.error("Loan Letter |", err);
      ui.notifications.error(`Loan Letter: ${err.message}`);
    }
  });
}

let accepted = false;

function wire(_event, arg) {
  const app = arg instanceof HTMLElement ? null : arg; // Foundry v13+: the DialogV2 instance
  const host = arg instanceof HTMLElement ? arg : arg?.element;
  const root = host?.querySelector(".ll-dlg");
  if (!root) return;
  const borrowerBox = root.querySelector(".ll-borrower");
  const dropZone = root.querySelector(".ll-drop");
  const list = root.querySelector(".ll-list");
  const empty = root.querySelector(".ll-empty");
  const sum = root.querySelector(".ll-sum");
  const acceptBtn = root.querySelector(".ll-accept");

  // DialogV2 needs a footer button; hide it, the real Accept sits above the list.
  const footerBtn = host.querySelector('button[data-action="accept"]');
  const footer = footerBtn?.closest("footer") ?? footerBtn?.parentElement;
  if (footer) footer.style.display = "none";

  acceptBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!rows.length) return;
    accepted = true;
    if (app) app.close();
    else footerBtn?.click();
  });

  const refresh = () => {
    sum.textContent = fmtCoins(totalCp());
    empty.hidden = rows.length > 0;
    acceptBtn.disabled = rows.length === 0;
    app?.setPosition?.({ height: "auto" }); // resize the window to the list
  };

  const renderBorrower = () => {
    borrowerBox.innerHTML = `
      <span class="ll-label">Borrower</span>
      <span class="ll-name">${esc(borrower.name)}</span>
      <span class="ll-hint">Drop an actor here to change</span>`;
  };

  const renderList = () => {
    list.innerHTML = rows
      .map((r, i) => {
        const unit = `${fmtCoins(r.unitCp)}${r.per > 1 ? ` per ${r.per}` : " each"}`;
        return `<li data-index="${i}">
          <span class="ll-iname" data-tooltip="${esc(r.name)}">${esc(r.name)}</span>
          <span class="ll-x">×</span>
          <input class="ll-qty" type="number" min="1" step="1" value="${r.qty}">
          <span class="ll-price" data-tooltip="${esc(unit)}">${fmtCoins(lineCp(r))}</span>
          <a class="ll-remove" data-tooltip="Remove">✕</a>
        </li>`;
      })
      .join("");
    refresh();
  };

  makeDropTarget(dropZone, async (data) => {
    if (data.type !== "Item") return ui.notifications.warn("Loan Letter: only items can be dropped here.");
    const item = data.uuid ? await fromUuid(data.uuid) : null;
    if (!item) return ui.notifications.warn("Loan Letter: could not find the dropped item.");
    const price = priceOf(item);
    if (!price) return ui.notifications.warn(`Loan Letter: "${item.name}" has no price.`);
    if (rows.some((r) => r.uuid === item.uuid)) {
      return ui.notifications.info(`Loan Letter: "${item.name}" is already listed. Change its quantity instead.`);
    }
    rows.push({
      uuid: item.uuid,
      name: item.name,
      unitCp: price.cp,
      per: price.per,
      qty: Math.max(1, Math.floor(+item.system?.quantity || 1)),
    });
    renderList();
  });

  makeDropTarget(borrowerBox, async (data) => {
    if (data.type !== "Actor") return ui.notifications.warn("Loan Letter: drop an actor here.");
    const actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!(actor instanceof Actor) || actor.pack) return ui.notifications.warn("Loan Letter: drop an actor from this world.");
    borrower = actor;
    renderBorrower();
  });

  list.addEventListener("input", (ev) => {
    const input = ev.target.closest("input.ll-qty");
    if (!input) return;
    const li = input.closest("li");
    const row = rows[Number(li.dataset.index)];
    row.qty = Math.max(1, Math.floor(+input.value || 1));
    li.querySelector(".ll-price").textContent = fmtCoins(lineCp(row));
    refresh();
  });
  list.addEventListener("change", (ev) => {
    const input = ev.target.closest("input.ll-qty");
    if (input) input.value = rows[Number(input.closest("li").dataset.index)].qty;
  });
  list.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("input")) {
      ev.preventDefault();
      ev.target.blur();
    }
  });
  list.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".ll-remove");
    if (!btn) return;
    ev.preventDefault();
    rows.splice(Number(btn.closest("li").dataset.index), 1);
    renderList();
  });

  renderBorrower();
  renderList();
}

await DialogV2.wait({
  window: { title: "Loan Letter" },
  position: { width: 500 },
  content,
  buttons: [{ action: "accept", label: "Accept" }], // hidden in wire()
  render: wire,
  rejectClose: false,
});
if (!accepted) return;
if (!rows.length) return ui.notifications.warn("Loan Letter: no items were added.");

// ---------------------------------------------------------------- the note

let target = borrower;
if (OPTIONS.storeIn === "party") {
  target = game.actors.party ?? borrower;
  if (!game.actors.party) ui.notifications.warn("Loan Letter: no active party found, the note goes to the borrower.");
}
if (!target.isOwner) return ui.notifications.warn(`Loan Letter: you don't own ${target.name}.`);

const name = esc(borrower.name);
const signatureFont = `'${OPTIONS.fontFamily}', 'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Snell Roundhand', 'Apple Chancery', 'URW Chancery L', cursive`;
const itemsHtml = rows
  .map((r) => {
    const qty = r.qty > 1 ? ` ×${r.qty}` : "";
    return `<li>${esc(r.name)}${qty} (${fmtCoins(lineCp(r))})</li>`;
  })
  .join("");

const description = `
<h2 style="text-align:center;font-variant:small-caps;letter-spacing:.08em">Promissory Note</h2>
<p>For the purpose of acquiring the following items:</p>
<ul>${itemsHtml}</ul>
<p><strong>${name}</strong> has borrowed <strong>${fmtCoins(totalCp())}</strong> from the party's common purse.</p>
<p>${name} formally acknowledges this loan and hopes to repay it in full, by faithful courage, in the adventures yet to come.</p>
<p style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25em 1.5em;margin-top:1.5em">
  <span><em>Dated:</em> ${esc(gameDate())}</span>
  <span><em>Signed:</em> <span style="font-family:${esc(signatureFont)};font-size:2.2em;line-height:1.25">${name}</span></span>
</p>`;

const [note] = await target.createEmbeddedDocuments("Item", [
  {
    name: OPTIONS.noteName(borrower.name),
    type: "equipment",
    img: await scrollIcon(),
    system: {
      description: { value: description },
      quantity: 1,
      bulk: { value: 0 },
      price: { value: {} },
    },
  },
]);

if (note) {
  ui.notifications.info(`Loan Letter: "${note.name}" added to ${target.name}.`);
  note.sheet?.render(true);
}
