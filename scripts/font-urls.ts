// Literal URLs let browser bundlers emit the same files used by the CSS catalogue.
export const fontUrls = [
  new URL("../fonts/inter/Inter-Regular.ttf", import.meta.url),
  new URL("../fonts/inter/Inter-Italic.ttf", import.meta.url),
  new URL("../fonts/inter/Inter-SemiBold.ttf", import.meta.url),
  new URL("../fonts/inter/Inter-Bold.ttf", import.meta.url),
  new URL("../fonts/noto-sans-georgian/NotoSansGeorgian.ttf", import.meta.url),
];
