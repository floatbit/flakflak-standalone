import type { Anchor } from "../../shared/types";
export function anchorAt(
  element: Element,
  clientX: number,
  clientY: number,
): Anchor {
  const r = element.getBoundingClientRect();
  let selector = "";
  let node: Element | null = element;
  while (node && node !== document.documentElement) {
    if (
      node.id &&
      document.querySelectorAll("#" + CSS.escape(node.id)).length === 1
    ) {
      selector = "#" + CSS.escape(node.id) + (selector ? " > " + selector : "");
      break;
    }
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (n) => n.tagName === node!.tagName,
      );
      if (siblings.length > 1)
        part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
    }
    selector = part + (selector ? " > " + selector : "");
    node = parent;
  }
  return {
    selector,
    text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
    x: Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1))),
    y: Math.max(0, Math.min(1, (clientY - r.top) / (r.height || 1))),
    documentX: clientX + scrollX,
    documentY: clientY + scrollY,
    viewportWidth: innerWidth,
  };
}
export function resolveAnchor(a: Anchor): {
  x: number;
  y: number;
  missing: boolean;
} {
  let matches: NodeListOf<Element> | undefined;
  try {
    matches = document.querySelectorAll(a.selector);
  } catch {}
  const el = matches?.length === 1 ? matches[0] : null;
  if (el) {
    const r = el.getBoundingClientRect();
    const text = (el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 160);
    if (r.width && r.height && (!a.text || text === a.text))
      return {
        x: r.left + r.width * a.x,
        y: r.top + r.height * a.y,
        missing: false,
      };
  }
  return {
    x: a.documentX * (innerWidth / a.viewportWidth) - scrollX,
    y: a.documentY - scrollY,
    missing: true,
  };
}
