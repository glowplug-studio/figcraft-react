# Cross-repository mapping

Graphify indexes `glowplug-studio/figcraft` and `glowplug-studio/figcraft-react` independently. It does not automatically determine which Rust and TypeScript symbols are equivalent.

Add mappings only after inspecting behaviour, callers, data contracts and tests. Preserve upstream command identifiers, file-format keys and user-facing terminology where they are compatibility contracts; otherwise use idiomatic TypeScript names and record the relationship here.

| Port scope | Upstream Rust module or symbol | Upstream evidence | TypeScript target | Parity tests | Status |
|---|---|---|---|---|---|
