import { useEffect, useRef, useState } from "react";
import type { ColourProfile } from "./engine/colour-spaces";

const labels = { srgb: "sRGB", displayP3: "Display P3" } as const;
interface Props {
  current: ColourProfile;
  close(): void;
  apply(profile: ColourProfile, convert: boolean): void;
}
export function ColourProfileDialog({ current, close, apply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState(current);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label="Color profile" onCancel={close} style={{maxWidth:"min(340px, 85vw)"}}>
    <h2>Color profile</h2>
    <p>Color values in this file are in this color space.</p>
    {(["srgb", "displayP3"] as const).map(profile => <label key={profile} style={{display:"flex", alignItems:"center", gap:8, marginBlock:6}}>
      <input style={{width:"auto", margin:0}} type="radio" name="file-profile" checked={chosen === profile} onChange={() => setChosen(profile)} />
      {labels[profile]}{profile === current && " (current)"}
    </label>)}
    {chosen === current ? <p>Choose another profile to change it.</p> : <>
      <p>Keep appearance converts every color value to {labels[chosen]} so colors look the same. Keep values leaves the numbers as they are, so colors shift.</p>
      {chosen === "displayP3" && <p>The canvas previews colors in sRGB.</p>}
      <button onClick={() => apply(chosen, true)}>Keep appearance</button>
      <button onClick={() => apply(chosen, false)}>Keep values</button>
    </>}
    <button onClick={close}>Close</button>
  </dialog>;
}
