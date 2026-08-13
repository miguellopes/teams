/**
 * Presence Selector
 *
 * Drives Teams' own "me control" presence menu to set an explicit presence
 * (Available / Busy / Do not disturb / Be right back / Away / Appear offline).
 *
 * Why this is not a simple querySelector chain:
 *
 *  - The Fluent v9 popover mounts asynchronously into a portal at the end of
 *    <body>. A fixed sleep is a race; we poll until it exists instead.
 *  - `document.querySelector('a, b, c')` returns the first match in DOCUMENT
 *    order, not in the order the selectors were listed, so a "preferred
 *    selector first" list does not actually express a preference.
 *  - Presence menu items are `role="menuitemradio"` (a radio group), not
 *    `role="menuitem"`.
 *  - Matching must be scoped to the open popover, otherwise the presence badge
 *    already sitting in the toolbar matches first and clicking it does nothing.
 *  - Teams' data-tid values change between rings/versions, so we match on a
 *    combination of data-tid, aria-label, aria-checked and visible text rather
 *    than hard-coding one guessed tid.
 *
 * Call `window.teamsForLinuxDumpPresenceMenu()` from DevTools to print the real
 * attributes of the menu on your build if selection still fails.
 */

const STATUS_KEYWORDS = {
  available: ["available", "online", "disponivel", "disponible", "verfugbar"],
  busy: ["busy", "ocupado", "occupe", "beschaftigt"],
  do_not_disturb: ["do not disturb", "donotdisturb", "do-not-disturb", "dnd", "nao incomodar", "no molestar", "ne pas deranger"],
  be_right_back: ["be right back", "berightback", "be-right-back", "brb", "volto logo", "vuelvo enseguida"],
  away: ["away", "ausente", "absent", "abwesend"],
  offline: ["appear offline", "appearoffline", "appear-offline", "offline", "invisible", "aparecer offline"],
};

// Longest-first so "be right back" is never swallowed by "back", and so
// "appear offline" wins over a bare "offline" elsewhere in the string.
const MATCH_ORDER = ["do_not_disturb", "be_right_back", "offline", "available", "busy", "away"];

const MENU_ROOT_SELECTOR = '[role="menu"], [role="menubar"], .fui-MenuPopover, [data-tid="me-control-popover"]';
const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], button';

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns something truthy, or the deadline passes. */
async function waitFor(fn, { timeout = 4000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const value = fn();
      if (value) return value;
    } catch {
      /* keep polling */
    }
    if (Date.now() >= deadline) return null;
    await sleep(interval);
  }
}

function isVisible(el) {
  if (!el || el.getAttribute?.("aria-hidden") === "true") return false;
  if (typeof el.getBoundingClientRect !== "function") return true; // jsdom / unit tests
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Everything a menu item might carry the presence name in. */
function describe(el) {
  return normalize(
    [
      el.getAttribute?.("data-tid"),
      el.getAttribute?.("data-testid"),
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("name"),
      el.textContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchStatus(text) {
  for (const status of MATCH_ORDER) {
    for (const keyword of STATUS_KEYWORDS[status]) {
      if (text.includes(keyword)) return status;
    }
  }
  return null;
}

/**
 * Fluent listens for pointer events, and some items only commit on mouseup.
 * A bare .click() works on plain buttons but silently no-ops on several of the
 * menu surfaces, so send the whole sequence.
 */
function realClick(el) {
  el.scrollIntoView?.({ block: "nearest" });
  const opts = { bubbles: true, cancelable: true, view: globalThis.window };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    const Ctor = type.startsWith("pointer") && globalThis.PointerEvent ? globalThis.PointerEvent : globalThis.MouseEvent;
    try {
      el.dispatchEvent(new Ctor(type, opts));
    } catch {
      /* older event ctor unavailable — fall through to click() */
    }
  }
  el.click?.();
}

function menuRoots() {
  return Array.from(document.querySelectorAll(MENU_ROOT_SELECTOR)).filter(isVisible);
}

function itemsIn(roots) {
  const seen = new Set();
  const items = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll(MENU_ITEM_SELECTOR)) {
      if (!seen.has(el) && isVisible(el)) {
        seen.add(el);
        items.push(el);
      }
    }
  }
  return items;
}

function findMeControl() {
  const candidates = [
    '[data-tid="me-control-avatar-trigger"]',
    '[data-tid="me-control-button"]',
    '[data-tid="me-control"]',
    'button[id*="personButton" i]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account manager" i]',
  ];
  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (el && isVisible(el)) return el;
  }
  return null;
}

