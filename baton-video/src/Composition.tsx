import React from "react";
import {Audio} from "@remotion/media";
import {loadFont} from "@remotion/google-fonts/Inter";
import {TransitionSeries, linearTiming} from "@remotion/transitions";
import {fade} from "@remotion/transitions/fade";
import {slide} from "@remotion/transitions/slide";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const {fontFamily} = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const C = {
  bg: "#05070b",
  panel: "#0c1018",
  line: "rgba(255,255,255,0.13)",
  soft: "rgba(236,244,255,0.62)",
  white: "#f6f9ff",
  cyan: "#2de6ff",
  blue: "#2475ff",
  violet: "#8d5cff",
  green: "#65f5b5",
};

const clamp = {extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const};
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const enter = (frame: number, fps: number, delay = 0, duration = 0.8) =>
  interpolate(frame, [delay * fps, (delay + duration) * fps], [0, 1], {...clamp, easing: ease});

const exit = (frame: number, fps: number, start: number, duration = 0.7) =>
  interpolate(frame, [start * fps, (start + duration) * fps], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });

const Kicker: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{fontSize: 31, fontWeight: 600, letterSpacing: 8, color: C.cyan, textTransform: "uppercase"}}>
    {children}
  </div>
);

const GlowBackground: React.FC<{accent?: string}> = ({accent = C.cyan}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drift = interpolate(frame, [0, 12 * fps], [-120, 130], clamp);
  const pulse = interpolate(Math.sin(frame / 24), [-1, 1], [0.65, 1]);
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          inset: -500,
          transform: `translate3d(${drift}px, ${-drift * 0.28}px, 0)`,
          opacity: 0.22 * pulse,
          background: `radial-gradient(circle at 35% 38%, ${accent} 0, transparent 28%), radial-gradient(circle at 72% 62%, ${C.violet} 0, transparent 25%)`,
          filter: "blur(90px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.3,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          transform: `perspective(1100px) rotateX(63deg) scale(1.45) translateY(${110 + drift * 0.06}px)`,
          transformOrigin: "center 76%",
          maskImage: "linear-gradient(to bottom, transparent 5%, black 48%, black 100%)",
        }}
      />
      <div style={{position: "absolute", inset: 0, boxShadow: "inset 0 0 260px rgba(0,0,0,.75)"}} />
    </AbsoluteFill>
  );
};

const BatonMark: React.FC<{size?: number; progress?: number}> = ({size = 360, progress = 1}) => {
  const frame = useCurrentFrame();
  const spin = interpolate(frame, [0, 180], [-16, -4], clamp);
  return (
    <div style={{width: size, height: size * 0.45, position: "relative", transform: `scale(${progress}) rotate(${spin}deg)`}}>
      <div
        style={{
          position: "absolute",
          top: "42%",
          left: "6%",
          right: "6%",
          height: "18%",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${C.blue}, ${C.cyan} 48%, #d7fbff 52%, ${C.violet})`,
          boxShadow: `0 0 22px ${C.cyan}, 0 0 80px rgba(45,230,255,.55)`,
        }}
      />
      {[0, 1].map((n) => (
        <div
          key={n}
          style={{
            position: "absolute",
            top: "34%",
            [n === 0 ? "left" : "right"]: "2%",
            width: "14%",
            height: "34%",
            borderRadius: 999,
            border: `5px solid ${n === 0 ? C.blue : C.violet}`,
            background: C.bg,
            boxShadow: `0 0 35px ${n === 0 ? C.blue : C.violet}`,
          }}
        />
      ))}
    </div>
  );
};

