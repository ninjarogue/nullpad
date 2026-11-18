//// The architecture rules in AGENTS.md, as a check over the syntax tree.
//// Gleam files are parsed with glance, so imports, calls and types are the
//// real ones. JavaScript is only checked for where it lives: what it does
//// inside a file is left to review, because matching its text line by line
//// let most breaks through.
////
//// The defaults fail: a module nobody listed, a function with no return
//// type and JavaScript nobody called a measure are all reported, so new
//// code has to say what it is before it passes.

import glance
import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/set.{type Set}
import gleam/string

/// Pure modules: no Lustre, no browser.
const core = [
  "buffer",
  "vim",
  "editor",
  "history",
  "live",
  "markdown",
  "library",
  "list_keys",
]

const core_may_also_import = [#("library", "storage")]

/// Everything else that is not a storage backend under `storage/`.
const shell = ["nullpad", "app", "surface", "preview", "platform", "storage"]

const with_javascript = ["surface", "platform", "markdown"]

/// JavaScript in surface and platform that only reads the page. Every other
/// function there counts as changing it.
const measures = [
  "drawnInPage", "holdsFocus", "caretLine", "endsAtWrap", "headLine",
  "holderText", "paintedOnPage", "locate", "findControl", "textWidth",
  "boldWidth", "utf16Split", "utf16Length", "below", "hasHardwareKeyboard",
  "canPaint", "readVimSetting", "readMarkdownSetting", "pressLanding", "dropped",
  "releasedOnSelection", "focusStayed", "currentEditor", "pastedText",
  "heldKeyEvent", "isApple", "isWindows",
]

const records = ["currentEditor"]

const state_roots = [
  "nullpad/editor.Editor", "nullpad/history.History", "nullpad/library.Library",
  "nullpad/vim.State",
]

const messages = ["nullpad/app.Msg"]

type WrittenAhead {
  WrittenAhead(path: String, function: String)
}

fn written_ahead_key(one: WrittenAhead) -> String {
  one.path <> " " <> one.function
}

const written_ahead = [
  WrittenAhead("test/editor_test.gleam", "pending_dd_deletes_the_cursor_line"),
  WrittenAhead("test/editor_test.gleam", "pending_one_insert_is_one_undo_step"),
]

pub type Source {
  /// `path` is relative to the repository root: "src/nullpad/editor.gleam".
  Source(path: String, text: String)
}

pub type Rule {
  Listed
  Annotated
  CoreImports
  JavaScriptFile
  CallsJavaScript
  BackendImport
  FieldWrite
  ChangesPage
  DecoderState
  SkipsOutcome
  RawHtml
  TestRuns
}

pub const rules = [
  Listed,
  Annotated,
  CoreImports,
  JavaScriptFile,
  CallsJavaScript,
  BackendImport,
  FieldWrite,
  ChangesPage,
  DecoderState,
  SkipsOutcome,
  RawHtml,
  TestRuns,
]

pub fn says(rule: Rule) -> String {
  case rule {
    Listed -> "every module is listed as core, shell or a storage backend"
    Annotated -> "every function says what it takes and returns"
    CoreImports -> "a core module imports only gleam and other core modules"
    JavaScriptFile ->
      "JavaScript lives in the .ffi.mjs of surface, platform, markdown or a storage backend"
    CallsJavaScript ->
      "only surface, platform, markdown and a storage backend call JavaScript, each its own file"
    BackendImport -> "only src/nullpad.gleam imports a storage backend"
    FieldWrite -> "only surface draws the text field"
    ChangesPage ->
      "only a function that returns an Effect or Nil may change the page"
    DecoderState ->
      "a handler is handed no app state: it reads the editor from a record when its event comes"
    SkipsOutcome ->
      "a public editor function that changes the editor returns an Outcome"
    RawHtml -> "nothing draws raw HTML"
    TestRuns ->
      "every test in test/ is one gleeunit runs on JavaScript: public, no arguments, named _test, and for a target we run"
  }
}

pub type Broken {
  Broken(rule: Rule, path: String, detail: String)
}

pub type Report {
  Report(
    broken: List(Broken),
    /// What each rule examined, so a rule that examines nothing shows.
    looked: List(#(Rule, String)),
    /// Problems with this check itself: a rule with nothing to examine, a
    /// listed module that is gone, an allowance nothing needs any more.
    faults: List(String),
  )
}

pub opaque type File {
  Gleam(path: String, name: String, module: glance.Module)
  JavaScript(path: String, name: String)
  GleamTest(path: String, module: glance.Module)
  Other(path: String)
  Unreadable(path: String)
}

pub fn read(source: Source) -> File {
  case string.starts_with(source.path, "test/") {
    True -> read_test_source(source)
    False -> read_src(source)
  }
}

fn read_src(source: Source) -> File {
  let gleam = string.ends_with(source.path, ".gleam")
  let javascript = string.ends_with(source.path, ".ffi.mjs")
  let stem =
    strip_prefix(source.path, "src/")
    |> string.replace(".ffi.mjs", "")
    |> string.replace(".gleam", "")
  let name = case stem, string.starts_with(stem, "nullpad/") {
    "nullpad", _ -> stem
    _, True -> strip_prefix(stem, "nullpad/")
    _, False -> "src/" <> stem
  }
  case gleam, javascript {
    True, _ ->
      case glance.module(source.text) {
        Ok(module) -> Gleam(source.path, name, module)
        Error(_) -> Unreadable(source.path)
      }
    False, True -> JavaScript(source.path, name)
    False, False -> Other(source.path)
  }
}

fn read_test_source(source: Source) -> File {
  case glance.module(source.text) {
    Ok(module) -> GleamTest(source.path, module)
    Error(_) -> Unreadable(source.path)
  }
}

pub fn path(file: File) -> String {
  file.path
}

pub fn judge(files: List(File)) -> Report {
  let changers = changers(files)
  let context = context(files)
  let checking = checking_tests(files)
  let found =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) ->
          list.flatten([
            listed(path, name),
            annotated(path, module),
            core_imports(path, name, module),
            calls_javascript(path, name, module),
            backend_import(path, name, module),
            changes_page(path, name, module, changers),
            decoder_state(path, name, module, context),
            skips_outcome(path, name, module),
            forbidden_calls(path, name, module),
          ])
        JavaScript(path:, name:) -> javascript(path, name)
        GleamTest(path:, module:) -> tests_run(path, module, checking)
        Other(path) -> [
          Found(Broken(JavaScriptFile, path, "not a .gleam or .ffi.mjs file")),
        ]
        Unreadable(_) -> []
      }
    })
  let broken =
    list.filter_map(found, fn(one) {
      case one {
        Found(broken) -> Ok(broken)
        Looked(..) -> Error(Nil)
      }
    })
  let looked =
    list.filter_map(found, fn(one) {
      case one {
        Looked(rule, at) -> Ok(#(rule, at))
        Found(_) -> Error(Nil)
      }
    })
  let looked = [
    #(
      DecoderState,
      "app state is "
        <> string.join(
        set.to_list(context.state_types) |> list.sort(string.compare),
        ", ",
      ),
    ),
    ..looked
  ]
  Report(broken:, looked:, faults: faults(files, looked))
}

type Finding {
  Found(Broken)
  Looked(rule: Rule, at: String)
}

fn is_core(name: String) -> Bool {
  list.contains(core, name)
}

fn is_backend(name: String) -> Bool {
  string.starts_with(name, "storage/")
}

fn has_javascript(name: String) -> Bool {
  list.contains(with_javascript, name) || is_backend(name)
}

/// Whose JavaScript can change the page. A storage backend's cannot.
fn touches_page(name: String) -> Bool {
  !is_core(name) && !is_backend(name)
}

fn strip_prefix(text: String, prefix: String) -> String {
  case string.starts_with(text, prefix) {
    True -> string.drop_start(text, string.length(prefix))
    False -> text
  }
}

fn when(condition: Bool, otherwise: fn() -> List(a)) -> List(a) {
  case condition {
    True -> otherwise()
    False -> []
  }
}

