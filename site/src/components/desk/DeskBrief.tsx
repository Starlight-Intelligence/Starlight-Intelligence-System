/**
 * The Desk brief, with its section headings set as headings. The body keeps
 * its citation markers verbatim, because the markers are the point.
 *
 * Shared by the Desk console and the homepage's Ask Starlight panel. No hooks,
 * so it renders inside either client island.
 *
 * Built on SIP — operational tier.
 */
export function DeskBrief({ text, headingLevel = 3 }: { text: string; headingLevel?: 3 | 4 }) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const blocks = text
    .split(/^##\s+/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const newline = block.indexOf("\n");
      return newline === -1
        ? { heading: block, body: "" }
        : { heading: block.slice(0, newline).trim(), body: block.slice(newline + 1).trim() };
    });

  if (blocks.length === 0) return <p className="text-[14px] leading-[1.9] text-slate-300">{text}</p>;

  return (
    <div className="space-y-5">
      {blocks.map((block) => (
        <section key={block.heading}>
          <Heading className="text-[13px] font-semibold text-violet-300">{sentenceCase(block.heading)}</Heading>
          <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-[1.9] text-slate-300">{block.body}</p>
        </section>
      ))}
    </div>
  );
}

/** "HYPOTHESIS" as "Hypothesis": the brief's headings shown in sentence case. Mixed-case text is left alone. */
export function sentenceCase(heading: string): string {
  return heading === heading.toUpperCase() ? heading.charAt(0) + heading.slice(1).toLowerCase() : heading;
}
