import "./index.css";
import {Composition} from "remotion";
import {BatonIntroduction} from "./Composition";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="BatonIntroduction4K"
    component={BatonIntroduction}
    durationInFrames={2064}
    fps={30}
    width={3840}
    height={2160}
  />
);