fn listed(path: String, name: String) -> List(Finding) {
  case is_core(name) || list.contains(shell, name) || is_backend(name) {
    True -> [Looked(Listed, path)]
    False -> [
      Looked(Listed, path),
      Found(Broken(
        Listed,
        path,
        "add \""
          <> name
          <> "\" to core or shell in test/architecture/rules.gleam",
      )),
    ]
  }
}

fn annotated(path: String, module: glance.Module) -> List(Finding) {
  let broken =
    list.flat_map(module.functions, fn(definition) {
      let function = definition.definition
      let untyped =
        list.any(function.parameters, fn(parameter) {
          option.map(parameter.type_, has_hole) |> option.unwrap(True)
        })
      let no_return =
        option.map(function.return, has_hole) |> option.unwrap(True)
      list.flatten([
        when(no_return, fn() {
          [
            Found(Broken(
              Annotated,
              path,
              function.name <> " has no return type",
            )),
          ]
        }),
        when(untyped, fn() {
          [
            Found(Broken(
              Annotated,
              path,
              function.name <> " has an untyped parameter",
            )),
          ]
        }),
      ])
    })
  [Looked(Annotated, path), ..broken]
}

fn has_hole(type_: glance.Type) -> Bool {
  case type_ {
    glance.HoleType(..) -> True
    glance.VariableType(..) -> False
    glance.NamedType(parameters:, ..) -> list.any(parameters, has_hole)
    glance.TupleType(elements:, ..) -> list.any(elements, has_hole)
    glance.FunctionType(parameters:, return:, ..) ->
      has_hole(return) || list.any(parameters, has_hole)
  }
}

fn core_imports(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(is_core(name))
  let broken =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition.module
      let other = strip_prefix(imported, "nullpad/")
      let fine =
        string.starts_with(imported, "gleam/")
        || {
          string.starts_with(imported, "nullpad/")
          && {
            is_core(other)
            || list.contains(core_may_also_import, #(name, other))
          }
        }
      case fine {
        True -> Error(Nil)
        False -> Ok(Found(Broken(CoreImports, path, "import " <> imported)))
      }
    })
  [Looked(CoreImports, path), ..broken]
}

fn calls_javascript(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  let own =
    "./"
    <> { string.split(name, "/") |> list.last |> result.unwrap(name) }
    <> ".ffi.mjs"
  let broken =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition.name
      case external(definition), has_javascript(name) {
        Some(_), False -> Ok(Found(Broken(CallsJavaScript, path, function)))
        Some(External(file:, ..)), True if file != own ->
          Ok(
            Found(Broken(CallsJavaScript, path, function <> " calls " <> file)),
          )
        _, _ -> Error(Nil)
      }
    })
  [Looked(CallsJavaScript, path), ..broken]
}

fn backend_import(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(name != "nullpad")
  let broken =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition.module
      case string.starts_with(imported, "nullpad/storage/") {
        True -> Ok(Found(Broken(BackendImport, path, "import " <> imported)))
        False -> Error(Nil)
      }
    })
  [Looked(BackendImport, path), ..broken]
}

fn changes_page(
  path: String,
  name: String,
  module: glance.Module,
  changers: Set(String),
) -> List(Finding) {
  use <- when(!is_core(name))
  let key = module_key(path)
  let resolve = resolver(key, module)
  let aliases = aliases_of(module)
  let broken =
    list.flat_map(module.functions, fn(definition) {
      let function = definition.definition
      use <- when(!may_change(function, aliases))
      uses(function, resolve)
      |> list.filter(set.contains(changers, _))
      |> list.map(fn(called) {
        Found(Broken(ChangesPage, path, function.name <> " uses " <> called))
      })
    })
  let examined =
    list.count(module.functions, fn(definition) {
      !may_change(definition.definition, aliases)
    })
  [
    Looked(
      ChangesPage,
      name <> " (" <> int.to_string(examined) <> " functions)",
    ),
    ..broken
  ]
}

fn may_change(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
) -> Bool {
  case option.map(function.return, expand(_, aliases)) {
    Some(glance.NamedType(name: "Nil", ..)) -> True
    Some(returned) -> mentions(returned, ["Effect"])
    None -> False
  }
}

fn aliases_of(module: glance.Module) -> Dict(String, glance.Type) {
  let renamed =
    list.flat_map(module.imports, fn(definition) {
      let imported = definition.definition
      list.filter_map(imported.unqualified_types, fn(type_) {
        case type_.alias {
          Some(alias) ->
            Ok(#(
              alias,
              glance.NamedType(
                location: imported.location,
                name: type_.name,
                module: None,
                parameters: [],
              ),
            ))
          None -> Error(Nil)
        }
      })
    })
  list.map(module.type_aliases, fn(definition) {
    #(definition.definition.name, definition.definition.aliased)
  })
  |> list.append(renamed, _)
  |> dict.from_list
}

/// The type with this module's own aliases replaced by what they stand for.
fn expand(
  type_: glance.Type,
  aliases: Dict(String, glance.Type),
) -> glance.Type {
  let each = list.map(_, expand(_, aliases))
  case type_ {
    glance.NamedType(location:, name:, module: None, parameters:) ->
      case dict.get(aliases, name) {
        Ok(glance.NamedType(parameters: [], ..) as aliased) ->
          expand(
            glance.NamedType(..aliased, parameters:),
            dict.delete(aliases, name),
          )
        Ok(aliased) -> expand(aliased, dict.delete(aliases, name))
        Error(Nil) ->
          glance.NamedType(
            location:,
            name:,
            module: None,
            parameters: each(parameters),
          )
      }
    glance.NamedType(location:, name:, module:, parameters:) ->
      glance.NamedType(location:, name:, module:, parameters: each(parameters))
    glance.TupleType(location:, elements:) ->
      glance.TupleType(location:, elements: each(elements))
    glance.FunctionType(location:, parameters:, return:) ->
      glance.FunctionType(
        location:,
        parameters: each(parameters),
        return: expand(return, aliases),
      )
    glance.VariableType(..) | glance.HoleType(..) -> type_
  }
}

/// `List(Element(msg))` and `Option(Decoder(a))` count as well.
fn mentions(type_: glance.Type, names: List(String)) -> Bool {
  case type_ {
    glance.NamedType(name:, parameters:, ..) ->
      list.contains(names, name) || list.any(parameters, mentions(_, names))
    glance.TupleType(elements:, ..) -> list.any(elements, mentions(_, names))
    glance.FunctionType(return:, ..) -> mentions(return, names)
    glance.VariableType(..) | glance.HoleType(..) -> False
  }
}

