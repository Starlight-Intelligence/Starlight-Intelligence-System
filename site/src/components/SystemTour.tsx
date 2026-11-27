"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Database, Fingerprint, ShieldCheck } from "lucide-react";
import styles from "./SystemTour.module.css";
const SOURCE =
  "https://github.com/Starlight-Intelligence/Starlight-Intelligence-System/blob/main/";
const chapters = [
  {
    label: "Remember",
    icon: Database,
    title: "Give the next session a head start.",
    description:
      "Keep decisions in local vaults. Connect your tools to the same memory server so useful context can travel between sessions.",
    input: "A decision worth keeping",
    output: "A retrievable vault entry",
    file: "src/vault-memory.ts",
    layer: "Memory",
    cta: "Set up local memory",
    href: "/quickstart",
  },
  {
    label: "Coordinate",
    icon: Fingerprint,
    title: "Make each agent’s job explicit.",
    description:
      "Inspect agent definitions and skills before choosing who does what. Shared context supports the handoff; the connected runtime executes the work.",
    input: "A task and its constraints",
    output: "A scoped agent handoff",
    file: "agents/AGENT_REGISTRY.md",
    layer: "Agents",
    cta: "Explore the architecture",
    href: "/architecture",
  },
  {
    label: "Inspect",
    icon: ShieldCheck,
    title: "Keep evidence close to the work.",
    description:
      "Read the protocol, inspect receipts, and decide what can proceed. A declaration of attribution is distinct from a signed receipt you can verify.",
    input: "An artifact ready for review",
    output: "Evidence for your decision",
    file: "SIP.md",
    layer: "Review",
    cta: "Inspect a signed receipt",
    href: "/verify",
  },
];
/** Architecture illustration, not live telemetry or an execution surface. */
export function SystemTour() {
  const [selected, setSelected] = useState(0);
  const [flat, setFlat] = useState(false);
  const chapter = chapters[selected];
  return (
    <section
      id="system-tour"
      className={styles.section}
      aria-labelledby="system-tour-title"
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            Inside Starlight / Interactive architecture
          </p>
          <h2 id="system-tour-title">
            Your best thinking.
            <br />
            <span>Ready for what comes next.</span>
          </h2>
        </div>
        <p>
          Explore how memory, agent definitions, and review fit together. Every
          layer opens into the source.
        </p>
      </div>
      <div className={styles.experience}>
        <div className={styles.visual}>
          <div className={styles.visualTop}>
            <span>Architecture illustration · not a live run</span>
            <button
              type="button"
              onClick={() => setFlat(!flat)}
              aria-pressed={flat}
            >
              {flat ? "Show depth" : "Flatten view"}
            </button>
          </div>
          <div
            className={`${styles.space} ${flat ? styles.flat : ""}`}
            aria-hidden="true"
          >
            <div className={styles.axis} />
            {chapters.map((item, index) => (
              <div
                key={item.layer}
                className={`${styles.plane} ${selected === index ? styles.activePlane : ""}`}
                style={{ "--level": index } as React.CSSProperties}
              >
                <span className={styles.planeNumber}>0{index + 1}</span>
                <item.icon size={34} strokeWidth={1} />
                <span className={styles.planeLabel}>{item.layer}</span>
                <div className={styles.nodes}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
          <p className={styles.caption}>
            Local context. Defined roles. Human judgment.
          </p>
        </div>
        <div className={styles.detail}>
          <div className={styles.controls} aria-label="Architecture layers">
            {chapters.map((item, index) => (
              <button
                type="button"
                key={item.label}
                aria-pressed={selected === index}
                aria-controls="system-tour-detail"
                onClick={() => setSelected(index)}
              >
                <span>0{index + 1}</span>
                {item.label}
              </button>
            ))}
          </div>
          <div
            id="system-tour-detail"
            aria-live="polite"
            aria-atomic="true"
            className={styles.copy}
          >
            <p className={styles.eyebrow}>
              0{selected + 1} / {chapter.layer}
            </p>
            <h3>{chapter.title}</h3>
            <p>{chapter.description}</p>
            <dl className={styles.flow}>
              <div>
                <dt>Starts with</dt>
                <dd>{chapter.input}</dd>
              </div>
              <div>
                <dt>Leaves you with</dt>
                <dd>{chapter.output}</dd>
              </div>
            </dl>
            <a className={styles.source} href={SOURCE + chapter.file}>
              Inspect source <span>{chapter.file} ↗</span>
            </a>
            <Link className={styles.primary} href={chapter.href}>
              {chapter.cta}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
      <div className={styles.paths}>
        <div>
          <p className={styles.eyebrow}>Make it yours</p>
          <h3>Choose what you want to build.</h3>
        </div>
        <Link href="/quickstart">
          <span>01 / Local system</span>
          <strong>
            Connect your own tools <ArrowRight size={18} />
          </strong>
          <small>Node 22 or 24 · local setup · your credentials</small>
        </Link>
        <Link href="/deploy">
          <span>02 / Public Explorer</span>
          <strong>
            Deploy the public interface <ArrowRight size={18} />
          </strong>
          <small>Read-only site · hosting costs may apply</small>
        </Link>
      </div>
    </section>
  );
}
