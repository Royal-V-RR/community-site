// icons.js · a tiny self-contained icon set (no external requests, no
// emoji). Every icon is a 24x24 stroke-based SVG using currentColor, sized
// via the shared .icon class in components.css.

export const ICONS = {
  bell: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 3.2 1 5 2 6H4c1-1 2-2.8 2-6Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></svg>`,

  menu: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>`,

  close: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>`,

  heartOutline: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M12 20s-7-4.4-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.6-9.5 9-9.5 9Z"/></svg>`,

  heartFilled: `<svg viewBox="0 0 24 24" class="icon icon-filled" aria-hidden="true"><path d="M12 20s-7-4.4-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.6-9.5 9-9.5 9Z"/></svg>`,

  file: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v4h4"/></svg>`,

  arrowLeft: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>`,

  plus: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,

  lock: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,

  unlock: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>`,

  search: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/></svg>`,

  image: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>`,

  poll: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/></svg>`,

  trash: `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>`,
};

/** Convenience: build a labelled icon button's inner markup (icon + sr-only text). */
export function iconWithLabel(iconName, label) {
  return `${ICONS[iconName] || ''}<span class="sr-only">${label}</span>`;
}