fn decoder_state(
  path: String,
  name: String,
  module: glance.Module,
  context: Context,
) -> List(Finding) {
  use <- when(!is_core(name) && !is_backend(name))
  let key = module_key(path)
  let resolve = resolver(key, module)
  let types = type_resolver(key, module)
  let aliases = aliases_of(module)
  let modules =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition
      case imported.alias {
        Some(glance.Named(alias)) -> Ok(alias)
        Some(glance.Discarded(_)) -> Error(Nil)
        None -> string.split(imported.module, "/") |> list.last
      }
    })
    |> set.from_list
  let measured =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition
      case external(definition), function.return {
        Some(External(function: javascript, ..)), Some(returned) ->
          case
            list.contains(measures, javascript)
            && !list.contains(records, javascript)
            && holds(returned, types, context.state_types)
          {
            True ->
              Ok(
                Found(Broken(
                  DecoderState,
                  path,
                  function.name
                    <> " is a measure that hands back app state: list it under records",
                )),
              )
            False -> Error(Nil)
          }
        _, _ -> Error(Nil)
      }
    })
  let judged =
    list.map(module.functions, fn(definition) {
      let function = definition.definition
      let this = key <> "." <> function.name
      let used = uses(function, resolve)
      let made =
        list.filter(used, builds(
          _,
          context.decoder_functions,
          runs(function, used, aliases),
        ))
      let maker = made != []
      let reaches = set.contains(context.handler_builders, this)
      let scope =
        Scope(
          held: set.from_list(held_parameters(
            function,
            types,
            context.state_types,
          )),
          closures: set.from_list(closure_parameters(
            function,
            types,
            context.state_types,
          )),
          modules:,
          sink: fn(callee) {
            case seen_callee(callee) {
              Some(seen) ->
                case resolve(seen) {
                  Ok(called) ->
                    case dict.get(context.callback_takers, called) {
                      Ok(parameters) -> Some(#(called, parameters))
                      Error(Nil) -> None
                    }
                  Error(Nil) -> None
                }
              None -> None
            }
          },
        )
      let broken =
        list.flatten([
          case maker, made {
            True, [called, ..] ->
              list.flat_map(function.parameters, fn(parameter) {
                case parameter.name, parameter.type_ {
                  glance.Named(held), Some(type_) ->
                    case
                      holds(type_, types, context.state_types),
                      calls_back(type_, types, context.callback_types)
                    {
                      True, _ -> [
                        function.name
                        <> " makes a handler with "
                        <> held
                        <> " in scope, through "
                        <> called,
                      ]
                      False, True -> [
                        function.name
                        <> " makes a handler through "
                        <> called
                        <> " and is handed "
                        <> held
                        <> ", a callback that hands back more than a message",
                      ]
                      False, False -> []
                    }
                  _, _ -> []
                }
              })
            _, _ -> []
          },
          case reaches {
            True ->
              early_reads(
                function.body,
                fn(seen) {
                  case resolve(seen) {
                    Ok(called) ->
                      set.contains(context.early_readers, called)
                      && !set.contains(context.handler_builders, called)
                    Error(Nil) -> False
                  }
                },
                runs_later(resolve),
                bound_names(function),
                set.new(),
              )
              |> list.unique
              |> list.map(fn(reader) {
                function.name
                <> " reads "
                <> reader
                <> " while it makes handlers, not when the event comes"
              })
            False -> []
          },
          handed_in(function.body, scope)
            |> list.unique
            |> list.map(fn(called) {
              function.name
              <> " hands "
              <> called
              <> " a closure over app state"
            }),
        ])
      #(reaches, maker, broken)
    })
  let count = fn(picks: fn(#(Bool, Bool, List(String))) -> Bool) {
    int.to_string(list.count(judged, picks))
  }
  [
    Looked(
      DecoderState,
      name
        <> " ("
        <> count(fn(one) { one.1 })
        <> " make handlers or decoders, "
        <> count(fn(one) { one.0 })
        <> " make or reach them)",
    ),
    ..list.append(
      measured,
      list.flat_map(judged, fn(one) {
        list.map(one.2, fn(detail) { Found(Broken(DecoderState, path, detail)) })
      }),
    )
  ]
}

fn runs(
  function: glance.Function,
  used: List(String),
  aliases: Dict(String, glance.Type),
) -> Bool {
  list.contains(used, "gleam/dynamic/decode.run")
  && !is_decoder(function, aliases)
}

fn builds(called: String, decoders: Set(String), runs: Bool) -> Bool {
  string.starts_with(called, "lustre/event.")
  || !runs
  && {
    string.starts_with(called, "gleam/dynamic/decode.")
    && called != "gleam/dynamic/decode.run"
    || set.contains(decoders, called)
  }
}

fn is_decoder(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
) -> Bool {
  string.ends_with(function.name, "_decoder")
  || case function.return {
    Some(returned) -> mentions(expand(returned, aliases), ["Decoder"])
    None -> False
  }
}

type TypeKey =
  String

fn type_resolver(
  key: String,
  module: glance.Module,
) -> fn(Option(String), String) -> TypeKey {
  let locals =
    list.map(module.custom_types, fn(definition) { definition.definition.name })
    |> list.append(
      list.map(module.type_aliases, fn(definition) {
        definition.definition.name
      }),
    )
    |> set.from_list
  let modules: Dict(String, String) =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition
      case imported.alias {
        Some(glance.Named(alias)) -> Ok(#(alias, imported.module))
        Some(glance.Discarded(_)) -> Error(Nil)
        None ->
          string.split(imported.module, "/")
          |> list.last
          |> result.map(fn(alias) { #(alias, imported.module) })
      }
    })
    |> dict.from_list
  let unqualified: Dict(String, TypeKey) =
    list.flat_map(module.imports, fn(definition) {
      let imported = definition.definition
      list.map(imported.unqualified_types, fn(type_) {
        #(
          option.unwrap(type_.alias, type_.name),
          imported.module <> "." <> type_.name,
        )
      })
    })
    |> dict.from_list
  fn(qualifier, name) {
    case qualifier {
      Some(alias) ->
        case dict.get(modules, alias) {
          Ok(module) -> module <> "." <> name
          Error(Nil) -> alias <> "." <> name
        }
      None ->
        case set.contains(locals, name), dict.get(unqualified, name) {
          True, _ -> key <> "." <> name
          False, Ok(found) -> found
          False, Error(Nil) -> "gleam." <> name
        }
    }
  }
}

fn holds(
  type_: glance.Type,
  types: fn(Option(String), String) -> TypeKey,
  among: Set(TypeKey),
) -> Bool {
  let inner = holds(_, types, among)
  case type_ {
    glance.NamedType(name:, module:, parameters:, ..) ->
      set.contains(among, types(module, name)) || list.any(parameters, inner)
    glance.TupleType(elements:, ..) -> list.any(elements, inner)
    glance.FunctionType(return:, ..) -> inner(return)
    glance.VariableType(..) | glance.HoleType(..) -> False
  }
}

fn calls_back(
  type_: glance.Type,
  types: fn(Option(String), String) -> TypeKey,
  among: Set(TypeKey),
) -> Bool {
  let inner = calls_back(_, types, among)
  case type_ {
    glance.NamedType(name:, module:, parameters:, ..) ->
      set.contains(among, types(module, name)) || list.any(parameters, inner)
    glance.TupleType(elements:, ..) -> list.any(elements, inner)
    glance.FunctionType(return: glance.VariableType(..), ..) -> False
    glance.FunctionType(return: glance.NamedType(name:, module:, ..), ..) ->
      !list.contains(messages, types(module, name))
    glance.FunctionType(..) -> True
    glance.VariableType(..) | glance.HoleType(..) -> False
  }
}

fn has_function(type_: glance.Type) -> Bool {
  case type_ {
    glance.NamedType(parameters:, ..) -> list.any(parameters, has_function)
    glance.TupleType(elements:, ..) -> list.any(elements, has_function)
    glance.FunctionType(..) -> True
    glance.VariableType(..) | glance.HoleType(..) -> False
  }
}

fn held_parameters(
  function: glance.Function,
  types: fn(Option(String), String) -> TypeKey,
  state: Set(TypeKey),
) -> List(String) {
  list.filter_map(function.parameters, fn(parameter) {
    case parameter.name, parameter.type_ {
      glance.Named(name), Some(type_) ->
        case holds(type_, types, state) {
          True -> Ok(name)
          False -> Error(Nil)
        }
      _, _ -> Error(Nil)
    }
  })
}

fn closure_parameters(
  function: glance.Function,
  types: fn(Option(String), String) -> TypeKey,
  state: Set(TypeKey),
) -> List(String) {
  list.filter_map(function.parameters, fn(parameter) {
    case parameter.name, parameter.type_ {
      glance.Named(name), Some(type_) ->
        case holds(type_, types, state) && has_function(type_) {
          True -> Ok(name)
          False -> Error(Nil)
        }
      _, _ -> Error(Nil)
    }
  })
}

type Context {
  Context(
    state_types: Set(TypeKey),
    callback_types: Set(TypeKey),
    decoder_functions: Set(String),
    handler_builders: Set(String),
    callback_takers: Dict(String, Option(List(#(Option(String), Bool)))),
    early_readers: Set(String),
  )
}

const decodes = [
  "gleam/dynamic/decode.then", "gleam/dynamic/decode.field",
  "gleam/dynamic/decode.optional_field", "gleam/dynamic/decode.subfield",
  "gleam/dynamic/decode.map",
]

fn decoding(resolve: fn(Seen) -> Result(String, Nil)) -> fn(Seen) -> Bool {
  fn(seen) {
    case resolve(seen) {
      Ok(called) -> list.contains(decodes, called)
      Error(Nil) -> False
    }
  }
}

fn runs_later(resolve: fn(Seen) -> Result(String, Nil)) -> fn(Seen) -> Bool {
  fn(seen) {
    case resolve(seen) {
      Ok(called) ->
        list.contains(decodes, called) || list.contains(effect_makers, called)
      Error(Nil) -> False
    }
  }
}

const effect_makers = [
  "lustre/effect.from", "lustre/effect.before_paint",
  "lustre/effect.after_paint",
]

const mappers = ["lustre/element.map", "lustre/effect.map"]

type Known {
  Known(
    key: String,
    shell: Bool,
    function: glance.Function,
    javascript: Option(String),
    aliases: Dict(String, glance.Type),
    types: fn(Option(String), String) -> TypeKey,
    used: List(String),
    resolve: fn(Seen) -> Result(String, Nil),
  )
}

fn context(files: List(File)) -> Context {
  let state = state_types(files)
  let all_types = type_table(files)
  let callbacks =
    grow_types(set.new(), all_types, fn(type_, types, among) {
      calls_back(type_, types, among)
    })
  let known =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) -> {
          let key = module_key(path)
          let resolve = resolver(key, module)
          let types = type_resolver(key, module)
          let aliases = aliases_of(module)
          list.map(module.functions, fn(definition) {
            let function = definition.definition
            Known(
              key: key <> "." <> function.name,
              shell: !is_core(name) && !is_backend(name),
              function:,
              javascript: external(definition)
                |> option.map(fn(found) { found.function }),
              aliases:,
              types:,
              used: uses(function, resolve),
              resolve:,
            )
          })
        }
        JavaScript(..) | GleamTest(..) | Other(_) | Unreadable(_) -> []
      }
    })
  let shell = list.filter(known, fn(one) { one.shell })
  let decoders =
    list.filter_map(shell, fn(one) {
      case is_decoder(one.function, one.aliases) {
        True -> Ok(one.key)
        False -> Error(Nil)
      }
    })
    |> set.from_list
  let counted = fn(one: Known) {
    let running = runs(one.function, one.used, one.aliases)
    Reaching(
      one.key,
      list.filter(one.used, fn(called) {
        !running || !set.contains(decoders, called)
      }),
      list.any(one.used, builds(_, decoders, running)),
    )
  }
  let start =
    list.filter_map(shell, fn(one) {
      case counted(one) {
        Reaching(name:, starts: True, ..) -> Ok(name)
        Reaching(starts: False, ..) -> Error(Nil)
      }
    })
    |> set.from_list
  let reach = grow(start, list.map(shell, counted))
  let parameters = fn(one: Known) {
    list.map(one.function.parameters, fn(parameter) {
      #(parameter.label, case parameter.type_ {
        Some(type_) -> has_function(type_)
        None -> False
      })
    })
  }
  let sinks =
    list.filter_map(shell, fn(one) {
      let listens = case one.javascript {
        Some(_) ->
          list.any(one.function.parameters, fn(parameter) {
            case parameter.type_ {
              Some(type_) -> has_function(type_)
              None -> False
            }
          })
        None -> False
      }
      case set.contains(reach, one.key) || listens {
        True -> Ok(#(one.key, Some(parameters(one))))
        False -> Error(Nil)
      }
    })
    |> list.append(list.map(mappers, fn(mapper) { #(mapper, None) }))
    |> dict.from_list
  let records =
    list.filter_map(known, fn(one) {
      case one.javascript {
        Some(javascript) ->
          case list.contains(records, javascript) {
            True -> Ok(one.key)
            False -> Error(Nil)
          }
        None -> Error(Nil)
      }
    })
    |> set.from_list
  Context(
    state_types: state,
    callback_types: callbacks,
    decoder_functions: decoders,
    handler_builders: reach,
    callback_takers: sinks,
    early_readers: early_readers(records, known),
  )
}

fn early_readers(readers: Set(String), known: List(Known)) -> Set(String) {
  let grown =
    list.fold(known, readers, fn(grown, one) {
      case set.contains(grown, one.key) {
        True -> grown
        False -> {
          let reads =
            early_reads(
              one.function.body,
              fn(seen) {
                case one.resolve(seen) {
                  Ok(called) -> set.contains(grown, called)
                  Error(Nil) -> False
                }
              },
              decoding(one.resolve),
              bound_names(one.function),
              set.new(),
            )
          case reads {
            [] -> grown
            [_, ..] -> set.insert(grown, one.key)
          }
        }
      }
    })
  case set.size(grown) == set.size(readers) {
    True -> grown
    False -> early_readers(grown, known)
  }
}

fn type_table(
  files: List(File),
) -> List(#(TypeKey, fn(Option(String), String) -> TypeKey, List(glance.Type))) {
  list.flat_map(files, fn(file) {
    case file {
      Gleam(path:, module:, ..) -> {
        let key = module_key(path)
        let types = type_resolver(key, module)
        list.append(
          list.map(module.custom_types, fn(definition) {
            let custom = definition.definition
            #(
              key <> "." <> custom.name,
              types,
              list.flat_map(custom.variants, fn(variant) {
                list.map(variant.fields, fn(field) {
                  case field {
                    glance.LabelledVariantField(item:, ..)
                    | glance.UnlabelledVariantField(item:) -> item
                  }
                })
              }),
            )
          }),
          list.map(module.type_aliases, fn(definition) {
            #(key <> "." <> definition.definition.name, types, [
              definition.definition.aliased,
            ])
          }),
        )
      }
      JavaScript(..) | GleamTest(..) | Other(_) | Unreadable(_) -> []
    }
  })
}

