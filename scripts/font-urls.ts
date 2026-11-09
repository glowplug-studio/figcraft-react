// Both loaders use literal URLs so bundlers can trace each font independently.
export const interRegular = new URL("../fonts/inter/Inter-Regular.ttf", import.meta.url);
export const interItalic = new URL("../fonts/inter/Inter-Italic.ttf", import.meta.url);
export const interSemiBold = new URL("../fonts/inter/Inter-SemiBold.ttf", import.meta.url);
export const interBold = new URL("../fonts/inter/Inter-Bold.ttf", import.meta.url);
export const notoGeorgian = new URL("../fonts/noto-sans-georgian/NotoSansGeorgian.ttf", import.meta.url);

export const fontUrls = [interRegular, interItalic, interSemiBold, interBold, notoGeorgian];