function closeMenus() {
  const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
  try {
    document.activeElement?.dispatchEvent(new globalThis.KeyboardEvent("keydown", opts));
    document.body.dispatchEvent(new globalThis.KeyboardEvent("keydown", opts));
  } catch {
    /* non-fatal */
  }
}

/** Print every visible menu item so real data-tid values can be discovered. */
function dumpPresenceMenu() {
  const rows = itemsIn(menuRoots()).map((el) => ({
    role: el.getAttribute("role"),
    dataTid: el.getAttribute("data-tid"),
    ariaLabel: el.getAttribute("aria-label"),
    ariaChecked: el.getAttribute("aria-checked"),
    hasPopup: el.getAttribute("aria-haspopup"),
    text: (el.textContent || "").trim().slice(0, 60),
  }));
  console.table(rows);
  return rows;
}

/**
 * @param {string} status one of STATUS_KEYWORDS' keys
 * @returns {Promise<{ok: boolean, reason?: string, status: string}>}
 */
async function setPresenceStatus(status) {
  const target = String(status || "").toLowerCase();
  if (!STATUS_KEYWORDS[target]) {
    return { ok: false, status: target, reason: "unsupported-status" };
  }

  const meControl = findMeControl();
  if (!meControl) {
    return { ok: false, status: target, reason: "me-control-not-found" };
  }

  try {
    realClick(meControl);

    const rootMenu = await waitFor(() => (menuRoots().length ? menuRoots() : null), { timeout: 4000 });
    if (!rootMenu) {
      return { ok: false, status: target, reason: "profile-menu-did-not-open" };
    }

    // The first level shows the CURRENT presence as a submenu trigger. Prefer an
    // item that advertises a submenu; fall back to one that reads like a
    // presence value.
    const trigger = await waitFor(() => {
      const items = itemsIn(menuRoots());
      return (
        items.find((el) => {
          const t = describe(el);
          return (
            (el.getAttribute("aria-haspopup") || el.getAttribute("aria-expanded") !== null || t.includes("presence") || t.includes("status")) &&
            matchStatus(t) !== null
          );
        }) || items.find((el) => matchStatus(describe(el)) !== null)
      );
    }, { timeout: 3000 });

    if (!trigger) {
      return { ok: false, status: target, reason: "presence-submenu-trigger-not-found" };
    }

    const menuCountBefore = menuRoots().length;
    realClick(trigger);

    // Wait for the submenu: either a new popover appeared, or the option we
    // want is now present (some builds render the options inline).
    const option = await waitFor(() => {
      const items = itemsIn(menuRoots());
      const hit = items.find((el) => matchStatus(describe(el)) === target);
      if (!hit) return null;
      // Guard against re-matching the trigger itself before the submenu opens.
      if (hit === trigger && menuRoots().length === menuCountBefore) return null;
      return hit;
    }, { timeout: 4000 });

    if (!option) {
      console.warn(
        `[Presence] '${target}' not found in the open menu. Run window.teamsForLinuxDumpPresenceMenu() to inspect it.`,
      );
      closeMenus();
      return { ok: false, status: target, reason: "option-not-found" };
    }

    realClick(option);

    // Confirm rather than assume: the badge label should settle on the target.
    const confirmed = await waitFor(() => {
      const badge = document.querySelector(
        '[data-tid="me-control-avatar-presence"], [data-tid="me-control-presence-icon"], [data-tid="presence-indicator"]',
      );
      if (!badge) return null;
      return matchStatus(describe(badge)) === target ? true : null;
    }, { timeout: 5000 });

    closeMenus();

    if (!confirmed) {
      console.warn(`[Presence] Clicked '${target}' but the badge did not confirm it.`);
      return { ok: false, status: target, reason: "not-confirmed" };
    }

    console.info(`[Presence] Set Teams presence to '${target}'`);
    return { ok: true, status: target };
  } catch (err) {
    console.error("[Presence] Failed to set presence:", err);
    closeMenus();
    return { ok: false, status: target, reason: `error:${err.message}` };
  }
}

if (globalThis.window) {
  globalThis.window.teamsForLinuxDumpPresenceMenu = dumpPresenceMenu;
}

module.exports = { setPresenceStatus, dumpPresenceMenu, STATUS_KEYWORDS, matchStatus, waitFor };