fn grow_types(
  among: Set(TypeKey),
  table: List(
    #(TypeKey, fn(Option(String), String) -> TypeKey, List(glance.Type)),
  ),
  picks: fn(glance.Type, fn(Option(String), String) -> TypeKey, Set(TypeKey)) ->
    Bool,
) -> Set(TypeKey) {
  let grown =
    list.fold(table, among, fn(grown, one) {
      let #(key, types, made_of) = one
      case
        !set.contains(grown, key) && list.any(made_of, picks(_, types, grown))
      {
        True -> set.insert(grown, key)
        False -> grown
      }
    })
  case set.size(grown) == set.size(among) {
    True -> grown
    False -> grow_types(grown, table, picks)
  }
}

fn state_types(files: List(File)) -> Set(TypeKey) {
  grow_types(set.from_list(state_roots), type_table(files), holds)
}

fn bound_names(function: glance.Function) -> Set(String) {
  list.filter_map(statements(function.body, set.new()), fn(one) {
    case one {
      Bound(name) -> Ok(name)
      Name(_) | Remote(..) | Text(_) | Stops -> Error(Nil)
    }
  })
  |> list.append(
    list.filter_map(function.parameters, fn(parameter) {
      case parameter.name {
        glance.Named(name) -> Ok(name)
        glance.Discarded(_) -> Error(Nil)
      }
    }),
  )
  |> set.from_list
}

fn early_reads(
  body: List(glance.Statement),
  reader: fn(Seen) -> Bool,
  decodes: fn(Seen) -> Bool,
  bound: Set(String),
  locals: Set(String),
) -> List(String) {
  let early = early_read(_, reader, decodes, bound, locals)
  let rest_of = fn(body, locals) {
    early_reads(body, reader, decodes, bound, locals)
  }
  case body {
    [] -> []
    [glance.Use(function:, ..), ..rest] -> {
      let callee = case function {
        glance.Call(function: callee, ..) -> callee
        bare -> bare
      }
      let later =
        option.map(seen_callee(callee), decodes) |> option.unwrap(False)
      case later {
        True -> early(function)
        False -> list.append(early(function), rest_of(rest, locals))
      }
    }
    [
      glance.Assignment(
        pattern: glance.PatternVariable(name: named, ..),
        value: glance.Fn(body: inner, ..),
        ..,
      ),
      ..rest
    ] -> {
      let locals = case rest_of(inner, locals) {
        [] -> set.delete(locals, named)
        [_, ..] -> set.insert(locals, named)
      }
      rest_of(rest, locals)
    }
    [glance.Assignment(value: inner, ..), ..rest]
    | [glance.Expression(inner), ..rest]
    | [glance.Assert(expression: inner, ..), ..rest] ->
      list.append(early(inner), rest_of(rest, locals))
  }
}

