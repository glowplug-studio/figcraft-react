import { FigcraftRoot } from "@glowplug-studio/figcraft-react";

export default function PreviewPage() {
  return (
    <main>
      <header>
        <p>Development preview</p>
        <h1>Figcraft React</h1>
      </header>
      <FigcraftRoot className="figcraft-preview">
        <p>No Figcraft features have been ported yet.</p>
      </FigcraftRoot>
    </main>
  );
}
