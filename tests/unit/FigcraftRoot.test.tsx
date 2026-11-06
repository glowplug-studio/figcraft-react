import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FigcraftRoot } from "../../src";

describe("FigcraftRoot", () => {
  it("provides a stable embeddable host boundary", () => {
    const markup = renderToStaticMarkup(<FigcraftRoot className="host" />);

    expect(markup).toBe('<div data-figcraft-root="" class="host"></div>');
  });
});