fn early_read(
  subject: glance.Expression,
  reader: fn(Seen) -> Bool,
  decodes: fn(Seen) -> Bool,
  bound: Set(String),
  locals: Set(String),
) -> List(String) {
  let called = case seen_callee(subject) {
    Some(Name(name)) ->
      case set.contains(locals, name) {
        True -> [name]
        False ->
          case !set.contains(bound, name) && reader(Name(name)) {
            True -> [name]
            False -> []
          }
      }
    Some(Remote(alias, label) as seen) ->
      case reader(seen) {
        True -> [alias <> "." <> label]
        False -> []
      }
    _ -> []
  }
  let inside = case subject {
    glance.Fn(..) | glance.FnCapture(..) -> []
    glance.Block(statements:, ..) ->
      early_reads(statements, reader, decodes, bound, locals)
    _ ->
      list.flat_map(expression_parts(subject), early_read(
        _,
        reader,
        decodes,
        bound,
        locals,
      ))
  }
  list.append(called, inside)
}

fn expression_parts(subject: glance.Expression) -> List(glance.Expression) {
  let scope =
    Scope(held: set.new(), closures: set.new(), modules: set.new(), sink: fn(_) {
      None
    })
  list.map(parts(subject, scope), fn(part) { part.0 })
}

type Scope {
  Scope(
    held: Set(String),
    closures: Set(String),
    modules: Set(String),
    sink: fn(glance.Expression) ->
      Option(#(String, Option(List(#(Option(String), Bool))))),
  )
}

fn seen_callee(callee: glance.Expression) -> Option(Seen) {
  case callee {
    glance.Variable(name:, ..) -> Some(Name(name))
    glance.FieldAccess(container: glance.Variable(name:, ..), label:, ..) ->
      Some(Remote(name, label))
    _ -> None
  }
}

fn binding(
  scope: Scope,
  names: List(String),
  held: Bool,
  closure: Bool,
) -> Scope {
  let held_names = case held {
    True -> list.fold(names, scope.held, set.insert)
    False -> list.fold(names, scope.held, set.delete)
  }
  let closures = case held && closure {
    True -> list.fold(names, scope.closures, set.insert)
    False -> list.fold(names, scope.closures, set.delete)
  }
  Scope(..scope, held: held_names, closures:)
}

fn bound(patterns: List(glance.Pattern)) -> List(String) {
  list.flat_map(patterns, pattern)
  |> list.filter_map(fn(seen) {
    case seen {
      Bound(name) -> Ok(name)
      Name(_) | Remote(..) | Text(_) | Stops -> Error(Nil)
    }
  })
}

fn parameter_names(parameters: List(glance.FnParameter)) -> List(String) {
  list.filter_map(parameters, fn(parameter) {
    case parameter.name {
      glance.Named(name) -> Ok(name)
      glance.Discarded(_) -> Error(Nil)
    }
  })
}

fn items(
  given: List(glance.Field(glance.Expression)),
) -> List(glance.Expression) {
  list.map(given, fn(field) {
    case field {
      glance.LabelledField(item:, ..) | glance.UnlabelledField(item) -> item
      glance.ShorthandField(label:, location:) ->
        glance.Variable(location:, name: label)
    }
  })
}

fn updated(
  location: glance.Span,
  fields: List(glance.RecordUpdateField(glance.Expression)),
) -> List(glance.Expression) {
  list.map(fields, fn(field) {
    option.unwrap(field.item, glance.Variable(location:, name: field.label))
  })
}

fn parts(
  subject: glance.Expression,
  scope: Scope,
) -> List(#(glance.Expression, Scope)) {
  let here = list.map(_, fn(part) { #(part, scope) })
  case subject {
    glance.Int(..)
    | glance.Float(..)
    | glance.String(..)
    | glance.Variable(..) -> []
    glance.FieldAccess(container:, ..) -> here([container])
    glance.TupleIndex(tuple:, ..) -> here([tuple])
    glance.NegateInt(value:, ..) | glance.NegateBool(value:, ..) ->
      here([value])
    glance.Call(function:, arguments:, ..) ->
      here([function, ..items(arguments)])
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      here([
        function,
        ..list.append(items(arguments_before), items(arguments_after))
      ])
    glance.BinaryOperator(left:, right:, ..) -> here([left, right])
    glance.Tuple(elements:, ..) -> here(elements)
    glance.List(elements:, rest:, ..) ->
      here(list.append(elements, option.values([rest])))
    glance.RecordUpdate(location:, record:, fields:, ..) ->
      here([record, ..updated(location, fields)])
    glance.Panic(message:, ..) | glance.Todo(message:, ..) ->
      here(option.values([message]))
    glance.Echo(expression:, message:, ..) ->
      here(option.values([expression, message]))
    glance.BitString(segments:, ..) ->
      here(list.map(segments, fn(segment) { segment.0 }))
    glance.Case(subjects:, clauses:, ..) -> {
      let held = list.any(subjects, refers(_, scope))
      let closure = list.any(subjects, carries_closure(_, scope))
      list.append(
        here(subjects),
        list.flat_map(clauses, fn(clause) {
          let inner =
            binding(scope, bound(list.flatten(clause.patterns)), held, closure)
          list.map([clause.body, ..option.values([clause.guard])], fn(part) {
            #(part, inner)
          })
        }),
      )
    }
    glance.Fn(..) | glance.Block(..) -> []
  }
}

fn refers(subject: glance.Expression, scope: Scope) -> Bool {
  case subject {
    glance.Variable(name:, ..) -> set.contains(scope.held, name)
    glance.FieldAccess(container: glance.Variable(name:, ..), ..) ->
      !set.contains(scope.modules, name) && set.contains(scope.held, name)
    glance.Fn(arguments:, body:, ..) ->
      refers_in(body, binding(scope, parameter_names(arguments), False, False))
    glance.Block(statements:, ..) -> refers_in(statements, scope)
    _ -> list.any(parts(subject, scope), fn(part) { refers(part.0, part.1) })
  }
}

fn refers_in(body: List(glance.Statement), scope: Scope) -> Bool {
  case body {
    [] -> False
    [glance.Assignment(pattern: assigned, value:, ..), ..rest] -> {
      let held = refers(value, scope)
      held
      || refers_in(
        rest,
        binding(scope, bound([assigned]), held, carries_closure(value, scope)),
      )
    }
    [glance.Use(function:, patterns:, ..), ..rest] -> {
      let held = refers(function, scope)
      held || refers_in(rest, binding(scope, use_names(patterns), held, False))
    }
    [glance.Expression(inner), ..rest] ->
      refers(inner, scope) || refers_in(rest, scope)
    [glance.Assert(expression: asserted, ..), ..rest] ->
      refers(asserted, scope) || refers_in(rest, scope)
  }
}

fn carries_closure(subject: glance.Expression, scope: Scope) -> Bool {
  case subject {
    glance.Fn(..) | glance.FnCapture(..) -> True
    glance.Variable(name:, ..) -> set.contains(scope.closures, name)
    glance.Call(function:, arguments:, ..) ->
      constructs(function)
      && list.any(items(arguments), carries_closure(_, scope))
    glance.Block(statements:, ..) ->
      list.any(statements, fn(statement) {
        case statement {
          glance.Use(..) -> True
          glance.Assignment(value: inner, ..)
          | glance.Expression(inner)
          | glance.Assert(expression: inner, ..) ->
            carries_closure(inner, scope)
        }
      })
    _ ->
      list.any(parts(subject, scope), fn(part) {
        carries_closure(part.0, part.1)
      })
  }
}

fn constructs(callee: glance.Expression) -> Bool {
  let capital = fn(name) {
    string.first(name)
    |> result.map(fn(first) { first == string.uppercase(first) })
    |> result.unwrap(False)
  }
  case callee {
    glance.Variable(name:, ..) -> capital(name)
    glance.FieldAccess(label:, ..) -> capital(label)
    _ -> False
  }
}

fn use_names(patterns: List(glance.UsePattern)) -> List(String) {
  bound(list.map(patterns, fn(use_pattern) { use_pattern.pattern }))
}

fn handed_in(body: List(glance.Statement), scope: Scope) -> List(String) {
  case body {
    [] -> []
    [glance.Assignment(pattern: assigned, value: inner, ..), ..rest] -> {
      let held = refers(inner, scope)
      let after =
        binding(scope, bound([assigned]), held, carries_closure(inner, scope))
      list.append(handed(inner, scope), handed_in(rest, after))
    }
    [glance.Expression(inner), ..rest]
    | [glance.Assert(expression: inner, ..), ..rest] ->
      list.append(handed(inner, scope), handed_in(rest, scope))
    [glance.Use(function:, patterns:, ..), ..rest] -> {
      let inner =
        binding(scope, use_names(patterns), refers(function, scope), False)
      let made = case function {
        glance.Call(function: callee, ..) ->
          case scope.sink(callee), refers_in(rest, inner) {
            Some(#(called, _)), True -> [called]
            _, _ -> []
          }
        _ -> []
      }
      list.flatten([made, handed(function, scope), handed_in(rest, inner)])
    }
  }
}

fn handed(subject: glance.Expression, scope: Scope) -> List(String) {
  let given = fn(callee, arguments: List(glance.Field(glance.Expression))) {
    case scope.sink(callee) {
      Some(#(called, parameters)) -> {
        let takes = callback_positions(arguments, parameters)
        let over =
          list.zip(items(arguments), takes)
          |> list.any(fn(one) {
            let #(argument, callback) = one
            refers(argument, scope)
            && { callback || carries_closure(argument, scope) }
          })
        case over {
          True -> [called]
          False -> []
        }
      }
      None -> []
    }
  }
  let made = case subject {
    glance.Call(function:, arguments:, ..) -> given(function, arguments)
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      given(function, list.append(arguments_before, arguments_after))
    glance.BinaryOperator(name: glance.Pipe, left:, right:, ..) -> {
      let piped = glance.UnlabelledField(left)
      case right {
        glance.Call(function: callee, arguments:, ..) ->
          given(callee, [piped, ..arguments])
        glance.FnCapture(function: callee, ..) -> given(callee, [piped])
        callee -> given(callee, [piped])
      }
    }
    _ -> []
  }
  let inside = case subject {
    glance.Fn(arguments:, body:, ..) ->
      handed_in(body, binding(scope, parameter_names(arguments), False, False))
    glance.Block(statements:, ..) -> handed_in(statements, scope)
    _ ->
      list.flat_map(parts(subject, scope), fn(part) { handed(part.0, part.1) })
  }
  list.append(made, inside)
}

fn callback_positions(
  arguments: List(glance.Field(glance.Expression)),
  parameters: Option(List(#(Option(String), Bool))),
) -> List(Bool) {
  let parameters = option.unwrap(parameters, [])
  let #(_, takes) =
    list.map_fold(arguments, parameters, fn(left, argument) {
      case argument {
        glance.UnlabelledField(_) ->
          case left {
            [#(_, callback), ..rest] -> #(rest, callback)
            [] -> #([], False)
          }
        glance.LabelledField(label:, ..) | glance.ShorthandField(label:, ..) -> #(
          left,
          list.any(parameters, fn(parameter) {
            parameter.0 == Some(label) && parameter.1
          }),
        )
      }
    })
  takes
}

fn skips_outcome(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(name == "editor")
  let aliases = aliases_of(module)
  let broken =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition
      let takes =
        list.any(function.parameters, fn(parameter) {
          case parameter.type_ {
            Some(type_) -> mentions(expand(type_, aliases), ["Editor"])
            None -> False
          }
        })
      let hands_back = case option.map(function.return, expand(_, aliases)) {
        Some(returned) ->
          mentions(returned, ["Editor"]) && !mentions(returned, ["Outcome"])
        None -> False
      }
      case function.publicity, takes && hands_back {
        glance.Public, True ->
          Ok(Found(Broken(SkipsOutcome, path, function.name)))
        _, _ -> Error(Nil)
      }
    })
  [Looked(SkipsOutcome, path), ..broken]
}

fn forbidden_calls(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  let resolve = resolver(module_key(path), module)
  let in_functions =
    list.map(module.functions, fn(definition) {
      let function = definition.definition
      #(
        function.name,
        statements(function.body, parameters_of(function)),
        uses(function, resolve),
      )
    })
  let in_constants =
    list.map(module.constants, fn(definition) {
      let seen = expression(definition.definition.value, set.new())
      #(definition.definition.name, seen, list.filter_map(seen, resolve))
    })
  let broken =
    list.flat_map(list.append(in_functions, in_constants), fn(one) {
      let #(holder, seen, used) = one
      let calls =
        list.filter_map(used, fn(called) {
          case called {
            "lustre/element.unsafe_raw_html" ->
              Ok(Found(Broken(RawHtml, path, holder)))
            "lustre/element/html.textarea" if name != "surface" ->
              Ok(Found(Broken(FieldWrite, path, holder <> " draws a textarea")))
            _ -> Error(Nil)
          }
        })
      let texts =
        list.filter_map(seen, fn(one) {
          case one {
            Text("textarea") | Text("contenteditable") if name != "surface" ->
              Ok(
                Found(Broken(FieldWrite, path, holder <> " names a text field")),
              )
            Text(_) | Name(_) | Remote(..) | Bound(_) | Stops -> Error(Nil)
          }
        })
      list.append(calls, texts)
    })
  [Looked(RawHtml, path), Looked(FieldWrite, path), ..broken]
}

type External {
  External(file: String, function: String)
}

fn external(
  definition: glance.Definition(glance.Function),
) -> Option(External) {
  list.find_map(definition.attributes, fn(attribute) {
    case attribute {
      glance.Attribute(
        "external",
        [_, glance.String(value: file, ..), glance.String(value: function, ..)],
      ) -> Ok(External(file:, function:))
      _ -> Error(Nil)
    }
  })
  |> option.from_result
}

fn module_key(path: String) -> String {
  path |> strip_prefix("src/") |> string.replace(".gleam", "")
}

/// Every function and constant that reaches page-changing JavaScript,
/// directly or through others, in any module.
fn changers(files: List(File)) -> Set(String) {
  reaching(files, fn(name, javascript) {
    touches_page(name) && !list.contains(measures, javascript)
  })
}

fn reaching(
  files: List(File),
  picks: fn(String, String) -> Bool,
) -> Set(String) {
  let functions =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) -> {
          let key = module_key(path)
          let resolve = resolver(key, module)
          let functions =
            list.map(module.functions, fn(definition) {
              let function = definition.definition
              let starts = case external(definition) {
                Some(External(function: javascript, ..)) ->
                  picks(name, javascript)
                None -> False
              }
              Reaching(
                key <> "." <> function.name,
                uses(function, resolve),
                starts,
              )
            })
          let constants =
            list.map(module.constants, fn(definition) {
              let constant = definition.definition
              let used =
                list.filter_map(expression(constant.value, set.new()), resolve)
              Reaching(key <> "." <> constant.name, used, False)
            })
          list.append(functions, constants)
        }
        JavaScript(..) | GleamTest(..) | Other(_) | Unreadable(_) -> []
      }
    })
  let start =
    list.filter_map(functions, fn(function) {
      case function.starts {
        True -> Ok(function.name)
        False -> Error(Nil)
      }
    })
    |> set.from_list
  grow(start, functions)
}

