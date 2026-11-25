# Native observations for facilitation

Data: [native-board-facilitate.json](native-board-facilitate.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `results` are native's answer to each command on a new board with three stickies and a shape:

- **Timer.** Pausing and adding with no timer; a three-minute start, a pause, a minute added while paused, a resume; the refusals for pausing twice, resuming a running timer, zero and 1441 minutes, a word for minutes, an unknown action, a number for an action and no action; a stop.
- **Votes.** A vote of two each on stickies. Three voters cast and retract, one with a name padded by spaces and a control character. The refusals: a second vote, no votes left, a shape, a missing layer, an id that is a word, a vote not there to retract. One voter's view while it runs; the end, everyone's results, a deleted sticky's votes no longer counting, and clearing.
- **More votes.** A vote on the selection; a vote on all with one each and a number as the voter; the refusals for votes of 0, 100 and 1.5, an unknown scope, an empty, bad, page-only, non-list and missing selection; a scope that isn't text taken as all, and votes as text.
- **Kept results.** Deleting kept results with no index, a negative index, an index as text, one too large, the shown ones, and the oldest; an unknown action; clearing twice.

`document` is the `document.json` of the save that ends the run. Times (`ends`, `ended`) depend on the clock and are compared by what they mean.
