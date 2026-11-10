//// Turns the markdown tree into Lustre elements: the rendered page.
//// Imported by: the app shell. Imports: `markdown`.

import lustre/element.{type Element}
import scribbl/markdown.{type Block}

/// Safe by construction: all text goes through `element.text` (escaped) and
/// this module never uses `element.unsafe_raw_html`. Link URLs are kept only
/// for http, https, mailto and relative paths.
///
/// A task item renders a checkbox. Ticking it sends `on_task_toggled(row)`
/// with the item's source row, and the shell rewrites that line. The page
/// never edits text itself.
///
/// Wrapped in `data-test-id="preview"`. M6 HTML export is
/// `element.to_string(preview.view(blocks, ..))`.
pub fn view(
  blocks: List(Block),
  on_task_toggled: fn(Int) -> msg,
) -> Element(msg) {
  let _ = #(blocks, on_task_toggled)
  todo as "not implemented"
}