/// A function or constant, the functions it names, and whether it starts
/// the reach: it changes the page, or it asserts.
type Reaching {
  Reaching(name: String, uses: List(String), starts: Bool)
}

fn grow(changers: Set(String), functions: List(Reaching)) -> Set(String) {
  let grown =
    list.fold(functions, changers, fn(grown, function) {
      case list.any(function.uses, set.contains(grown, _)) {
        True -> set.insert(grown, function.name)
        False -> grown
      }
    })
  case set.size(grown) == set.size(changers) {
    True -> grown
    False -> grow(grown, functions)
  }
}

/// The functions `function` names, as "nullpad/surface.blur_control". A
/// name the function binds itself (a parameter, a `let`) is not one.
fn uses(
  function: glance.Function,
  resolve: fn(Seen) -> Result(String, Nil),
) -> List(String) {
  statements(function.body, parameters_of(function))
  |> list.filter_map(resolve)
  |> list.unique
}

fn parameters_of(function: glance.Function) -> Set(String) {
  list.filter_map(function.parameters, fn(parameter) {
    case parameter.name {
      glance.Named(name) -> Ok(name)
      glance.Discarded(_) -> Error(Nil)
    }
  })
  |> set.from_list
}

fn resolver(
  key: String,
  module: glance.Module,
) -> fn(Seen) -> Result(String, Nil) {
  let locals =
    list.map(module.functions, fn(definition) { definition.definition.name })
    |> list.append(
      list.map(module.constants, fn(definition) { definition.definition.name }),
    )
    |> set.from_list
  let aliases: Dict(String, String) =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition
      case imported.alias {
        Some(glance.Named(alias)) -> Ok(#(alias, imported.module))
        Some(glance.Discarded(_)) -> Error(Nil)
        None ->
          string.split(imported.module, "/")
          |> list.last
          |> result.map(fn(alias) { #(alias, imported.module) })
      }
    })
    |> dict.from_list
  let unqualified: Dict(String, String) =
    list.flat_map(module.imports, fn(definition) {
      let imported = definition.definition
      list.map(imported.unqualified_values, fn(value) {
        #(
          option.unwrap(value.alias, value.name),
          imported.module <> "." <> value.name,
        )
      })
    })
    |> dict.from_list
  fn(seen) {
    case seen {
      Name(name) ->
        case set.contains(locals, name) {
          True -> Ok(key <> "." <> name)
          False -> dict.get(unqualified, name)
        }
      Remote(alias, label) ->
        dict.get(aliases, alias)
        |> result.map(fn(module) { module <> "." <> label })
      Text(_) | Bound(_) | Stops -> Error(Nil)
    }
  }
}

