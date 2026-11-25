import type { PrototypePlayer } from "./prototype-player";

/** Source: upstream ui-egui/src/present/chrome.rs (`finish`, `link_notice`, `goes_to_a_website`): links a prototype opens (#1096). */
export interface LinkNotice {
  readonly url: string;
  /** "Don't show this again", offered only for a link the viewer's own input fired (undefined: not offered). */
  skip?: boolean;
  readonly newTab: boolean;
}
/** Native `goes_to_a_website`: an `http` or `https` link (the other openable links are `mailto:`). */
export function goesToWebsite(url: string): boolean {
  const i = url.trim().indexOf(":");
  if (i < 0) return false;
  const scheme = url.trim().slice(0, i).toLowerCase();
  return scheme === "http" || scheme === "https";
}
/** Native `finish`: after a player's frame, each link it opened waits behind the notice. Skipping the notice opens at once only a link the
 * viewer's own click, press, drag or key fired, one per frame, and never while a notice shows; a further link that fires while the notice
 * shows is dropped, whatever fired it. True when a notice came up (a press under way then ends: its release would reach the prototype
 * behind the notice). */
export function finishLinks(p: PrototypePlayer, skipped: boolean, open: (url: string, newTab: boolean) => void): boolean {
  let opened = false, raised = false;
  for (const link of p.urls.splice(0)) {
    if (skipped && link.asked && !opened && !p.linkNotice) { open(link.url, link.newTab); opened = true; }
    else if (!p.linkNotice) { p.linkNotice = { url: link.url, skip: link.asked && !skipped ? false : undefined, newTab: link.newTab }; raised = true; }
  }
  return raised;
}
