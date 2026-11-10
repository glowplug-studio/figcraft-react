# Design file interchange verification

At 978b2f7, upstream a2e87433 supplied fourteen independent export sessions. Nine produced PNG images. Five defined input failures. The independent browser renderer matched the native dimensions and supported profile metadata. In the fractional-width scene, Chromium paints 9–13 alpha levels on a final 0.05-pixel strip where the native image is transparent. Elsewhere the tested premultiplied channels agree within two levels. Signed-in PNG downloads matched the selected name and size and preserved the document's dirty flag.

Strict types, both builds, 2,049 pure checks, two local Auth integrations and all 304 production Chromium workflows passed in 603.9 seconds. The scoped Supabase MCP project read succeeded. Raster export runs locally and uses browser downloads. The active branch is prompt/full-figcraft-port. The application-wide upstream baseline is unchanged.

JPEG, WebP, export settings, batch output, vector and design-file codecs and subsequent roadmap rows remain in progress. [Property matrix](26-11-10-file-interchange-parity.html) · [Execution plan](../planning/26-11-10-file-interchange.md).