type Seen {
  Name(String)
  Remote(alias: String, label: String)
  /// A string literal.
  Text(String)
  /// A name the code binds: a `let`, a pattern variable, a closure parameter.
  Bound(String)
  Stops
}

fn statements(body: List(glance.Statement), scope: Set(String)) -> List(Seen) {
  let #(seen, _) =
    list.fold(body, #([], scope), fn(so_far, statement) {
      let #(seen, scope) = so_far
      let #(here, binds) = case statement {
        glance.Use(function:, patterns:, ..) -> {
          let binds =
            list.flat_map(patterns, fn(use_pattern) {
              pattern(use_pattern.pattern)
            })
          #(expression(function, scope), binds)
        }
        glance.Assignment(pattern: assigned, value:, kind:, ..) -> #(
          list.append(expression(value, scope), case kind {
            glance.LetAssert(message) -> [Stops, ..maybe(message, scope)]
            glance.Let -> []
          }),
          pattern(assigned),
        )
        glance.Assert(expression: asserted, message:, ..) -> #(
          [
            Stops,
            ..list.append(expression(asserted, scope), maybe(message, scope))
          ],
          [],
        )
        glance.Expression(inner) -> #(expression(inner, scope), [])
      }
      #([binds, here, ..seen], within(scope, binds))
    })
  list.flatten(list.reverse(seen))
}

fn within(scope: Set(String), seen: List(Seen)) -> Set(String) {
  list.fold(seen, scope, fn(scope, one) {
    case one {
      Bound(name) -> set.insert(scope, name)
      Name(_) | Remote(..) | Text(_) | Stops -> scope
    }
  })
}

fn maybe(wrapped: Option(glance.Expression), scope: Set(String)) -> List(Seen) {
  case wrapped {
    Some(inner) -> expression(inner, scope)
    None -> []
  }
}

fn fields(
  given: List(glance.Field(glance.Expression)),
  scope: Set(String),
) -> List(Seen) {
  list.flat_map(given, fn(field) {
    case field {
      glance.LabelledField(item:, ..) -> expression(item, scope)
      glance.ShorthandField(label:, ..) -> named(label, scope)
      glance.UnlabelledField(item) -> expression(item, scope)
    }
  })
}

fn named(name: String, scope: Set(String)) -> List(Seen) {
  case set.contains(scope, name) {
    True -> []
    False -> [Name(name)]
  }
}

/// A string literal, or literals joined with `<>`.
fn literal(subject: glance.Expression) -> Option(String) {
  case subject {
    glance.String(value:, ..) -> Some(value)
    glance.BinaryOperator(name: glance.Concatenate, left:, right:, ..) ->
      case literal(left), literal(right) {
        Some(left), Some(right) -> Some(left <> right)
        _, _ -> None
      }
    _ -> None
  }
}

fn expression(subject: glance.Expression, scope: Set(String)) -> List(Seen) {
  let inner = expression(_, scope)
  case subject {
    glance.Int(..) | glance.Float(..) -> []
    glance.String(value:, ..) -> [Text(value)]
    glance.Variable(name:, ..) -> named(name, scope)
    glance.NegateInt(value:, ..) | glance.NegateBool(value:, ..) -> inner(value)
    glance.Block(statements: body, ..) -> statements(body, scope)
    glance.Panic(message:, ..) | glance.Todo(message:, ..) -> [
      Stops,
      ..maybe(message, scope)
    ]
    glance.Tuple(elements:, ..) -> list.flat_map(elements, inner)
    glance.List(elements:, rest:, ..) ->
      list.append(list.flat_map(elements, inner), maybe(rest, scope))
    glance.Fn(arguments:, body:, ..) -> {
      let binds =
        list.filter_map(arguments, fn(argument) {
          case argument.name {
            glance.Named(name) -> Ok(Bound(name))
            glance.Discarded(_) -> Error(Nil)
          }
        })
      list.append(binds, statements(body, within(scope, binds)))
    }
    glance.RecordUpdate(record:, fields: updated, ..) ->
      list.append(
        inner(record),
        list.flat_map(updated, fn(field) { maybe(field.item, scope) }),
      )
    glance.FieldAccess(container: glance.Variable(name:, ..), label:, ..) ->
      case set.contains(scope, name) {
        True -> []
        False -> [Remote(name, label), Name(name)]
      }
    glance.FieldAccess(container:, ..) -> inner(container)
    glance.Call(function:, arguments:, ..) ->
      list.append(inner(function), fields(arguments, scope))
    glance.TupleIndex(tuple:, ..) -> inner(tuple)
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      list.flatten([
        inner(function),
        fields(arguments_before, scope),
        fields(arguments_after, scope),
      ])
    glance.BitString(segments:, ..) ->
      list.flat_map(segments, fn(segment) { inner(segment.0) })
    glance.Case(subjects:, clauses:, ..) ->
      list.append(
        list.flat_map(subjects, inner),
        list.flat_map(clauses, fn(clause) {
          let binds = list.flat_map(list.flatten(clause.patterns), pattern)
          let scope = within(scope, binds)
          list.flatten([
            binds,
            maybe(clause.guard, scope),
            expression(clause.body, scope),
          ])
        }),
      )
    glance.BinaryOperator(name: glance.Concatenate, left:, right:, ..) ->
      case literal(subject) {
        Some(text) -> [Text(text)]
        None -> list.append(inner(left), inner(right))
      }
    glance.BinaryOperator(left:, right:, ..) ->
      list.append(inner(left), inner(right))
    glance.Echo(expression: echoed, message:, ..) ->
      list.append(maybe(echoed, scope), maybe(message, scope))
  }
}

