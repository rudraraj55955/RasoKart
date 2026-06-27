const replacements: Array<[RegExp, string]> = [
  [/Cashfree/gi, "Payment Provider"],
  [/PhonePe Business/gi, "UPI Provider 1"],
  [/PhonePe/gi, "UPI Provider 1"],
  [/Bharat\s*Pe/gi, "UPI Provider 2"],
  [/BharatPe/gi, "UPI Provider 2"],
  [/Google Pay Business/gi, "UPI Provider 3"],
  [/Google Pay/gi, "UPI Provider 3"],
  [/Paytm Business/gi, "UPI Provider 4"],
  [/Paytm/gi, "UPI Provider 4"],
  [/ZuelPay/gi, "RasoKart"],
  [/Zuelpay/gi, "RasoKart"],
];

function scrubTextNode(node: Node) {
  const parent = node.parentElement;
  if (!parent) return;
  const tag = parent.tagName.toLowerCase();
  if (["script", "style", "code", "pre", "textarea", "input"].includes(tag)) return;
  let value = node.textContent || "";
  let next = value;
  for (const [from, to] of replacements) next = next.replace(from, to);
  if (next !== value) node.textContent = next;
}

function scrub(root: ParentNode = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(scrubTextNode);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const start = () => {
    scrub();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) scrubTextNode(node);
          if (node.nodeType === Node.ELEMENT_NODE) scrub(node as ParentNode);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

export {};
