import lustre
import scribbl/app
import scribbl/platform
import scribbl/storage
import scribbl/storage/indexeddb

/// Start scribbl in the page's `#app` element.
pub fn main() -> Nil {
  let flags =
    app.Flags(
      storage: storage.new(indexeddb.backend()),
      vim: platform.read_vim_setting(),
      // M4 turns the vim switch on: `platform.has_hardware_keyboard()`.
      can_vim: False,
    )
  let assert Ok(_) =
    lustre.application(app.init, app.update, app.view)
    |> lustre.start("#app", flags)
  Nil
}