fn pattern(subject: glance.Pattern) -> List(Seen) {
  let named = fn(name: glance.AssignmentName) {
    case name {
      glance.Named(name) -> [Bound(name)]
      glance.Discarded(_) -> []
    }
  }
  case subject {
    glance.PatternConcatenate(prefix_name:, rest_name:, ..) ->
      list.append(
        named(rest_name),
        option.map(prefix_name, named) |> option.unwrap([]),
      )
    glance.PatternVariable(name:, ..) -> [Bound(name)]
    glance.PatternTuple(elements:, ..) -> list.flat_map(elements, pattern)
    glance.PatternList(elements:, tail:, ..) ->
      list.append(list.flat_map(elements, pattern), case tail {
        Some(tail) -> pattern(tail)
        None -> []
      })
    glance.PatternAssignment(pattern: inner, name:, ..) -> [
      Bound(name),
      ..pattern(inner)
    ]
    glance.PatternVariant(arguments:, ..) ->
      list.flat_map(arguments, fn(field) {
        case field {
          glance.LabelledField(item:, ..) -> pattern(item)
          glance.UnlabelledField(item) -> pattern(item)
          glance.ShorthandField(label:, ..) -> [Bound(label)]
        }
      })
    glance.PatternString(..)
    | glance.PatternInt(..)
    | glance.PatternFloat(..)
    | glance.PatternDiscard(..)
    | glance.PatternBitString(..) -> []
  }
}

fn tests_run(
  path: String,
  module: glance.Module,
  checking: Set(String),
) -> List(Finding) {
  let name = test_module_name(path)
  let functions = test_functions(path, module)
  let asserting = reach(functions)
  let misnamed_module = !string.ends_with(name, "_test")
  let found =
    list.flat_map(module.functions, fn(definition) {
      let function = definition.definition
      let named_test = string.ends_with(function.name, "_test")
      let public = function.publicity == glance.Public
      let key = written_ahead_key(WrittenAhead(path, function.name))
      let stops = list.contains(statements(function.body, set.new()), Stops)
      let forgotten =
        public
        && !named_test
        && function.parameters == []
        && {
          stops
          || {
            function.name != "main"
            && set.contains(asserting, name <> "." <> function.name)
          }
        }
      let ahead =
        forgotten
        && list.any(written_ahead, fn(one) { written_ahead_key(one) == key })
      list.flatten([
        when(misnamed_module && named_test && public, fn() {
          [
            Found(Broken(
              TestRuns,
              path,
              function.name
                <> " is in a module whose name does not end in _test, and gleeunit only runs modules that do",
            )),
          ]
        }),
        when(
          named_test
            && public
            && function.parameters == []
            && option.is_none(external(definition))
            && !just_nil(function.body)
            && !set.contains(checking, name <> "." <> function.name),
          fn() {
            [
              Found(Broken(
                TestRuns,
                path,
                function.name
                  <> " reaches no assert, let assert, panic, todo or gleeunit/should call, so it checks nothing",
              )),
            ]
          },
        ),
        when(targets_erlang(definition), fn() {
          [
            Found(Broken(
              TestRuns,
              path,
              function.name
                <> " is for the Erlang target, and the tests run on JavaScript",
            )),
          ]
        }),
        when(named_test && !public, fn() {
          [
            Found(Broken(
              TestRuns,
              path,
              function.name <> " is private, so gleeunit never calls it",
            )),
          ]
        }),
        when(named_test && public && function.parameters != [], fn() {
          [
            Found(Broken(
              TestRuns,
              path,
              function.name
                <> " takes arguments, and gleeunit calls it with none",
            )),
          ]
        }),
        when(
          named_test
            && public
            && option.is_none(external(definition))
            && just_nil(function.body),
          fn() {
            [
              Found(Broken(
                TestRuns,
                path,
                function.name <> " gives Nil and checks nothing",
              )),
            ]
          },
        ),
        when(forgotten && !ahead, fn() {
          [
            Found(Broken(
              TestRuns,
              path,
              function.name
                <> " asserts, panics or calls should, or calls a function that does, and takes nothing, but its name does not end in _test, so gleeunit never calls it",
            )),
          ]
        }),
        when(ahead, fn() { [Looked(TestRuns, key)] }),
      ])
    })
  [Looked(TestRuns, path), ..found]
}

fn test_module_name(path: String) -> String {
  path |> strip_prefix("test/") |> string.replace(".gleam", "")
}

fn test_functions(path: String, module: glance.Module) -> List(Reaching) {
  let name = test_module_name(path)
  let resolve = resolver(name, module)
  list.map(module.functions, fn(definition) {
    let function = definition.definition
    let used = uses(function, resolve)
    let checks =
      list.contains(statements(function.body, set.new()), Stops)
      || list.any(used, string.starts_with(_, "gleeunit/should."))
    Reaching(name <> "." <> function.name, used, checks)
  })
}

fn reach(functions: List(Reaching)) -> Set(String) {
  list.filter(functions, fn(function) { function.starts })
  |> list.map(fn(function) { function.name })
  |> set.from_list
  |> grow(functions)
}

fn checking_tests(files: List(File)) -> Set(String) {
  list.flat_map(files, fn(file) {
    case file {
      GleamTest(path:, module:) -> test_functions(path, module)
      Gleam(..) | JavaScript(..) | Other(_) | Unreadable(_) -> []
    }
  })
  |> reach
}

fn just_nil(body: List(glance.Statement)) -> Bool {
  case body {
    [] -> True
    [glance.Expression(glance.Variable(name: "Nil", ..))] -> True
    _ -> False
  }
}

fn targets_erlang(definition: glance.Definition(glance.Function)) -> Bool {
  list.any(definition.attributes, fn(attribute) {
    case attribute {
      glance.Attribute("target", [glance.Variable(name: "erlang", ..)]) -> True
      glance.Attribute(..) -> False
    }
  })
}

fn javascript(path: String, name: String) -> List(Finding) {
  [
    Looked(JavaScriptFile, path),
    ..when(!has_javascript(name), fn() {
      [Found(Broken(JavaScriptFile, path, "this module may not have one"))]
    })
  ]
}

fn faults(files: List(File), looked: List(#(Rule, String))) -> List(String) {
  let names =
    list.filter_map(files, fn(file) {
      case file {
        Gleam(name:, ..) | JavaScript(name:, ..) -> Ok(name)
        GleamTest(..) | Other(_) | Unreadable(_) -> Error(Nil)
      }
    })
  let unreadable =
    list.filter_map(files, fn(file) {
      case file {
        Unreadable(path) -> Ok("glance could not parse " <> path)
        Gleam(..) | JavaScript(..) | GleamTest(..) | Other(_) -> Error(Nil)
      }
    })
  let missing =
    list.flatten([core, shell, with_javascript])
    |> list.unique
    |> list.filter(fn(name) { !list.contains(names, name) })
    |> list.map(fn(name) { "a listed module does not exist: " <> name })
  let idle =
    list.filter(rules, fn(rule) { !list.any(looked, fn(one) { one.0 == rule }) })
    |> list.map(fn(rule) { "a rule examined nothing: " <> says(rule) })
  let externals =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(module:, ..) ->
          list.filter_map(module.functions, fn(definition) {
            external(definition)
            |> option.map(fn(external) { external.function })
            |> option.to_result(Nil)
          })
        JavaScript(..) | GleamTest(..) | Other(_) | Unreadable(_) -> []
      }
    })
  let looked_at = list.map(looked, fn(one) { one.1 })
  let unused = fn(allowed: List(String), used: List(String), what: String) {
    list.filter(allowed, fn(one) { !list.contains(used, one) })
    |> list.map(fn(one) {
      "nothing needs this " <> what <> " any more: " <> one
    })
  }
  list.flatten([
    unreadable,
    missing,
    idle,
    unused(measures, externals, "measure"),
    unused(records, externals, "record"),
    unused(
      list.map(written_ahead, written_ahead_key),
      looked_at,
      "written-ahead test",
    ),
  ])
}
