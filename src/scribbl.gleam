import lustre
import scribbl/app
import scribbl/platform
import scribbl/storage
import scribbl/storage/indexeddb

const vim_keys_are_written = False

pub fn main() -> Nil {
  let flags =
    app.Flags(
      storage: storage.new(indexeddb.backend()),
      vim: platform.read_vim_setting(),
      can_vim: vim_keys_are_written && platform.has_hardware_keyboard(),
    )
  let assert Ok(_) =
    lustre.application(app.init, app.update, app.view)
    |> lustre.start("#app", flags)
  Nil
}
