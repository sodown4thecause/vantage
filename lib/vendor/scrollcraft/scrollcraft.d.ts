/** Types for the vendored engine. Importing it for side effects sets `window.ScrollCraft`. */
export type ScrollCraftApi = { destroy: () => void; layout: () => void; read: () => void };

declare global {
  interface Window {
    ScrollCraft?: { mount: (root: Element) => ScrollCraftApi };
  }
}
