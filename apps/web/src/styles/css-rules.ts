/**
 * A very small CSS reader for the style tests. jsdom computes no layout and
 * applies no stylesheet, so the only way to assert what global.css actually
 * says is to parse it — `nav-cascade.integration.test.ts` resolves the cascade
 * with it, `card.integration.test.ts` asks what a single rule declares.
 *
 * Test-only: nothing in the app imports this, so it never reaches the bundle.
 */

export interface Rule {
  selector: string;
  body: string;
}

/** Flatten a stylesheet to its style rules, in source order. */
export function parseRules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open === -1) break;

    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close === -1) break;

    const prelude = text.slice(index, open).trim();
    const body = text.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      // Conditional groups contribute their children; @font-face and @keyframes
      // hold declarations rather than rules, so they contribute nothing.
      if (/^@(media|supports|layer)\b/.test(prelude)) out.push(...parseRules(body));
    } else {
      out.push({ selector: prelude, body });
    }
    index = close + 1;
  }
  return out;
}

/** Selector specificity as [ids, classes/attrs/pseudo-classes, elements]. */
export function specificity(selector: string): [number, number, number] {
  const withoutPseudoElements = selector.replace(/::[\w-]+/g, " ");
  const ids = withoutPseudoElements.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (withoutPseudoElements.match(/\.[\w-]+/g)?.length ?? 0) +
    (withoutPseudoElements.match(/\[[^\]]*\]/g)?.length ?? 0) +
    (withoutPseudoElements.match(/(^|[^:]):[\w-]+/g)?.length ?? 0);
  const elements = withoutPseudoElements.match(/(?:^|[\s>+~])([a-z][\w-]*)/g)?.length ?? 0;
  return [ids, classes, elements];
}

/** The last declaration of `property` in a rule body, or undefined. */
export function declaration(body: string, property: string): string | undefined {
  const pattern = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "g");
  let value: string | undefined;
  for (const match of body.matchAll(pattern)) value = match[1];
  return value;
}

/** Every rule whose selector list contains `selector` exactly. */
export function rulesFor(rules: Rule[], selector: string): Rule[] {
  return rules.filter((rule) =>
    rule.selector
      .split(",")
      .map((part) => part.trim())
      .includes(selector),
  );
}