const SceneShell: React.FC<{children: React.ReactNode; accent?: string}> = ({children, accent}) => (
  <AbsoluteFill style={{fontFamily, color: C.white}}>
    <GlowBackground accent={accent} />
    <div style={{position: "absolute", top: 84, left: 112, right: 112, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
      <div style={{display: "flex", alignItems: "center", gap: 20}}>
        <div style={{width: 64, height: 13, borderRadius: 999, background: `linear-gradient(90deg,${C.blue},${C.cyan},${C.violet})`, boxShadow: `0 0 16px ${C.cyan}`}} />
        <div style={{fontSize: 29, fontWeight: 700, letterSpacing: 7}}>BATON</div>
      </div>
      <div style={{fontSize: 24, letterSpacing: 4, color: C.soft}}>VERIFIABLE AGENT HANDOFFS</div>
    </div>
    {children}
  </AbsoluteFill>
);

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = enter(frame, fps, 0.35, 0.9);
  const p2 = enter(frame, fps, 1.55, 0.8);
  const out = exit(frame, fps, 5.8);
  return (
    <SceneShell>
      <div style={{position: "absolute", inset: "220px 190px 150px", display: "flex", flexDirection: "column", justifyContent: "center"}}>
        <div style={{opacity: p * out, transform: `translateY(${(1 - p) * 85}px)`}}>
          <Kicker>Your agent remembers the task.</Kicker>
          <div style={{fontSize: 178, fontWeight: 600, letterSpacing: -9, lineHeight: 0.95, marginTop: 55}}>
            Until you<br />switch tools.
          </div>
        </div>
        <div style={{marginTop: 72, display: "flex", gap: 24, opacity: p2 * out}}>
          {["CODEX", "CLAUDE CODE", "OPENCODE"].map((name, i) => (
            <div key={name} style={{padding: "20px 30px", border: `1px solid ${C.line}`, borderRadius: 16, background: "rgba(9,13,20,.7)", fontSize: 24, letterSpacing: 4, color: i === 1 ? C.cyan : C.soft}}>{name}</div>
          ))}
        </div>
      </div>
    </SceneShell>
  );
};

const FragmentScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = enter(frame, fps, 0.15, 0.75);
  const labels = ["What was decided?", "What already failed?", "What happens next?", "Where is the evidence?"];
  return (
    <SceneShell accent={C.violet}>
      <div style={{position: "absolute", left: 170, top: 300, width: 1500, opacity: p, transform: `translateX(${(1 - p) * -90}px)`}}>
        <Kicker>The context gap</Kicker>
        <div style={{fontSize: 132, fontWeight: 600, letterSpacing: -6, lineHeight: 1.03, marginTop: 40}}>Every switch starts<br />another explanation.</div>
      </div>
      <div style={{position: "absolute", right: 160, top: 330, width: 1000, display: "grid", gap: 26}}>
        {labels.map((label, i) => {
          const ip = enter(frame, fps, 1 + i * 0.38, 0.65);
          return <div key={label} style={{opacity: ip, transform: `translateX(${(1 - ip) * 90}px)`, padding: "30px 38px", borderRadius: 20, border: `1px solid ${C.line}`, background: "rgba(13,16,26,.82)", fontSize: 36, color: i === 1 ? C.white : C.soft}}><span style={{color: C.violet, marginRight: 24}}>0{i + 1}</span>{label}</div>;
        })}
      </div>
    </SceneShell>
  );
};

const RevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = enter(frame, fps, 0.25, 0.95);
  const word = enter(frame, fps, 1.15, 0.8);
  return (
    <SceneShell>
      <div style={{position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 120}}>
        <div style={{opacity: p, transform: `translateX(${(1 - p) * -120}px)`}}><BatonMark size={680} progress={0.72 + p * 0.28} /></div>
        <div style={{width: 1700, opacity: word, transform: `translateY(${(1 - word) * 70}px)`}}>
          <Kicker>Meet Baton</Kicker>
          <div style={{fontSize: 180, fontWeight: 700, letterSpacing: -10, lineHeight: 0.95, marginTop: 38}}>Git for<br />agent memory.</div>
          <div style={{fontSize: 42, color: C.soft, marginTop: 48}}>The runner changes. The working state travels.</div>
        </div>
      </div>
    </SceneShell>
  );
};

const PayloadScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cards = [
    ["MISSION", "What we are building", C.cyan],
    ["DECISIONS", "What was chosen — and why", C.blue],
    ["GRAVEYARD", "What failed — never repeat it", C.violet],
    ["SOURCE", "The scrubbed transcript behind each claim", C.green],
  ];
  return (
    <SceneShell>
      <div style={{position: "absolute", left: 170, right: 170, top: 260}}>
        <Kicker>A baton is a commit</Kicker>
        <div style={{fontSize: 108, fontWeight: 600, letterSpacing: -5, marginTop: 30}}>Small enough to resume. Rich enough to trust.</div>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 82}}>
          {cards.map(([title, body, color], i) => {
            const p = enter(frame, fps, 0.5 + i * 0.28, 0.7);
            return (
              <div key={title} style={{opacity: p, transform: `translateY(${(1 - p) * 65}px)`, padding: "44px 48px", borderRadius: 28, background: "linear-gradient(145deg,rgba(18,25,38,.94),rgba(8,11,17,.92))", border: `1px solid ${C.line}`, boxShadow: "0 20px 70px rgba(0,0,0,.28)"}}>
                <div style={{fontSize: 25, fontWeight: 700, letterSpacing: 6, color}}>{title}</div>
                <div style={{fontSize: 42, lineHeight: 1.25, marginTop: 22}}>{body}</div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
};

const ArchitectureScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const nodes = [
    {name: "SEAL", copy: "Encrypts + controls access", color: C.violet},
    {name: "WALRUS", copy: "Stores sealed context", color: C.cyan},
    {name: "SUI", copy: "Anchors lineage + ownership", color: C.blue},
  ];
  const line = enter(frame, fps, 1.05, 2.4);
  return (
    <SceneShell accent={C.blue}>
      <div style={{position: "absolute", left: 170, right: 170, top: 250}}>
        <Kicker>Built on the Sui stack</Kicker>
        <div style={{fontSize: 104, fontWeight: 600, letterSpacing: -5, marginTop: 30}}>No plaintext backend. No memory silo.</div>
        <div style={{position: "relative", marginTop: 130, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 58}}>
          <div style={{position: "absolute", left: "15%", right: "15%", top: 95, height: 5, borderRadius: 5, background: `linear-gradient(90deg,${C.violet},${C.cyan},${C.blue})`, transformOrigin: "left", transform: `scaleX(${line})`, boxShadow: `0 0 30px ${C.cyan}`}} />
          {nodes.map((node, i) => {
            const p = enter(frame, fps, 0.45 + i * 0.4, 0.75);
            return (
              <div key={node.name} style={{position: "relative", zIndex: 2, opacity: p, transform: `translateY(${(1 - p) * 70}px)`, padding: "65px 52px", minHeight: 310, borderRadius: 30, textAlign: "center", background: "rgba(9,13,21,.94)", border: `2px solid ${node.color}`, boxShadow: `0 0 55px ${node.color}22`}}>
                <div style={{margin: "0 auto 55px", width: 58, height: 58, borderRadius: "50%", background: node.color, boxShadow: `0 0 34px ${node.color}`}} />
                <div style={{fontSize: 56, fontWeight: 700, letterSpacing: 8}}>{node.name}</div>
                <div style={{fontSize: 32, color: C.soft, lineHeight: 1.3, marginTop: 22}}>{node.copy}</div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
};

const HandoffScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const agents = ["OPENCODE", "CODEX", "CLAUDE CODE"];
  const travel = interpolate(frame, [1.1 * fps, 4.5 * fps], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  return (
    <SceneShell accent={C.green}>
      <div style={{position: "absolute", left: 170, right: 170, top: 255}}>
        <Kicker>Cross-agent continuity</Kicker>
        <div style={{fontSize: 112, fontWeight: 600, letterSpacing: -5, marginTop: 30}}>Pass once. Resume anywhere.</div>
        <div style={{position: "relative", height: 540, marginTop: 105}}>
          <div style={{position: "absolute", left: "8%", right: "8%", top: 130, height: 3, background: C.line}} />
          {agents.map((a, i) => {
            const p = enter(frame, fps, 0.35 + i * 0.35, 0.7);
            return <div key={a} style={{position: "absolute", left: `${i * 42}%`, width: "16%", opacity: p, textAlign: "center"}}>
              <div style={{margin: "0 auto", width: 150, height: 150, borderRadius: 38, border: `1px solid ${i === 2 ? C.green : C.line}`, background: "rgba(11,16,24,.9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 42, fontWeight: 700, color: i === 2 ? C.green : C.white}}>{i + 1}</div>
              <div style={{fontSize: 27, letterSpacing: 4, marginTop: 28}}>{a}</div>
            </div>;
          })}
          <div style={{position: "absolute", left: `calc(7% + ${travel * 84}%)`, top: 78, transform: "translateX(-50%)"}}><BatonMark size={260} progress={0.9} /></div>
          <div style={{position: "absolute", left: 0, right: 0, bottom: 10, display: "flex", justifyContent: "center", gap: 34}}>
            {["HASH VERIFIED", "SOURCE RECOVERED", "ACCESS ENFORCED"].map((t, i) => {
              const p = enter(frame, fps, 4.3 + i * 0.28, 0.55);
              return <div key={t} style={{opacity: p, padding: "18px 28px", borderRadius: 999, border: `1px solid ${C.green}66`, color: C.green, fontSize: 23, letterSpacing: 3}}>✓ {t}</div>;
            })}
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

const ProofScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const stats = [["267", "TypeScript tests"], ["9", "Move tests"], ["3.2 MB", "remote plaintext audited"], ["LIVE", "Sui Testnet"]];
  return (
    <SceneShell accent={C.green}>
      <div style={{position: "absolute", left: 170, right: 170, top: 270}}>
        <Kicker>Working software, not a mock</Kicker>
        <div style={{fontSize: 112, fontWeight: 600, letterSpacing: -5, marginTop: 30}}>Proven across Sui, Walrus, and Seal.</div>
        <div style={{display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24, marginTop: 110}}>
          {stats.map(([value, label], i) => {
            const p = enter(frame, fps, 0.65 + i * 0.3, 0.75);
            return <div key={label} style={{opacity: p, transform: `translateY(${(1 - p) * 60}px)`, padding: "55px 40px", borderRadius: 28, background: "rgba(10,15,22,.9)", border: `1px solid ${C.line}`, minHeight: 250}}>
              <div style={{fontSize: 74, fontWeight: 700, color: i === 3 ? C.green : C.white, letterSpacing: -2}}>{value}</div>
              <div style={{fontSize: 27, color: C.soft, marginTop: 26, lineHeight: 1.3}}>{label}</div>
            </div>;
          })}
        </div>
        <div style={{fontSize: 26, color: C.soft, marginTop: 58}}>Owner recovery · delegated sharing · on-chain revocation · resumable publication · non-mutating audit</div>
      </div>
    </SceneShell>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = enter(frame, fps, 0.35, 1.0);
  const link = enter(frame, fps, 2.1, 0.75);
  return (
    <SceneShell>
      <div style={{position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center"}}>
        <div style={{opacity: p, transform: `scale(${0.93 + p * 0.07})`}}>
          <div style={{display: "flex", justifyContent: "center"}}><BatonMark size={500} progress={1} /></div>
          <div style={{fontSize: 190, fontWeight: 700, letterSpacing: 20, marginTop: -18}}>BATON</div>
          <div style={{fontSize: 55, color: C.soft, marginTop: 28}}>The handoff layer nobody owns but you.</div>
          <div style={{opacity: link, display: "inline-flex", alignItems: "center", gap: 18, marginTop: 65, padding: "22px 36px", borderRadius: 999, border: `1px solid ${C.cyan}88`, color: C.cyan, fontSize: 28, letterSpacing: 2}}>github.com/mandatedisrael/Baton</div>
        </div>
      </div>
    </SceneShell>
  );
};

const transition = linearTiming({durationInFrames: 18});

export const BatonIntroduction: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: C.bg}}>
      <Audio
        src={staticFile("baton-soundtrack.wav")}
        volume={(f) => interpolate(f, [0, fps, durationInFrames - 2 * fps, durationInFrames], [0, 0.28, 0.28, 0], clamp)}
      />
      <Sequence from={15} premountFor={fps}>
        <Audio src={staticFile("baton-voice.wav")} volume={0.92} />
      </Sequence>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={210}><HookScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={240}><FragmentScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({direction: "from-right"})} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={240}><RevealScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={300}><PayloadScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({direction: "from-bottom"})} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={330}><ArchitectureScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={300}><HandoffScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({direction: "from-right"})} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={300}><ProofScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transition} />
        <TransitionSeries.Sequence durationInFrames={270}><OutroScene /></TransitionSeries.Sequence>
      </TransitionSeries>
      <Sequence premountFor={fps}>
        <div style={{position: "absolute", left: 112, bottom: 70, width: 520, height: 3, background: C.line}}>
          <div style={{height: "100%", width: `${(frame / durationInFrames) * 100}%`, background: `linear-gradient(90deg,${C.blue},${C.cyan},${C.violet})`, boxShadow: `0 0 12px ${C.cyan}`}} />
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
