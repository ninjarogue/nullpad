import lustre
import nullpad/app
import nullpad/platform
import nullpad/storage
import nullpad/storage/indexeddb

const vim_keys_are_written = False

pub fn main() -> Nil {
  let flags =
    app.Flags(
      storage: storage.new(indexeddb.backend()),
      vim: platform.read_vim_setting(),
      can_vim: vim_keys_are_written && platform.has_hardware_keyboard(),
      live: platform.read_live_setting(),
    )
  let assert Ok(_) =
    lustre.application(app.init, app.update, app.view)
    |> lustre.start("#app", flags)
  Nil
}
